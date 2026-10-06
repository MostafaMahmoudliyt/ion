import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, columnSql, limitIdent } from './index.ts';
import { PG_URI, entity, freshDatabase, mit, specsOf } from '../../../test/helpers.ts';

const sql = (def: unknown = mit) => generate(specsOf(def));

test('sql-postgres: spec example (section 48) becomes the documented CREATE TABLE', () => {
  const out = sql({ entities: [{ id: 'student', name: 'Student', type: 'person', attributes: [{ name: 'name', type: 'string', required: true }] }] });
  assert.deepEqual(Object.keys(out), ['0001_schema.sql', '0002_relationships.sql']);
  assert.match(out['0001_schema.sql'], /CREATE TABLE students \(\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\),\n  name TEXT NOT NULL,\n  created_at TIMESTAMP NOT NULL DEFAULT NOW\(\),\n  archived_at TIMESTAMP\n\);/);
  assert.match(out['0001_schema.sql'], /ALTER TABLE students ENABLE ROW LEVEL SECURITY;/);
});

test('sql-postgres: all 14 Ion types map to a PostgreSQL type', () => {
  const types = ['string', 'number', 'integer', 'boolean', 'date', 'timestamp', 'uuid', 'email', 'url', 'phone', 'json', 'array', 'enum', 'money'];
  const attrs = types.map((type) => ({ name: `a_${type}`, type, ...(type === 'enum' ? { values: ['x', 'y'] } : {}) }));
  const s = sql({ entities: [entity('t', attrs)] })['0001_schema.sql'];
  const want: Record<string, string> = { string: 'TEXT', number: 'NUMERIC', integer: 'INTEGER', boolean: 'BOOLEAN', date: 'DATE', timestamp: 'TIMESTAMP', uuid: 'UUID', email: 'TEXT', url: 'TEXT', phone: 'TEXT', json: 'JSONB', array: 'JSONB', enum: 'TEXT' , money: 'BIGINT' };
  for (const t of types) assert.match(s, new RegExp(`  a_${t} ${want[t]}\\b`), t);
  assert.match(s, /a_email TEXT CHECK \(a_email ~\* /);
  assert.match(s, /a_url TEXT CHECK \(a_url ~\* '\^https\?:\/\/'\)/);
  assert.match(s, /a_enum TEXT CHECK \(a_enum IN \('x', 'y'\)\)/);
});

test('sql-postgres: defaults, auto values and string escaping', () => {
  const s = sql({ entities: [entity('t', [
    { name: 'a', type: 'string', default: "it's" }, { name: 'b', type: 'integer', default: 5 }, { name: 'c', type: 'boolean', default: false },
    { name: 'd', type: 'timestamp', auto: true }, { name: 'e', type: 'date', auto: true }, { name: 'f', type: 'string', required: true, unique: true },
  ])] })['0001_schema.sql'];
  assert.match(s, /a TEXT DEFAULT 'it''s'/);
  assert.match(s, /b INTEGER DEFAULT 5/);
  assert.match(s, /c BOOLEAN DEFAULT FALSE/);
  assert.match(s, /d TIMESTAMP DEFAULT NOW\(\)/);
  assert.match(s, /e DATE DEFAULT CURRENT_DATE/);
  assert.match(s, /f TEXT NOT NULL UNIQUE/);
  assert.equal(columnSql({ name: 'x', type: 'integer', nullable: true }), 'x INTEGER');
});

test('sql-postgres: many-to-many junction, active-only unique index', () => {
  const s = sql()['0002_relationships.sql'];
  assert.match(s, /CREATE TABLE enrollments \(/);
  assert.match(s, /student_id UUID NOT NULL REFERENCES students \(id\)/);
  assert.match(s, /course_id UUID NOT NULL REFERENCES courses \(id\)/);
  assert.match(s, /grade NUMERIC,/);
  assert.match(s, /enrolled_on DATE DEFAULT CURRENT_DATE,/);
  assert.match(s, /CREATE UNIQUE INDEX uq_enrollments_student_id_course_id ON enrollments \(student_id, course_id\) WHERE archived_at IS NULL;/);
});

test('sql-postgres: foreign keys reuse declared columns and add missing ones', () => {
  const s = sql()['0002_relationships.sql'];
  assert.doesNotMatch(s, /ADD COLUMN professor_id/);
  assert.match(s, /ALTER TABLE courses ADD CONSTRAINT fk_courses_professor_id FOREIGN KEY \(professor_id\) REFERENCES professors \(id\);/);
  assert.match(s, /CREATE INDEX idx_courses_professor_id ON courses \(professor_id\);/);
  assert.match(s, /ALTER TABLE courses ADD COLUMN department_id UUID;/);
  assert.doesNotMatch(s, /ADD COLUMN faculty_id/);
});

test('sql-postgres: one-to-one is unique over active rows, self uses the relationship id, FK attributes are prefixed', () => {
  const s = sql({
    entities: [entity('user'), entity('profile'), entity('employee'), entity('team'), entity('player')],
    relationships: [
      { id: 'owns', from: 'user', to: 'profile', type: 'one-to-one' }, { id: 'manager', from: 'employee', to: 'employee', type: 'self' },
      { id: 'roster', from: 'team', to: 'player', type: 'one-to-many', attributes: [{ name: 'shirt', type: 'integer' }] },
    ],
  })['0002_relationships.sql'];
  assert.match(s, /ALTER TABLE users ADD COLUMN profile_id UUID;/);
  assert.match(s, /CREATE UNIQUE INDEX uq_users_profile_id ON users \(profile_id\) WHERE archived_at IS NULL;/);
  assert.match(s, /ALTER TABLE employees ADD COLUMN manager_id UUID;/);
  assert.match(s, /FOREIGN KEY \(manager_id\) REFERENCES employees \(id\);/);
  assert.match(s, /ALTER TABLE players ADD COLUMN roster_shirt INTEGER;/);
});

test('sql-postgres: long identifiers are shortened to 63 chars, deterministically', () => {
  const long = 'x'.repeat(30);
  const def = { entities: [entity(long + 'parent'), entity(long + 'child')], relationships: [{ id: 'r', from: long + 'parent', to: long + 'child', type: 'one-to-many' }] };
  const a = sql(def)['0002_relationships.sql'];
  assert.equal(a, sql(def)['0002_relationships.sql']);
  for (const m of a.matchAll(/(?:CONSTRAINT|INDEX) (\w+)/g)) assert.ok(m[1].length <= 63, m[1]);
  assert.equal(limitIdent('short'), 'short');
  assert.equal(limitIdent('y'.repeat(80)).length, 63);
});

test('sql-postgres: event system records are append-only where required', () => {
  const s = sql()['0003_events.sql'];
  assert.match(s, /CREATE TABLE ion_event_log \(/);
  assert.match(s, /CREATE TRIGGER ion_event_log_append_only BEFORE UPDATE OR DELETE ON ion_event_log/);
  assert.match(s, /CREATE TRIGGER ion_audit_log_append_only/);
  assert.doesNotMatch(s, /ion_notifications_append_only/);
  assert.match(s, /read_at TIMESTAMP,/);
});

test('sql-postgres: deterministic and free of timestamps', () => {
  assert.deepEqual(sql(), sql());
  assert.doesNotMatch(Object.values(sql()).join('\n'), /\b20\d\d-\d\d-\d\d/);
});

test('sql-postgres: the SQL really runs on PostgreSQL, and constraints hold', { skip: PG_URI ? false : 'set ION_PG_URI to run' }, async () => {
  const db = await freshDatabase('ion_sql_test');
  try {
    for (const [, content] of Object.entries(sql())) await db.pool.query(content);
    const q = async (text: string, p: unknown[] = []) => (await db.pool.query(text, p)).rows;
    const [stu] = await q("INSERT INTO students (name, email) VALUES ('Sara','sara@mit.test') RETURNING id, status, created_at");
    assert.equal(stu.status, 'active');
    await assert.rejects(q("INSERT INTO students (name, email) VALUES ('Dup','sara@mit.test')"), /unique/);
    await assert.rejects(q("INSERT INTO students (name, email) VALUES ('Bad','nope')"), /check/);
    await assert.rejects(q("INSERT INTO students (name, email, status) VALUES ('B','b@x.co','retired')"), /check/);
    const [course] = await q("INSERT INTO courses (name, code, credits) VALUES ('Algo','CS101',4) RETURNING id");
    await q('INSERT INTO enrollments (student_id, course_id) VALUES ($1,$2)', [stu.id, course.id]);
    await assert.rejects(q('INSERT INTO enrollments (student_id, course_id) VALUES ($1,$2)', [stu.id, course.id]), /unique/);
    await q('UPDATE enrollments SET archived_at = NOW()');
    await q('INSERT INTO enrollments (student_id, course_id) VALUES ($1,$2)', [stu.id, course.id]); // re-link after archive
    await assert.rejects(q('INSERT INTO courses (name, code, credits, professor_id) VALUES ($1,$2,1,$3)', ['X', 'X1', '00000000-0000-0000-0000-000000000000']), /foreign key/);
    await assert.rejects(q("INSERT INTO ion_event_log (event_id, actor_id, target_id) VALUES ('e', $1, $1)", [stu.id]).then(() => q('UPDATE ion_event_log SET event_id = $1', ['x'])), /append-only/);
    assert.equal((await q("SELECT relrowsecurity FROM pg_class WHERE relname = 'students'"))[0].relrowsecurity, true);
  } finally { await db.close(); }
});
