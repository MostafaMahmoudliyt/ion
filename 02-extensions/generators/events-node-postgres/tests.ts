import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate as generateSql } from '../sql-postgres/index.ts';
import { generate } from './index.ts';
import { PG_URI, entity, freshDatabase, mit, specsOf } from '../../../test/helpers.ts';

const js = (def: unknown = mit) => generate(specsOf(def))['handlers.js'];

test('events-node-postgres: no events -> no handlers file', () => {
  assert.deepEqual(generate(specsOf({ entities: [entity('a')] })), {});
});

test('events-node-postgres: one exported handler per event, plain-data EVENTS table', () => {
  const s = js();
  for (const h of ['onStudentEnrolled', 'onStudentGraduated', 'onProfessorHired']) assert.match(s, new RegExp(`export const ${h} = \\(ctx, event\\) => dispatch\\(ctx, `));
  assert.match(s, /export const eventIds = Object\.freeze\(\["student\.enrolled","student\.graduated","professor\.hired"\]\);/);
  assert.match(s, /UPDATE courses SET enrolled_count = COALESCE\(enrolled_count, 0\) \+ \$2 WHERE id = \$1 AND archived_at IS NULL/);
  assert.match(s, /UPDATE students SET status = \$2 WHERE id = \$1 AND archived_at IS NULL/);
});

test('events-node-postgres: deterministic, no eval/Function/dynamic import in the output', () => {
  assert.equal(js(), js());
  assert.doesNotMatch(js(), /\beval\s*\(|new Function|import\s*\(|child_process|require\(/);
  assert.doesNotMatch(js(), /\b20\d\d-\d\d-\d\d/);
});

test('events-node-postgres: delete_entity archives, json values are cast, create_entity binds literals', () => {
  const def = {
    entities: [entity('student', [{ name: 'name', type: 'string' }, { name: 'bio', type: 'json' }, { name: 'tags', type: 'array' }]), entity('course', [{ name: 'title', type: 'string' }])],
    relationships: [],
    events: [{ id: 'x.done', name: 'Done', actor: 'student', target: 'course', triggers: [
      { action: 'update_field', field: 'student.bio', value: { a: 1 } },
      { action: 'delete_entity', entity: 'course' },
      { action: 'create_entity', entity: 'student', values: { tags: ['a'], name: "O'Hara" } },
    ] }],
  };
  const s = js(def);
  assert.match(s, /SET bio = \$2::jsonb WHERE id = \$1/);
  assert.match(s, /UPDATE courses SET archived_at = NOW\(\) WHERE id = \$1 AND archived_at IS NULL/);
  assert.match(s, /INSERT INTO students \(name, tags\) VALUES \(\$1, \$2::jsonb\)/);
  assert.doesNotMatch(s, /O'Hara'/); // values are bound parameters, never spliced into SQL
});

test('events-node-postgres: handlers run on real PostgreSQL (atomicity, effects, guards)', { skip: PG_URI ? false : 'set ION_PG_URI to run' }, async () => {
  const db = await freshDatabase('ion_events_test');
  const dir = mkdtempSync(join(tmpdir(), 'ion-handlers-'));
  try {
    for (const content of Object.values(generateSql(specsOf()))) await db.pool.query(content);
    writeFileSync(join(dir, 'handlers.js'), js());
    const H: any = await import(pathToFileURL(join(dir, 'handlers.js')).href);

    const sent: { email: any[]; push: any[]; http: any[] } = { email: [], push: [], http: [] };
    const ctx: any = {
      db: {
        query: (sql: string, p: unknown[]) => db.pool.query(sql, p),
        async transaction(fn: (tx: any) => Promise<unknown>) {
          const c = await db.pool.connect();
          try { await c.query('BEGIN'); const r = await fn({ query: (s: string, p: unknown[]) => c.query(s, p) }); await c.query('COMMIT'); return r; }
          catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
        },
      },
      email: { async send(m: any) { sent.email.push(m); } },
      push: { async send(m: any) { sent.push.push(m); } },
      http: { async post(url: string, body: any) { sent.http.push({ url, body }); } },
    };
    const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
    const one = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0];
    const counts = () => one('SELECT (SELECT count(*) FROM ion_notifications)::int n, (SELECT count(*) FROM ion_event_log)::int l, (SELECT count(*) FROM ion_audit_log)::int a');

    const [stu] = await q("INSERT INTO students (name, email) VALUES ('Sara','sara@mit.test') RETURNING id");
    const [prof] = await q("INSERT INTO professors (name, email) VALUES ('Dr X','x@mit.test') RETURNING id");
    const [dep] = await q("INSERT INTO departments (name) VALUES ('CS') RETURNING id");
    const [course] = await q("INSERT INTO courses (name, code, credits) VALUES ('Algo','CS101',4) RETURNING id");

    // 1. enrolled: increment + in-app notification + audit + ledger, then push after commit
    let r = await H.onStudentEnrolled(ctx, { actor_id: stu.id, target_id: course.id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.effects, [{ action: 'push', ok: true }]);
    assert.equal((await one('SELECT enrolled_count FROM courses WHERE id=$1', [course.id])).enrolled_count, 1);
    assert.deepEqual(await counts(), { n: 1, l: 1, a: 1 });
    assert.equal(sent.push[0].recipient_id, stu.id);
    assert.equal(sent.push[0].recipient_entity, 'student');
    await H.handlers['student.enrolled'](ctx, { actor_id: stu.id, target_id: course.id });
    assert.equal((await one('SELECT enrolled_count FROM courses WHERE id=$1', [course.id])).enrolled_count, 2);

    // 2. atomicity: archived target -> ROW_NOT_FOUND, nothing committed
    await q('UPDATE courses SET archived_at = NOW() WHERE id=$1', [course.id]);
    const before = await counts();
    const pushesBefore = sent.push.length;
    await assert.rejects(H.dispatch(ctx, 'student.enrolled', { actor_id: stu.id, target_id: course.id }), (e: any) => e.code === 'ROW_NOT_FOUND');
    assert.deepEqual(await counts(), before);
    assert.equal(sent.push.length, pushesBefore); // no push goes out for a rolled-back event
    await q('UPDATE courses SET archived_at = NULL WHERE id=$1', [course.id]);

    // 3. update_field + email to the looked-up address
    await H.dispatch(ctx, 'student.graduated', { actor_id: stu.id, target_id: course.id });
    assert.equal((await one('SELECT status FROM students WHERE id=$1', [stu.id])).status, 'graduated');
    assert.equal(sent.email.length, 1);
    assert.equal(sent.email[0].to, 'sara@mit.test');

    // 4. a missing adapter is reported, the committed database phase stays committed
    r = await H.dispatch({ ...ctx, email: undefined }, 'student.graduated', { actor_id: stu.id, target_id: course.id });
    assert.equal(r.ok, false);
    const failed = r.effects.find((e: any) => e.action === 'send_email');
    assert.equal(failed.ok, false);
    assert.match(failed.error, /ctx\.email/);

    // 5. actor = Department, target = Professor
    await H.dispatch(ctx, 'professor.hired', { actor_id: dep.id, target_id: prof.id });
    assert.equal((await one('SELECT professor_count FROM departments WHERE id=$1', [dep.id])).professor_count, 1);

    // 6. runtime guards
    await assert.rejects(H.dispatch(ctx, 'student.enrolled', { actor_id: 'x', target_id: course.id }), (e: any) => e.code === 'INVALID_PAYLOAD');
    await assert.rejects(H.dispatch(ctx, 'nope', { actor_id: stu.id, target_id: course.id }), (e: any) => e.code === 'UNKNOWN_EVENT');
    await assert.rejects(H.dispatch(ctx, '__proto__', { actor_id: stu.id, target_id: course.id }), (e: any) => e.code === 'UNKNOWN_EVENT');
    await assert.rejects(H.dispatch({ db: { query() {} } }, 'student.enrolled', { actor_id: stu.id, target_id: course.id }), (e: any) => e.code === 'NO_TRANSACTION');
  } finally { await db.close(); }
});

test('events-node-postgres: webhooks, workflows, create_entity and archive work end to end', { skip: PG_URI ? false : 'set ION_PG_URI to run' }, async () => {
  const def = {
    entities: [entity('student', [{ name: 'name', type: 'string' }, { name: 'bio', type: 'json' }, { name: 'owner_id', type: 'uuid' }]), entity('course', [{ name: 'title', type: 'string' }, { name: 'seats', type: 'integer', default: 10 }])],
    relationships: [],
    events: [
      { id: 'a.start', name: 'Start', actor: 'student', target: 'course', triggers: [
        { action: 'decrement', field: 'course.seats', by: 3 },
        { action: 'update_field', field: 'student.bio', value: { level: 2 } },
        { action: 'update_field', field: 'student.owner_id', value: { from: 'target' } },
        { action: 'create_entity', entity: 'student', values: { name: "O'Hara; DROP TABLE students;--" } },
        { action: 'call_webhook', url: 'https://hooks.example.test/x' },
        { action: 'trigger_workflow', workflow: 'a.finish' },
      ] },
      { id: 'a.finish', name: 'Finish', actor: 'student', target: 'course', triggers: [{ action: 'delete_entity', entity: 'course' }, { action: 'log', level: 'info' }] },
    ],
  };
  if (!PG_URI) return;
  const db = await freshDatabase('ion_events_test2');
  const dir = mkdtempSync(join(tmpdir(), 'ion-handlers-'));
  try {
    const specs = specsOf(def);
    for (const content of Object.values(generateSql(specs))) await db.pool.query(content);
    writeFileSync(join(dir, 'handlers.js'), generate(specs)['handlers.js']);
    const H: any = await import(pathToFileURL(join(dir, 'handlers.js')).href);
    const calls: any[] = [];
    const ctx: any = {
      db: { query: (s: string, p: unknown[]) => db.pool.query(s, p), async transaction(fn: any) { const c = await db.pool.connect(); try { await c.query('BEGIN'); const r = await fn({ query: (s: string, p: unknown[]) => c.query(s, p) }); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } } },
      http: { async post(url: string, body: any) { calls.push({ url, body }); } },
    };
    const q = async (s: string, p: unknown[] = []) => (await db.pool.query(s, p)).rows;
    const [stu] = await q("INSERT INTO students (name) VALUES ('S') RETURNING id");
    const [crs] = await q("INSERT INTO courses (title) VALUES ('C') RETURNING id");
    const r = await H.onAStart(ctx, { actor_id: stu.id, target_id: crs.id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.effects.map((e: any) => e.action), ['call_webhook', 'trigger_workflow']);
    assert.deepEqual(calls[0], { url: 'https://hooks.example.test/x', body: { event_id: 'a.start', actor_id: stu.id, target_id: crs.id } });
    const course = (await q('SELECT seats, archived_at FROM courses WHERE id=$1', [crs.id]))[0];
    assert.equal(course.seats, 7);
    assert.notEqual(course.archived_at, null); // workflow a.finish archived it: nothing is deleted
    assert.equal((await q('SELECT count(*)::int n FROM courses'))[0].n, 1);
    const student = (await q('SELECT bio, owner_id FROM students WHERE id=$1', [stu.id]))[0];
    assert.deepEqual(student.bio, { level: 2 });
    assert.equal(student.owner_id, crs.id);
    assert.equal((await q("SELECT count(*)::int n FROM students WHERE name LIKE 'O''Hara%'"))[0].n, 1); // injection attempt stored as data
    assert.equal((await q('SELECT count(*)::int n FROM students'))[0].n, 2);
    assert.equal((await q("SELECT count(*)::int n FROM ion_event_log WHERE event_id IN ('a.start','a.finish')"))[0].n, 2);
    assert.equal((await q('SELECT count(*)::int n FROM ion_audit_log'))[0].n, 1);
  } finally { await db.close(); }
});
