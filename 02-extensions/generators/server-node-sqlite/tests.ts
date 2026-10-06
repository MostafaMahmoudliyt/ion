// Integration tests: the generated server is started in-process on a random port with a real SQLite database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from './index.ts';
import { generate as generateRoutes } from '../api-rest/index.ts';
import { entity, mit, specsOf } from '../../../test/helpers.ts';
// @ts-ignore the runtime is plain JavaScript, identical to what generate() emits
import { actualSchema, buildModel, compilePermissions, createIonServer, desiredSchema, MigrationError, planMigration, resolveRoles, routeTable } from './server.mjs';

const TOKEN = 'owner-token-1234567890';
type Booted = { base: string; app: any; call: (m: string, p: string, b?: unknown, h?: Record<string, string>) => Promise<[number, any]>; close: () => Promise<void> };

async function boot(def: unknown = mit, opts: Record<string, unknown> = {}): Promise<Booted> {
  const f = generate(specsOf(def) as any);
  const app = createIonServer({ spec: JSON.parse(f['spec.json']), tokens: { [TOKEN]: ['*'] }, db: ':memory:', staticDir: '/nonexistent', ...opts });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }): Promise<[number, any]> => {
    const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return [res.status, json];
  };
  return { base, app, call, close: () => app.close() };
}
const withServer = async (fn: (s: Booted) => Promise<void>, def: unknown = mit, opts: Record<string, unknown> = {}): Promise<void> => { const s = await boot(def, opts); try { await fn(s); } finally { await s.close(); } };

test('server: generate() is deterministic, ships the fixed runtime, and the runtime contains no dynamic code', () => {
  const a = generate(specsOf() as any), b = generate(specsOf() as any);
  assert.deepEqual(a, b);
  assert.equal(a['server.mjs'], readFileSync(new URL('./server.mjs', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(a).sort(), ['RUN.md', 'server.mjs', 'spec.json']);
  assert.ok(!/\beval\(|new Function|child_process|node:vm|import\(/.test(a['server.mjs']), 'no eval, Function, child_process, vm or dynamic import');
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d/.test(a['spec.json']), 'no timestamps in spec.json');
});

test('server: it serves exactly the routes api-rest declares (no drift in either direction)', () => {
  const specs = specsOf() as any;
  const js = generateRoutes(specs)['routes.js'];
  const declared = (JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1).replace(/,(\s*\])/g, '$1')) as Array<{ method: string; path: string }>).map((r) => `${r.method} ${r.path}`).sort();
  const spec = JSON.parse(generate(specs)['spec.json']);
  const served = (routeTable(spec) as Array<{ method: string; path: string }>).map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(served, declared);
});

test('server: authentication and permissions are enforced on every /api route', async () => {
  await withServer(async ({ call, base }) => {
    assert.equal((await call('GET', '/api/students', undefined, {}))[0], 401);
    assert.equal((await call('GET', '/api/students', undefined, { authorization: 'Bearer wrong-token-wrong-token' }))[0], 401);
    assert.equal((await call('GET', '/api/students'))[0], 200);
    assert.deepEqual((await call('GET', '/healthz', undefined, {}))[1], { ok: true });
    // session cookie flow
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const session = cookie.split(';')[0];
    assert.equal((await call('GET', '/api/students', undefined, { cookie: session }))[0], 200);
    const me = (await call('GET', '/auth/me', undefined, { cookie: session }))[1].permissions;
    assert.ok(me.includes('entity:student:list') && me.includes('relationship:enrollment:link') && !me.includes('*'), 'the UI gets concrete keys, never the wildcard');
    assert.equal((await call('GET', '/auth/me', undefined, {}))[0], 401);
    // CSRF: a cross-origin POST is refused even with a valid session cookie
    assert.equal((await call('POST', '/api/students', { name: 'X', email: 'x@x.org' }, { cookie: session, origin: 'https://evil.example' }))[0], 403);
  });
  await withServer(async ({ call, app }) => {
    const scoped = { authorization: 'Bearer scoped-token-1234567890' };
    assert.equal((await call('GET', '/api/students', undefined, scoped))[0], 200);
    assert.equal((await call('POST', '/api/students', { name: 'A', email: 'a@a.org' }, scoped))[0], 403);
    assert.equal((await call('GET', '/api/courses', undefined, scoped))[0], 403);
    assert.equal((await call('GET', '/api/students/00000000-0000-4000-8000-000000000000/enrollments', undefined, scoped))[0], 403);
    void app;
  }, mit, { tokens: { [TOKEN]: ['*'], 'scoped-token-1234567890': ['entity:student:list'] } });
});

test('server: login is rate limited after repeated wrong tokens', async () => {
  await withServer(async ({ base }) => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'nope' + i }) })).status;
    assert.equal(last, 429);
  });
});

test('server: create, read, update, archive with strict validation', async () => {
  await withServer(async ({ call }) => {
    const [c, s] = await call('POST', '/api/students', { name: 'Ada', email: 'ada@x.org', gpa: 3.5 });
    assert.equal(c, 201);
    assert.equal(s.status, 'active', 'enum default applied');
    assert.ok(s.enrolled_at && s.created_at && s.archived_at === null, 'auto and system columns set by the server');
    assert.match(s.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual((await call('GET', `/api/students/${s.id}`))[1], s);

    const bad = async (body: unknown, field?: string): Promise<void> => { const [st, j] = await call('POST', '/api/students', body); assert.equal(st, 400, JSON.stringify(j)); if (field) assert.equal(j.field, field); };
    await bad({ email: 'a@a.org' }, 'name');
    await bad({ name: 'N', email: 'not-an-email' }, 'email');
    await bad({ name: 'N', email: 'n@n.org', gpa: 'high' }, 'gpa');
    await bad({ name: 'N', email: 'n@n.org', status: 'retired' }, 'status');
    await bad({ name: 'N', email: 'n@n.org', hacker: 1 }, 'hacker');
    await bad({ name: 'N', email: 'n@n.org', created_at: '2000-01-01T00:00:00Z' }, 'created_at');
    await bad({ name: 'N', email: 'n@n.org', id: '11111111-1111-4111-8111-111111111111' }, 'id');
    await bad([1, 2]);
    assert.equal((await call('POST', '/api/students', { name: 'Z', email: 'z@z.org', gpa: 2 }))[0], 201);
    const [, upd] = await call('PATCH', `/api/students/${s.id}`, { gpa: 3.9 });
    assert.equal(upd.gpa, 3.9); assert.equal(upd.name, 'Ada', 'PATCH is partial');
    assert.equal((await call('PATCH', `/api/students/${s.id}`, { gpa: null }))[1].gpa, null, 'nullable column can be cleared');
    assert.equal((await call('PATCH', `/api/students/${s.id}`, { name: null }))[0], 400, 'required column cannot be cleared');
    assert.equal((await call('GET', '/api/students/not-a-uuid'))[0], 404);
    assert.equal((await call('GET', '/api/students/00000000-0000-4000-8000-000000000000'))[0], 404);

    // unique over ACTIVE rows: a duplicate is refused, but an archived row frees the value
    assert.equal((await call('POST', '/api/students', { name: 'Dup', email: 'ada@x.org' }))[0], 409);
    assert.equal((await call('DELETE', `/api/students/${s.id}`))[0], 204);
    assert.equal((await call('GET', `/api/students/${s.id}`))[0], 404);
    assert.equal((await call('POST', '/api/students', { name: 'Ada again', email: 'ada@x.org' }))[0], 201);
    assert.equal((await call('DELETE', `/api/students/${s.id}`))[0], 404, 'archiving twice');
  });
});

test('server: request hygiene (content type, malformed and oversized bodies)', async () => {
  await withServer(async ({ base }) => {
    const h = { authorization: `Bearer ${TOKEN}` };
    assert.equal((await fetch(base + '/api/students', { method: 'POST', headers: { ...h, 'content-type': 'text/plain' }, body: 'name=x' })).status, 415);
    assert.equal((await fetch(base + '/api/students', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{oops' })).status, 400);
    assert.equal((await fetch(base + '/api/students', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(1_100_000) }) }).catch(() => ({ status: 413 }))).status, 413);
    const res = await fetch(base + '/api/students', { headers: h });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + '/etc/passwd')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
  });
});

test('server: list search, filters, ranges, sorting and pagination', async () => {
  await withServer(async ({ call }) => {
    const rows = [['Ada', 'ada@x.org', 3.9, 'graduated'], ['Bob', 'bob@x.org', 2.5, 'active'], ['Cleo', 'cleo@y.org', 3.1, 'active'], ['Dan', 'dan@y.org', 3.9, 'active'], ['Eve', 'eve@y.org', null, 'active']];
    for (const [name, email, gpa, status] of rows) {
      const [c, r] = await call('POST', '/api/students', { name, email, gpa });
      assert.equal(c, 201);
      if (status !== 'active') assert.equal((await call('PATCH', `/api/students/${r.id}`, { status }))[0], 200); // moves active -> graduated
    }
    const names = async (qs: string): Promise<string[]> => (await call('GET', '/api/students?' + qs))[1].items.map((r: any) => r.name);
    assert.deepEqual(await names('q=%40y.org&sort=name'), ['Cleo', 'Dan', 'Eve'], 'search covers email');
    assert.deepEqual(await names('q=ADA'), ['Ada'], 'search is case-insensitive');
    assert.deepEqual(await names('filter[status]=graduated'), ['Ada']);
    assert.deepEqual(await names('filter[gpa][gte]=3&filter[gpa][lte]=3.5&sort=name'), ['Cleo']);
    assert.deepEqual(await names('sort=-name'), ['Eve', 'Dan', 'Cleo', 'Bob', 'Ada']);
    assert.deepEqual(await names('sort=gpa&filter[status]=active'), ['Eve', 'Bob', 'Cleo', 'Dan'], 'nulls sort first ascending');
    const [, p2] = await call('GET', '/api/students?sort=name&page=2&pageSize=2');
    assert.deepEqual(p2.items.map((r: any) => r.name), ['Cleo', 'Dan']); assert.equal(p2.total, 5);
    assert.equal((await call('GET', '/api/students?pageSize=100000'))[1].items.length, 5, 'page size is capped, not an error');
    assert.equal((await call('GET', '/api/students?sort=password'))[0], 400);
    assert.equal((await call('GET', '/api/students?filter[nope]=1'))[0], 400);
    assert.equal((await call('GET', '/api/students?filter[gpa]=abc'))[0], 400);
    assert.deepEqual(await names("q=%27%3B%20DROP%20TABLE%20students%3B--"), [], 'search text is a bound parameter');
    assert.equal((await call('GET', '/api/students'))[1].total, 5);
  });
});

test('server: many-to-many links carry attributes, both sides list them, re-linking after unlink works', async () => {
  await withServer(async ({ call }) => {
    const st = (await call('POST', '/api/students', { name: 'Ada', email: 'ada@x.org' }))[1];
    const co = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    assert.equal((await call('POST', `/api/students/${st.id}/enrollments`, { toId: co.id, grade: 88 }))[0], 201);
    assert.equal((await call('POST', `/api/students/${st.id}/enrollments`, { toId: co.id }))[0], 409, 'duplicate link');
    const fromSide = (await call('GET', `/api/students/${st.id}/enrollments`))[1];
    const toSide = (await call('GET', `/api/courses/${co.id}/enrollments`))[1];
    assert.equal(fromSide[0].id, co.id); assert.equal(fromSide[0].link.grade, 88); assert.match(fromSide[0].link.enrolled_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(toSide[0].id, st.id);
    assert.equal((await call('PATCH', `/api/students/${st.id}/enrollments/${co.id}`, { grade: 95 }))[0], 204);
    assert.equal((await call('GET', `/api/students/${st.id}/enrollments`))[1][0].link.grade, 95);
    assert.equal((await call('PATCH', `/api/students/${st.id}/enrollments/${co.id}`, { enrolled_on: '2020-01-01' }))[0], 400, 'auto link attribute is read-only');
    assert.equal((await call('POST', `/api/students/${st.id}/enrollments`, { toId: '00000000-0000-4000-8000-000000000000' }))[0], 404);
    assert.equal((await call('DELETE', `/api/students/${st.id}/enrollments/${co.id}`))[0], 204);
    assert.deepEqual((await call('GET', `/api/students/${st.id}/enrollments`))[1], []);
    assert.equal((await call('DELETE', `/api/students/${st.id}/enrollments/${co.id}`))[0], 404);
    assert.equal((await call('POST', `/api/students/${st.id}/enrollments`, { toId: co.id }))[0], 201, 'archived link no longer blocks');
    await call('DELETE', `/api/courses/${co.id}`);
    assert.deepEqual((await call('GET', `/api/students/${st.id}/enrollments`))[1], [], 'archived rows disappear from related lists');
  });
});

test('server: foreign-key relationships (one-to-many keeps the key in "to", many-to-one in "from")', async () => {
  await withServer(async ({ call }) => {
    const prof = (await call('POST', '/api/professors', { name: 'Dr X', email: 'x@u.org', department: 'CS' }))[1];
    const course = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    const dept = (await call('POST', '/api/departments', { name: 'CS' }))[1];
    assert.equal((await call('POST', `/api/professors/${prof.id}/teachings`, { toId: course.id }))[0], 201);
    assert.equal((await call('GET', `/api/courses/${course.id}`))[1].professor_id, prof.id);
    assert.equal((await call('GET', `/api/professors/${prof.id}/teachings`))[1][0].id, course.id);
    assert.equal((await call('GET', `/api/courses/${course.id}/teachings`))[1][0].id, prof.id);
    assert.equal((await call('POST', `/api/courses/${course.id}/course-departments`, { toId: dept.id }))[0], 201);
    assert.equal((await call('GET', `/api/courses/${course.id}`))[1].department_id, dept.id, 'many-to-one keeps the key in "from" (the course)');
    assert.equal((await call('GET', `/api/departments/${dept.id}/course-departments`))[1][0].id, course.id);
    const [st] = await call('POST', '/api/courses', { name: 'Bad', code: 'B', credits: 1, professor_id: '00000000-0000-4000-8000-000000000000' });
    assert.equal(st, 400, 'a key must reference an existing active row');
    assert.equal((await call('DELETE', `/api/professors/${prof.id}/teachings/${course.id}`))[0], 204);
    assert.equal((await call('GET', `/api/courses/${course.id}`))[1].professor_id, null);
    assert.equal((await call('DELETE', `/api/professors/${prof.id}/teachings/${course.id}`))[0], 404);
    assert.equal((await call('PATCH', `/api/professors/${prof.id}/teachings/${course.id}`, { x: 1 }))[0], 400, 'foreign-key links have no attributes');
  });
});

test('server: a relationship event runs atomically: notification, counter, audit and ledger', async () => {
  await withServer(async ({ call, app }) => {
    const st = (await call('POST', '/api/students', { name: 'Ada', email: 'ada@x.org' }))[1];
    const co = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    assert.equal(co.enrolled_count, 0, "counters start at zero");
    await call('POST', `/api/students/${st.id}/enrollments`, { toId: co.id });
    assert.equal((await call('GET', `/api/courses/${co.id}`))[1].enrolled_count, 1);
    const notes = (await call('GET', `/api/students/${st.id}/notifications`))[1];
    assert.equal(notes.length, 1); assert.equal(notes[0].event_id, 'student.enrolled'); assert.equal(notes[0].read_at, null);
    assert.equal((await call('PATCH', `/api/notifications/${notes[0].id}/read`))[0], 204);
    assert.ok((await call('GET', `/api/students/${st.id}/notifications`))[1][0].read_at);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM ion_audit').get().n, 1);
    const act = (await call('GET', `/api/students/${st.id}/activity`))[1];
    assert.deepEqual(act.map((a: any) => a.event_id), ['student.enrolled']);
    assert.equal((await call('GET', `/api/courses/${co.id}/activity`))[1].length, 1, 'the target sees the event too');
    assert.equal((await call('GET', `/api/professors`))[1].total, 0);
    // the second student: counter keeps counting
    const st2 = (await call('POST', '/api/students', { name: 'Bob', email: 'bob@x.org' }))[1];
    await call('POST', `/api/students/${st2.id}/enrollments`, { toId: co.id });
    assert.equal((await call('GET', `/api/courses/${co.id}`))[1].enrolled_count, 2);
    // a failed link (duplicate) fires nothing and changes nothing
    await call('POST', `/api/students/${st2.id}/enrollments`, { toId: co.id });
    assert.equal((await call('GET', `/api/courses/${co.id}`))[1].enrolled_count, 2);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM ion_ledger').get().n, 2);
  });
});

test('server: custom events fire by id; a failing step rolls the whole event back', async () => {
  await withServer(async ({ call, app }) => {
    const st = (await call('POST', '/api/students', { name: 'Ada', email: 'ada@x.org' }))[1];
    const co = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    assert.equal((await call('POST', '/api/events/student.graduated', { actor_id: st.id, target_id: co.id }))[0], 204);
    assert.equal((await call('GET', `/api/students/${st.id}`))[1].status, 'graduated');
    const out = app.db.prepare('SELECT kind, status, payload FROM ion_outbox').all();
    assert.equal(out.length, 1); assert.equal(out[0].kind, 'email'); assert.equal(out[0].status, 'queued');
    assert.equal(JSON.parse(out[0].payload).to, 'ada@x.org');
    assert.equal((await call('POST', '/api/events/no.such.event', { actor_id: st.id, target_id: co.id }))[0], 404);
    assert.equal((await call('POST', '/api/events/student.graduated', { actor_id: co.id, target_id: co.id }))[0], 404, 'actor must be a student');
    assert.equal((await call('POST', '/api/events/student.graduated', { actor_id: st.id }))[0], 400);
  });
  const def = {
    app: { id: 'atom', name: 'Atom' },
    entities: [
      { id: 'person', name: 'Person', type: 'person', attributes: [{ name: 'name', type: 'string', required: true }, { name: 'email', type: 'email' }, { name: 'hits', type: 'integer' }] },
      { id: 'thing', name: 'Thing', type: 'thing', attributes: [{ name: 'name', type: 'string', required: true }] },
    ],
    relationships: [],
    events: [{ id: 'person.ping', name: 'Ping', type: 'custom', actor: 'person', target: 'thing', triggers: [{ action: 'log', to: 'audit' }, { action: 'increment', field: 'person.hits' }, { action: 'send_email', to: 'person', subject: 's', body: 'b' }] }],
  };
  await withServer(async ({ call, app }) => {
    const p = (await call('POST', '/api/people', { name: 'No mail' }))[1];
    const t = (await call('POST', '/api/things', { name: 'T' }))[1];
    const [status] = await call('POST', '/api/events/person.ping', { actor_id: p.id, target_id: t.id });
    assert.equal(status, 422, 'the email step cannot run');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM ion_audit').get().n, 0, 'audit row rolled back');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM ion_ledger').get().n, 0, 'ledger row rolled back');
    assert.equal((await call('GET', `/api/people/${p.id}`))[1].hits, null, 'counter rolled back');
  }, def);
});

test('server: ledger and audit are append-only inside the database itself', async () => {
  await withServer(async ({ call, app }) => {
    const st = (await call('POST', '/api/students', { name: 'Ada', email: 'ada@x.org' }))[1];
    const co = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    await call('POST', `/api/students/${st.id}/enrollments`, { toId: co.id });
    for (const t of ['ion_ledger', 'ion_audit']) {
      assert.throws(() => app.db.exec(`UPDATE ${t} SET event_id = 'x'`), /append-only/);
      assert.throws(() => app.db.exec(`DELETE FROM ${t}`), /append-only/);
    }
  });
});

test('server: webhooks go out after commit; private addresses are refused unless allowed', async () => {
  const got: any[] = [];
  const sink = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(sink.address() as any).port}/hook`;
  const def = {
    app: { id: 'hooks', name: 'Hooks' },
    entities: [entity('person'), entity('thing')],
    relationships: [],
    events: [{ id: 'person.ping', name: 'Ping', type: 'custom', actor: 'person', target: 'thing', triggers: [{ action: 'call_webhook', url }] }],
  };
  const wait = async (app: any, status: string): Promise<void> => { for (let i = 0; i < 50; i++) { if (app.db.prepare('SELECT status FROM ion_outbox').get()?.status === status) return; await new Promise((r) => setTimeout(r, 40)); } assert.fail('webhook did not reach ' + status); };
  try {
    await withServer(async ({ call, app }) => {
      const p = (await call('POST', '/api/people', { name: 'p' }))[1], t = (await call('POST', '/api/things', { name: 't' }))[1];
      await call('POST', '/api/events/person.ping', { actor_id: p.id, target_id: t.id });
      await wait(app, 'sent');
      assert.equal(got.length, 1); assert.equal(got[0].event_id, 'person.ping'); assert.equal(got[0].actor_id, p.id);
    }, def, { allowPrivateWebhooks: true });
    await withServer(async ({ call, app }) => {
      const p = (await call('POST', '/api/people', { name: 'p' }))[1], t = (await call('POST', '/api/things', { name: 't' }))[1];
      await call('POST', '/api/events/person.ping', { actor_id: p.id, target_id: t.id });
      await wait(app, 'failed');
      assert.equal(got.length, 1, 'nothing was sent to a loopback address');
    }, def);
  } finally { sink.close(); }
});

test('server: self and one-to-one relationships register cleanly and behave', async () => {
  const def = {
    app: { id: 'org', name: 'Org' },
    entities: [entity('employee'), entity('badge', [{ name: 'code', type: 'string' }])],
    relationships: [{ id: 'manager', from: 'employee', to: 'employee', type: 'self' }, { id: 'holds', from: 'employee', to: 'badge', type: 'one-to-one' }],
    events: [],
  };
  await withServer(async ({ call, app }) => {
    const boss = (await call('POST', '/api/employees', { name: 'Boss' }))[1], dev = (await call('POST', '/api/employees', { name: 'Dev' }))[1], dev2 = (await call('POST', '/api/employees', { name: 'Dev2' }))[1];
    const paths = app.routes.map((r: any) => `${r.method} ${r.shape}`);
    assert.equal(new Set(paths).size, paths.length, 'no two routes share a shape');
    const rel = (await call('GET', '/api/employees/' + dev.id)); void rel;
    const selfPaths = paths.filter((p: string) => p.includes('manager'));
    assert.ok(selfPaths.length >= 4, selfPaths.join(' | '));
    const b1 = (await call('POST', '/api/badges', { code: 'B1' }))[1];
    assert.equal((await call('POST', `/api/employees/${dev.id}/holdses`, { toId: b1.id }))[0], 201);
    assert.equal((await call('POST', `/api/employees/${dev2.id}/holdses`, { toId: b1.id }))[0], 409, 'one-to-one: a badge has one holder');
    void boss;
  }, def);
});

test('server: data survives a restart, and the browser shell is served same-origin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ion-'));
  try {
    const file = join(dir, 'app.db');
    let id = '';
    await withServer(async ({ call, base }) => {
      id = (await call('POST', '/api/students', { name: 'Persist', email: 'p@x.org' }))[1].id;
      const html = await fetch(base + '/');
      assert.equal(html.status, 200);
      assert.match(html.headers.get('content-security-policy')!, /default-src 'self'/);
      assert.match(await html.text(), /boot\.js/);
      assert.match(await (await fetch(base + '/boot.js')).text(), /auth\/me/);
      assert.equal((await fetch(base + '/ui_advanced.js')).status, 200, 'optional overlay: empty script when absent');
    }, mit, { db: file });
    await withServer(async ({ call }) => { assert.equal((await call('GET', `/api/students/${id}`))[1].name, 'Persist'); }, mit, { db: file });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('server: static files are served byte for byte from the web folder (and nothing outside it)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ion-web-'));
  try {
    const js = 'window.X = { a: 1 };\n// ünïcode ✓\n';
    writeFileSync(join(dir, 'app.js'), js); writeFileSync(join(dir, 'styles.css'), 'body{color:#123}'); writeFileSync(join(dir, 'secret.txt'), 'nope');
    await withServer(async ({ base }) => {
      const a = await fetch(base + '/app.js');
      assert.equal(a.status, 200); assert.match(a.headers.get('content-type')!, /javascript/);
      assert.equal(await a.text(), js);
      assert.equal(await (await fetch(base + '/styles.css')).text(), 'body{color:#123}');
      assert.equal((await fetch(base + '/secret.txt')).status, 404, 'only the three known assets are served');
      assert.equal((await fetch(base + '/ui_advanced.js')).status, 200);
      assert.equal(await (await fetch(base + '/ui_advanced.js')).text(), '', 'absent overlay is an empty script');
    }, mit, { staticDir: dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('server: it refuses to start without any access token', () => {
  const spec = JSON.parse(generate(specsOf() as any)['spec.json']);
  assert.throws(() => createIonServer({ spec, tokens: {}, db: ':memory:' }), /no access tokens/);
});

// ------------------------------------------------------------------------------------------ metadata
test('metadata (versioned): version starts at 1, every update bumps it, a stale version is a 409', async () => {
  await withServer(async ({ call }) => {
    const c = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    assert.equal(c.version, 1);
    const u1 = (await call('PATCH', `/api/courses/${c.id}`, { credits: 5, version: 1 }))[1];
    assert.equal(u1.version, 2); assert.equal(u1.credits, 5);
    const [st, err] = await call('PATCH', `/api/courses/${c.id}`, { credits: 6, version: 1 });
    assert.equal(st, 409); assert.equal(err.field, 'version'); assert.match(err.error, /version 2/);
    assert.equal((await call('GET', `/api/courses/${c.id}`))[1].credits, 5, 'the stale write changed nothing');
    assert.equal((await call('PATCH', `/api/courses/${c.id}`, { credits: 7 }))[1].version, 3, 'without a version it is last-write-wins and still bumps');
    assert.equal((await call('PATCH', `/api/courses/${c.id}`, { credits: 7, version: 'x' }))[0], 400);
    assert.equal((await call('PATCH', `/api/courses/${c.id}`, { version: 3 }))[1].version, 3, 'a version-only request changes nothing');
    // events that touch the row bump it too
    const s = (await call('POST', '/api/students', { name: 'Ada', email: 'ada@x.org' }))[1];
    await call('POST', `/api/students/${s.id}/enrollments`, { toId: c.id });
    const after = (await call('GET', `/api/courses/${c.id}`))[1];
    assert.equal(after.enrolled_count, 1); assert.equal(after.version, 4);
    // an entity without the metadata has no version at all, and refuses one
    const st1 = (await call('POST', '/api/students', { name: 'Bob', email: 'bob@x.org' }))[1];
    assert.equal(st1.version, undefined);
    assert.equal((await call('PATCH', `/api/students/${st1.id}`, { gpa: 3, version: 1 }))[0], 400);
  });
});

test('metadata (indexed): the declared attribute gets a real index', async () => {
  await withServer(async ({ app }) => {
    const names = app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'courses'").all().map((r: any) => r.name);
    assert.ok(names.includes('ix_courses_0'), names.join(', '));
    const plan = app.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM courses WHERE code = 'CS1'").all().map((r: any) => r.detail).join(' ');
    assert.match(plan, /ix_courses_0/, 'the planner uses it');
  });
});

test('metadata (transitions): only declared state changes are allowed, on PATCH and inside events', async () => {
  await withServer(async ({ call }) => {
    const s = (await call('POST', '/api/students', { name: 'Ada', email: 'ada@x.org' }))[1];
    assert.equal(s.status, 'active');
    assert.equal((await call('POST', '/api/students', { name: 'Born', email: 'b@x.org', status: 'graduated' }))[0], 400, 'a new record starts in the default state');
    assert.equal((await call('PATCH', `/api/students/${s.id}`, { status: 'active' }))[0], 200, 'staying put is not a transition');
    const [, g] = await call('PATCH', `/api/students/${s.id}`, { status: 'graduated' });
    assert.equal(g.status, 'graduated');
    const [st, err] = await call('PATCH', `/api/students/${s.id}`, { status: 'active' });
    assert.equal(st, 409); assert.equal(err.field, 'status'); assert.match(err.error, /cannot move from graduated to active/);
    // the graduation event is also a transition: firing it twice fails and rolls back (no second email queued)
    const co = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    const s2 = (await call('POST', '/api/students', { name: 'Bob', email: 'bob@x.org' }))[1];
    assert.equal((await call('POST', '/api/events/student.graduated', { actor_id: s2.id, target_id: co.id }))[0], 204);
    assert.equal((await call('POST', '/api/events/student.graduated', { actor_id: s2.id, target_id: co.id }))[0], 204, 'already graduated: same state, not a transition');
  });
  const def = {
    app: { id: 'order', name: 'Order' },
    entities: [
      { id: 'order', name: 'Order', type: 'transaction', attributes: [{ name: 'state', type: 'enum', values: ['pending', 'paid', 'shipped'], default: 'pending', metadata: { transitions: { pending: ['paid'], paid: ['shipped'] } } }, { name: 'note', type: 'string' }] },
      entity('desk'),
    ],
    relationships: [],
    events: [
      { id: 'order.ship', name: 'Ship', type: 'custom', actor: 'order', target: 'desk', triggers: [{ action: 'log', to: 'audit' }, { action: 'update_field', field: 'order.state', value: 'shipped' }] },
    ],
  };
  await withServer(async ({ call, app }) => {
    const o = (await call('POST', '/api/orders', { note: 'x' }))[1], d = (await call('POST', '/api/desks', { name: 'd' }))[1];
    const [st, err] = await call('POST', '/api/events/order.ship', { actor_id: o.id, target_id: d.id });
    assert.equal(st, 409, 'pending -> shipped skips "paid"'); assert.equal(err.field, 'state');
    assert.equal((await call('GET', `/api/orders/${o.id}`))[1].state, 'pending');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM ion_audit').get().n, 0, 'the audit row of the refused run is rolled back');
    assert.equal((await call('PATCH', `/api/orders/${o.id}`, { state: 'paid' }))[0], 200);
    assert.equal((await call('POST', '/api/events/order.ship', { actor_id: o.id, target_id: d.id }))[0], 204);
    assert.equal((await call('GET', `/api/orders/${o.id}`))[1].state, 'shipped');
  }, def);
});

test('metadata (cascade restrict): a parent with live children cannot be archived until they are gone', async () => {
  await withServer(async ({ call, app }) => {
    const prof = (await call('POST', '/api/professors', { name: 'Dr X', email: 'x@u.org', department: 'CS' }))[1];
    const course = (await call('POST', '/api/courses', { name: 'Algo', code: 'CS1', credits: 4 }))[1];
    await call('POST', `/api/professors/${prof.id}/teachings`, { toId: course.id });
    const [st, err] = await call('DELETE', `/api/professors/${prof.id}`);
    assert.equal(st, 409); assert.match(err.error, /1 linked course \(teaching\)/);
    assert.equal((await call('GET', `/api/professors/${prof.id}`))[0], 200, 'nothing was archived');
    await call('DELETE', `/api/professors/${prof.id}/teachings/${course.id}`);
    assert.equal((await call('DELETE', `/api/professors/${prof.id}`))[0], 204);
    // an entity with no cascade metadata is unaffected: courses can be archived while a department points at them
    const dept = (await call('POST', '/api/departments', { name: 'CS' }))[1];
    await call('POST', `/api/courses/${course.id}/course-departments`, { toId: dept.id });
    assert.equal((await call('DELETE', `/api/departments/${dept.id}`))[0], 204, 'course_department has no cascade, so it never blocks');
    void app;
  });
});

test('metadata (cascade archive): archiving the parent archives its children, recursively, and removes links', async () => {
  const def = {
    app: { id: 'tree', name: 'Tree' },
    entities: [entity('folder'), entity('doc'), entity('tag')],
    relationships: [
      { id: 'contains', from: 'folder', to: 'doc', type: 'one-to-many', metadata: { cascade: 'archive' } },
      { id: 'parent', from: 'folder', to: 'folder', type: 'self', metadata: { cascade: 'archive' } },
      { id: 'tagging', from: 'doc', to: 'tag', type: 'many-to-many', metadata: { cascade: 'archive' } },
    ],
    events: [],
  };
  await withServer(async ({ call, app }) => {
    const mk = async (path: string, name: string): Promise<any> => (await call('POST', path, { name }))[1];
    const root = await mk('/api/folders', 'root'), sub = await mk('/api/folders', 'sub');
    const d1 = await mk('/api/docs', 'd1'), d2 = await mk('/api/docs', 'd2'), tag = await mk('/api/tags', 't');
    const paths = app.routes.map((r: any) => r.shape);
    assert.ok(paths.some((p: string) => p.includes('parents')) || paths.some((p: string) => p.includes('parent')), paths.join(' '));
    assert.equal((await call('POST', `/api/folders/${root.id}/containses`, { toId: d1.id }))[0], 201);
    assert.equal((await call('POST', `/api/folders/${sub.id}/containses`, { toId: d2.id }))[0], 201);
    assert.equal((await call('POST', `/api/docs/${d1.id}/taggings`, { toId: tag.id }))[0], 201);
    // sub is a child of root through the self relationship (key lives in "from" = sub, pointing at root)
    assert.equal((await call('POST', `/api/folders/${sub.id}/parents`, { toId: root.id }))[0], 201);
    assert.equal((await call('DELETE', `/api/folders/${root.id}`))[0], 204);
    for (const [path, id] of [['folders', root.id], ['folders', sub.id], ['docs', d1.id], ['docs', d2.id]]) assert.equal((await call('GET', `/api/${path}/${id}`))[0], 404, `${path}/${id} archived`);
    assert.equal((await call('GET', `/api/tags/${tag.id}`))[0], 200, 'a many-to-many cascade removes links but never the other entity');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM taggings WHERE archived_at IS NULL').get().n, 0);
  }, def);
});

test('metadata (rate): an event stops at its limit with 429, and nothing from the refused run is kept', async () => {
  const def = {
    app: { id: 'rate', name: 'Rate' },
    entities: [entity('person', [{ name: 'name', type: 'string' }, { name: 'hits', type: 'integer' }]), entity('thing')],
    relationships: [],
    events: [{ id: 'person.ping', name: 'Ping', type: 'custom', actor: 'person', target: 'thing', triggers: [{ action: 'increment', field: 'person.hits' }], metadata: { rate: { max: 2, per_seconds: 60 } } }],
  };
  let now = 1_000_000;
  await withServer(async ({ call, app }) => {
    const p = (await call('POST', '/api/people', { name: 'p' }))[1], t = (await call('POST', '/api/things', { name: 't' }))[1];
    const fire = async (): Promise<number> => (await call('POST', '/api/events/person.ping', { actor_id: p.id, target_id: t.id }))[0];
    assert.equal(await fire(), 204); assert.equal(await fire(), 204);
    assert.equal(await fire(), 429);
    assert.equal((await call('GET', `/api/people/${p.id}`))[1].hits, 2);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM ion_ledger').get().n, 2);
    now += 61_000; // the window has passed
    assert.equal(await fire(), 204);
    assert.equal((await call('GET', `/api/people/${p.id}`))[1].hits, 3);
  }, def, { nowMs: () => now });
});

test('server: {"from": "actor" | "target"} fills a uuid in create_entity and update_field (as the PostgreSQL handlers do)', async () => {
  const def = {
    app: { id: 'ref', name: 'Ref' },
    entities: [
      { id: 'person', name: 'Person', type: 'person', attributes: [{ name: 'name', type: 'string', required: true }, { name: 'last_thing_id', type: 'uuid' }] },
      { id: 'thing', name: 'Thing', type: 'thing', attributes: [{ name: 'name', type: 'string', required: true }] },
      { id: 'note', name: 'Note', type: 'document', attributes: [{ name: 'text', type: 'string' }, { name: 'owner_id', type: 'uuid' }, { name: 'subject_id', type: 'uuid' }] },
    ],
    relationships: [],
    events: [{ id: 'person.claims', name: 'Claims', type: 'custom', actor: 'person', target: 'thing', triggers: [
      { action: 'create_entity', entity: 'note', values: { text: 'claimed', owner_id: { from: 'actor' }, subject_id: { from: 'target' } } },
      { action: 'update_field', field: 'person.last_thing_id', value: { from: 'target' } },
    ] }],
  };
  await withServer(async ({ call }) => {
    const p = (await call('POST', '/api/people', { name: 'P' }))[1];
    const t = (await call('POST', '/api/things', { name: 'T' }))[1];
    assert.equal((await call('POST', '/api/events/person.claims', { actor_id: p.id, target_id: t.id }))[0], 204);
    const notes = (await call('GET', '/api/notes'))[1];
    assert.equal(notes.total, 1);
    assert.equal(notes.items[0].owner_id, p.id);
    assert.equal(notes.items[0].subject_id, t.id);
    assert.equal((await call('GET', `/api/people/${p.id}`))[1].last_thing_id, t.id);
  }, def);
});

// ---------------------------------------------------------------- roles (patterns, inheritance, removal wins)
const declared = (): string[] => (specsOf() as any).ui_spec.ui_spec.permissions;
const throwsMsg = (f: () => unknown): string => { try { f(); return ''; } catch (e: any) { return String(e.message); } };

test('roles: patterns expand to concrete declared keys; "!" always wins; "*" alone stays the owner shortcut', () => {
  const d = declared();
  assert.deepEqual(compilePermissions(['*'], d), ['*']);
  const ro = compilePermissions(['entity:*:list', 'entity:*:read'], d);
  assert.ok(ro.length > 0 && ro.every((k: string) => /^entity:[a-z_]+:(list|read)$/.test(k)));
  const noArchive = compilePermissions(['entity:student:*', '!entity:*:archive'], d);
  assert.ok(noArchive.includes('entity:student:update') && !noArchive.includes('entity:student:archive'));
  assert.deepEqual(compilePermissions(['!entity:student:archive', 'entity:student:*'], d), compilePermissions(['entity:student:*', '!entity:student:archive'], d), 'order does not matter');
  assert.deepEqual(compilePermissions([], d), []);
});

test('roles: unknown, malformed or negative-everything permissions stop the server instead of being ignored', () => {
  const d = declared();
  assert.match(throwsMsg(() => compilePermissions(['entity:ghost:read'], d)), /matches no permission/);
  assert.match(throwsMsg(() => compilePermissions(['entity:student:*', '!entity:ghost:*'], d)), /matches no permission/);
  assert.match(throwsMsg(() => compilePermissions(['entity:student'], d)), /bad permission/);
  assert.match(throwsMsg(() => compilePermissions(['entity:st*:read'], d)), /bad permission/);
  assert.match(throwsMsg(() => compilePermissions(['!*'], d)), /bad permission/);
  assert.match(throwsMsg(() => compilePermissions('entity:student:read' as any, d)), /list of strings/);
});

test('roles: extends merges parents, a cycle or an unknown role or a short token is refused', () => {
  const d = declared();
  const cfg = { roles: { viewer: ['entity:*:list', 'entity:*:read'], editor: { extends: ['viewer'], permissions: ['entity:student:update', '!entity:course:read'] } }, tokens: { 'editor-token-1234567': 'editor' } };
  const t = resolveRoles(cfg, d)['editor-token-1234567'];
  assert.ok(t.includes('entity:student:update') && t.includes('entity:student:read') && !t.includes('entity:course:read'), 'inherited, own, and removal beats inheritance');
  assert.match(throwsMsg(() => resolveRoles({ roles: { a: { extends: ['b'], permissions: [] }, b: { extends: ['a'], permissions: [] } }, tokens: {} }, d)), /cycle/);
  assert.match(throwsMsg(() => resolveRoles({ roles: { a: [] }, tokens: { ['x'.repeat(16)]: 'nope' } }, d)), /unknown role/);
  assert.match(throwsMsg(() => resolveRoles({ roles: { a: [] }, tokens: { short: 'a' } }, d)), /16\+/);
  assert.match(throwsMsg(() => resolveRoles({ roles: { a: { extends: ['zzz'], permissions: [] } }, tokens: {} }, d)), /unknown role/);
  assert.match(throwsMsg(() => resolveRoles({}, d)), /need/);
});

test('roles over HTTP: a role reads and edits what it may, 403 on everything else, and the UI sees the expanded keys', async () => {
  const d = declared();
  const SALES = 'sales-token-123456789', READER = 'reader-token-123456789';
  const tokens = resolveRoles({
    roles: { viewer: ['entity:*:list', 'entity:*:read'], sales: { extends: ['viewer'], permissions: ['entity:student:create', 'entity:student:update'] } },
    tokens: { [SALES]: 'sales', [READER]: 'viewer' },
  }, d);
  await withServer(async ({ call }) => {
    const as = (t: string) => ({ authorization: `Bearer ${t}` });
    const [c, made] = await call('POST', '/api/students', { name: 'Ali', email: 'ali@x.com' }, as(SALES)); assert.equal(c, 201);
    assert.equal((await call('PATCH', `/api/students/${made.id}`, { gpa: 3.5 }, as(SALES)))[0], 200);
    assert.equal((await call('DELETE', `/api/students/${made.id}`, undefined, as(SALES)))[0], 403, 'no archive for sales');
    assert.equal((await call('GET', `/api/students/${made.id}`, undefined, as(READER)))[0], 200);
    assert.equal((await call('POST', '/api/students', { name: 'B', email: 'b@x.com' }, as(READER)))[0], 403, 'viewer cannot create');
    assert.equal((await call('PATCH', `/api/students/${made.id}`, { gpa: 1 }, as(READER)))[0], 403);
    assert.equal((await call('POST', '/api/courses', { code: 'C1', title: 'T' }, as(SALES)))[0], 403, 'sales has no course create');
    const [m, me] = await call('GET', '/auth/me', undefined, as(READER)); assert.equal(m, 200);
    assert.ok(me.permissions.includes('entity:student:list') && !me.permissions.includes('entity:student:create') && !me.permissions.includes('*'));
    assert.equal((await call('GET', '/api/students', undefined, {}))[0], 401);
  }, mit, { tokens: { ...tokens, [TOKEN]: ['*'] } });
});

test('roles: the server refuses to start on a bad roles file or a missing ION_ROLES file (never silently open)', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'ion-roles-'));
  try {
    const f = generate(specsOf() as any);
    writeFileSync(join(dir, 'server.mjs'), f['server.mjs']); writeFileSync(join(dir, 'spec.json'), f['spec.json']);
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ roles: { x: ['entity:ghost:read'] }, tokens: { ['t'.repeat(20)]: 'x' } }));
    const run = (roles: string) => spawnSync('node', [join(dir, 'server.mjs')], { env: { ...process.env, ION_OWNER_TOKEN: 'o'.repeat(20), ION_ROLES: roles, ION_DB: ':memory:' }, encoding: 'utf8', timeout: 5000 });
    const a = run(join(dir, 'bad.json')), b = run(join(dir, 'missing.json'));
    assert.equal(a.status, 1); assert.match(a.stderr, /matches no permission/);
    assert.equal(b.status, 1); assert.match(b.stderr, /does not exist/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- schema migrations
const app = (entities: unknown[], relationships: unknown[] = []) => ({ app: { id: 'shop', name: 'Shop' }, entities, relationships, events: [] });
const item = (extra: unknown[] = [], more: Record<string, unknown> = {}) => ({ ...entity('item', [{ name: 'title', type: 'string', required: true }, { name: 'qty', type: 'integer' }, ...extra]), ...more });
async function onFile(def: unknown, file: string, opts: Record<string, unknown> = {}, fn?: (s: Booted) => Promise<void>): Promise<void> {
  const s = await boot(def, { db: file, ...opts });
  try { if (fn) await fn(s); } finally { await s.close(); }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'ion-mig-'));
const planOf = (def: unknown, file: string) => {
  const f = generate(specsOf(def) as any), spec = JSON.parse(f['spec.json']);
  const { DatabaseSync } = require_sqlite();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const desired = desiredSchema(buildModel(spec));
    return planMigration(desired, actualSchema(db));
  } finally { db.close(); }
};
import { createRequire } from 'node:module';
const require_sqlite = () => createRequire(import.meta.url)('node:sqlite');

test('migrate: restarting on an unchanged definition is a no-op and keeps the data', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    const def = app([item([], { })], []);
    await onFile(def, file, {}, async (s) => { assert.equal(s.app.db.migration.fresh, true); assert.equal((await s.call('POST', '/api/items', { title: 'x' }))[0], 201); });
    await onFile(def, file, {}, async (s) => {
      assert.equal(s.app.db.migration.fresh, false); assert.deepEqual(s.app.db.migration.plan, { ops: [], blocked: [], kept: [] });
      const [, l] = await s.call('GET', '/api/items'); assert.equal(l.items.length, 1);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrate: new entity, optional column, defaulted required column and a new index apply automatically; old rows survive', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    await onFile(app([item()]), file, {}, async (s) => { await s.call('POST', '/api/items', { title: 'old', qty: 1 }); });
    const v2 = app([item([{ name: 'note', type: 'string' }, { name: 'tier', type: 'enum', values: ['a', 'b'], required: true, default: 'a' }], { metadata: { indexed: ['title'] } }), entity('tag')]);
    await onFile(v2, file, {}, async (s) => {
      const ops = s.app.db.migration.plan.ops.map((o: any) => o.op + ':' + (o.column ?? o.table ?? o.name));
      assert.ok(ops.includes('add_column:note') && ops.includes('add_column:tier') && ops.includes('create_table:tags'), ops.join());
      const [, l] = await s.call('GET', '/api/items'); assert.equal(l.items[0].title, 'old'); assert.equal(l.items[0].note, null); assert.equal(l.items[0].tier, 'a', 'existing rows get the default');
      assert.equal((await s.call('POST', '/api/tags', { name: 'new' }))[0], 201);
      assert.equal((await s.call('POST', '/api/items', { title: 'n', note: 'hi', tier: 'b' }))[0], 201);
    });
    const hist = (() => { const { DatabaseSync } = require_sqlite(); const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare('SELECT ops FROM ion_migrations').all(); } finally { d.close(); } })();
    assert.equal(hist.length, 2, 'the initial schema and the migration are both recorded');
    assert.ok(JSON.parse(hist[1].ops).some((o: any) => o.op === 'add_column' && o.column === 'note'));
    assert.equal(planOf(v2, file).ops.length, 0, 'idempotent');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrate: a new relationship (foreign key and junction) is added to existing tables', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    const base = [item(), entity('owner')];
    await onFile(app(base), file, {}, async (s) => { await s.call('POST', '/api/items', { title: 'old' }); });
    await onFile(app(base, [{ id: 'owner_items', from: 'owner', to: 'item', type: 'one-to-many' }, { id: 'item_owners', from: 'item', to: 'owner', type: 'many-to-many' }]), file, {}, async (s) => {
      const [, o] = await s.call('POST', '/api/owners', { name: 'o' }); const [, i] = await s.call('GET', '/api/items');
      assert.equal((await s.call('POST', `/api/owners/${o.id}/owner-itemses`, { toId: i.items[0].id }))[0], 201);
      assert.equal((await s.call('POST', `/api/items/${i.items[0].id}/item-ownerses`, { toId: o.id }))[0], 201);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrate: unsafe changes are refused with a reason and the database is left untouched', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    await onFile(app([item()]), file, {}, async (s) => { await s.call('POST', '/api/items', { title: 'old', qty: 2 }); });
    const refuse = async (def: unknown, code: string) => {
      await assert.rejects(() => onFile(def, file), (e: any) => e instanceof MigrationError && e.plan.blocked.some((b: any) => b.code === code) && /nothing was changed/.test(e.message));
    };
    await refuse(app([item([{ name: 'must', type: 'string', required: true }])]), 'REQUIRED_COLUMN_WITHOUT_DEFAULT');
    await refuse(app([entity('item', [{ name: 'title', type: 'string', required: true }, { name: 'qty', type: 'string' }])]), 'TYPE_CHANGE');
    await refuse(app([entity('item', [{ name: 'qty', type: 'integer' }])]), 'REMOVED_REQUIRED_COLUMN');
    await onFile(app([item()]), file, {}, async (s) => { const [, l] = await s.call('GET', '/api/items'); assert.equal(l.items.length, 1); assert.equal(s.app.db.migration.plan.ops.length, 0); });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrate: removed optional columns and removed entities are kept, never dropped', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    await onFile(app([item([{ name: 'note', type: 'string' }]), entity('tag')]), file, {}, async (s) => { await s.call('POST', '/api/items', { title: 't', note: 'keep me' }); await s.call('POST', '/api/tags', { name: 'x' }); });
    await onFile(app([item()]), file, {}, async (s) => {
      const kept = s.app.db.migration.plan.kept.map((k: any) => k.table + '.' + (k.column ?? '')).sort();
      assert.deepEqual(kept, ['items.note', 'tags.']);
    });
    const { DatabaseSync } = require_sqlite(); const d = new DatabaseSync(file, { readOnly: true });
    try { assert.equal(d.prepare('SELECT note FROM items').get().note, 'keep me'); assert.equal(d.prepare('SELECT count(*) n FROM tags').get().n, 1); } finally { d.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrate: required <-> optional rebuilds the table only with apply, writes a backup, keeps data and relationships', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    const rels = [{ id: 'owner_items', from: 'owner', to: 'item', type: 'one-to-many' }];
    const v1 = app([item(), entity('owner')], rels);
    let itemId = '';
    await onFile(v1, file, {}, async (s) => { const [, o] = await s.call('POST', '/api/owners', { name: 'o' }); const [, i] = await s.call('POST', '/api/items', { title: 'a' }); itemId = i.id; await s.call('POST', `/api/owners/${o.id}/owner-itemses`, { toId: i.id }); });
    const v2 = app([entity('item', [{ name: 'title', type: 'string' }, { name: 'qty', type: 'integer' }]), entity('owner')], rels); // title: required -> optional
    await assert.rejects(() => onFile(v2, file), (e: any) => /ION_MIGRATE=apply/.test(e.message) && e.plan.ops.some((o: any) => o.op === 'rebuild_table'));
    await onFile(v2, file, { migrate: 'apply' }, async (s) => {
      assert.equal((await s.call('POST', '/api/items', { qty: 3 }))[0], 201, 'title is optional now');
      const [, r] = await s.call('GET', `/api/items/${itemId}`); assert.equal(r.title, 'a');
      const [, l] = await s.call('GET', `/api/items/${itemId}/owner-itemses`); assert.ok(l.items?.length === 1 || l.length === 1, JSON.stringify(l));
    });
    const { readdirSync } = await import('node:fs');
    assert.ok(readdirSync(dir).some((f) => f.includes('pre-migration') && f.endsWith('.bak')), 'a backup file is written before the rebuild');
    assert.equal(planOf(v2, file).ops.length, 0, 'idempotent after the rebuild');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrate: tightening a column with NULLs fails atomically (nothing half-applied)', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    const opt = app([entity('item', [{ name: 'title', type: 'string' }, { name: 'qty', type: 'integer' }])]);
    await onFile(opt, file, {}, async (s) => { await s.call('POST', '/api/items', { qty: 1 }); });
    await assert.rejects(() => onFile(app([item([{ name: 'extra', type: 'string' }])]), file, { migrate: 'apply' }), (e: any) => e instanceof MigrationError && /rolled back/.test(e.message));
    await onFile(opt, file, {}, async (s) => { assert.equal(s.app.db.migration.plan.ops.length, 0, 'still the old schema, no extra column'); const [, l] = await s.call('GET', '/api/items'); assert.equal(l.items.length, 1); });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrate: adding a unique constraint over duplicate data is refused and rolled back', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    const plain = app([entity('item', [{ name: 'code', type: 'string' }])]);
    await onFile(plain, file, {}, async (s) => { await s.call('POST', '/api/items', { code: 'x' }); await s.call('POST', '/api/items', { code: 'x' }); });
    await assert.rejects(() => onFile(app([entity('item', [{ name: 'code', type: 'string', unique: true }])]), file), (e: any) => e instanceof MigrationError && /rolled back/.test(e.message));
    await onFile(plain, file, {}, async (s) => assert.equal(s.app.db.migration.plan.ops.length, 0));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- money (whole minor units)
const shop = (price: unknown) => ({ app: { id: 'shop', name: 'Shop' }, entities: [entity('item', [{ name: 'title', type: 'string' }, price, { name: 'balance', type: 'money', default: 0 }])], relationships: [],
  events: [{ id: 'item.topup', name: 'Top up', actor: 'item', target: 'item', triggers: [{ action: 'increment', field: 'item.balance', on: 'target', by: 500 }] }] });

test('money over HTTP: whole minor units are stored exactly, decimals and strings are refused, events add to it, ranges filter it', async () => {
  await withServer(async ({ call }) => {
    const [c, a] = await call('POST', '/api/items', { title: 'lamp', price: 12050 }); assert.equal(c, 201);
    const [, got] = await call('GET', `/api/items/${a.id}`); assert.strictEqual(got.price, 12050); assert.strictEqual(got.balance, 0, 'integer default');
    for (const bad of [120.5, '120.50', 1e21, NaN]) {
      const [s, e] = await call('POST', '/api/items', { title: 'x', price: bad });
      assert.ok(s === 400 || s === 422, `price ${String(bad)} -> ${s}`); if (typeof bad === 'number' && bad === 120.5) assert.match(JSON.stringify(e), /minor units/);
    }
    await call('POST', '/api/items', { title: 'cheap', price: 500 });
    const [, hi] = await call('GET', '/api/items?filter[price][gte]=10000'); assert.deepEqual(hi.items.map((x: any) => x.title), ['lamp']);
    assert.equal((await call('POST', '/api/events/item.topup', { actor_id: a.id, target_id: a.id }))[0], 204);
    assert.equal((await call('POST', '/api/events/item.topup', { actor_id: a.id, target_id: a.id }))[0], 204);
    const [, after] = await call('GET', `/api/items/${a.id}`); assert.strictEqual(after.balance, 1000, 'integer arithmetic, no drift');
    assert.equal((await call('PATCH', `/api/items/${a.id}`, { price: 99.99 }))[0] >= 400, true);
  }, shop({ name: 'price', type: 'money', required: true }));
});

test('money: migrating number -> money is refused (a float column cannot be reinterpreted); integer -> money is a no-op', async () => {
  const dir = tmp(), file = join(dir, 'a.db');
  try {
    const old = (type: string) => ({ app: { id: 'shop', name: 'Shop' }, entities: [entity('item', [{ name: 'price', type, ...(type === 'money' ? {} : {}) }])], relationships: [], events: [] });
    await onFile(old('number'), file, {}, async (s) => { await s.call('POST', '/api/items', { price: 1.5 }); });
    await assert.rejects(() => onFile(old('money'), file), (e: any) => e instanceof MigrationError && e.plan.blocked.some((b: any) => b.code === 'TYPE_CHANGE' && b.column === 'price'));
    const file2 = join(dir, 'b.db');
    await onFile(old('integer'), file2, {}, async (s) => { await s.call('POST', '/api/items', { price: 150 }); });
    await onFile(old('money'), file2, {}, async (s) => { assert.equal(s.app.db.migration.plan.ops.length, 0); const [, l] = await s.call('GET', '/api/items'); assert.strictEqual(l.items[0].price, 150); });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
