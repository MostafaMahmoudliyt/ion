import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTRIBUTE_TYPES, ENTITY_TYPES, EVENT_ACTIONS, EVENT_TYPES, RELATIONSHIP_TYPES, IonValidationError, buildSpecs,
  generateEventSpec, generateRelationshipSpec, generateSchemaSpec, generateUiSpec, loadSpecs, validateDefinition, validateSpecs,
} from '../src/index.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const mit = JSON.parse(readFileSync(new URL('../examples/mit.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const entity = (id: string, attributes: unknown[] = [{ name: 'name', type: 'string' }]) => ({ id, name: id[0].toUpperCase() + id.slice(1), type: 'custom', attributes });
const codes = (def: unknown): string[] => validateDefinition(def).map((i) => i.code);
const failsWith = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: any) => e instanceof IonValidationError && e.issues.some((i: any) => i.code === code), code);

// ---------------------------------------------------------------- constitution constants
test('constitution: the closed lists have the sizes the constitution fixes', () => {
  assert.equal(ENTITY_TYPES.length, 20);
  assert.equal(RELATIONSHIP_TYPES.length, 5);
  assert.equal(EVENT_TYPES.length, 4);
  assert.equal(EVENT_ACTIONS.length, 10);
  assert.equal(ATTRIBUTE_TYPES.length, 14);
});

// ---------------------------------------------------------------- Schema Engine -> schema_spec
test('schema_spec: describes tables with Ion types, never SQL', () => {
  const { schema_spec } = generateSchemaSpec({
    entities: [{ id: 'student', name: 'Student', type: 'person', attributes: [
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'email', required: true, unique: true },
      { name: 'status', type: 'enum', values: ['active', 'graduated'], default: 'active' },
      { name: 'enrolled_at', type: 'timestamp', auto: true },
    ] }],
  });
  const t = schema_spec.tables[0];
  assert.equal(t.table, 'students');
  assert.deepEqual(t.security, { row_level: true });
  assert.deepEqual(t.columns.map((c) => c.name), ['id', 'name', 'email', 'status', 'enrolled_at', 'created_at', 'archived_at']);
  assert.deepEqual(t.columns[0], { name: 'id', type: 'uuid', nullable: false, primary: true, auto: true, system: true });
  assert.deepEqual(t.columns[2], { name: 'email', type: 'email', nullable: false, unique: true });
  assert.deepEqual(t.columns[3], { name: 'status', type: 'enum', nullable: true, default: 'active', values: ['active', 'graduated'] });
  assert.deepEqual(t.columns[4], { name: 'enrolled_at', type: 'timestamp', nullable: true, auto: true });
  for (const c of t.columns) assert.ok((ATTRIBUTE_TYPES as readonly string[]).includes(c.type), `${c.name}: ${c.type}`);
});

test('schema_spec: table naming (plurals)', () => {
  const { schema_spec } = generateSchemaSpec({ entities: ['student', 'faculty', 'class', 'person', 'CourseSection', 'box'].map((id) => entity(id)) });
  assert.deepEqual(schema_spec.tables.map((t) => t.table), ['students', 'faculties', 'classes', 'people', 'course_sections', 'boxes']);
});

// ---------------------------------------------------------------- Validation
test('validation: rejects malformed definitions with machine-readable codes', () => {
  assert.deepEqual(codes(null), ['INVALID_DEFINITION']);
  assert.deepEqual(codes({}), ['MISSING_ENTITIES']);
  assert.ok(codes({ entities: [{ id: 'a', name: 'A', attributes: [] }] }).includes('INVALID_ENTITY_TYPE'));
  assert.ok(codes({ entities: [{ id: 'a', name: 'A', type: 'custom' }] }).includes('MISSING_ATTRIBUTES'));
  assert.ok(codes({ entities: [{ name: 'A', type: 'custom', attributes: [] }] }).includes('INVALID_ID'));
  assert.ok(codes({ entities: [{ id: 'a', type: 'custom', attributes: [] }] }).includes('MISSING_NAME'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'x', type: 'bigint' }])] }).includes('INVALID_ATTRIBUTE_TYPE'));
});

test('validation: identifiers cannot carry injection payloads', () => {
  assert.ok(codes({ entities: [{ id: 'a; DROP TABLE users', name: 'A', type: 'custom', attributes: [] }] }).includes('INVALID_ID'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'x); DROP TABLE users;--', type: 'string' }])] }).includes('INVALID_NAME'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'Mixed', type: 'string' }])] }).includes('INVALID_NAME'));
  failsWith(() => generateSchemaSpec({ entities: [entity('a b')] }), 'INVALID_ID');
});

test('validation: duplicates, reserved names, enum and default rules', () => {
  assert.ok(codes({ entities: [entity('a'), entity('A')] }).includes('DUPLICATE_ID'));
  assert.ok(codes({ entities: [entity('category'), entity('categorie')] }).includes('TABLE_NAME_CONFLICT'));
  assert.ok(codes({ entities: [entity('ion_log')] }).includes('RESERVED_NAMESPACE'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'x', type: 'string' }, { name: 'x', type: 'string' }])] }).includes('DUPLICATE_ATTRIBUTE'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'id', type: 'uuid' }])] }).includes('RESERVED_COLUMN'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'archived_at', type: 'timestamp' }])] }).includes('RESERVED_COLUMN'));
  assert.ok(codes({ entities: [entity('a', [{ name: 's', type: 'enum' }])] }).includes('INVALID_ENUM_VALUES'));
  assert.ok(codes({ entities: [entity('a', [{ name: 's', type: 'string', values: ['x'] }])] }).includes('VALUES_ON_NON_ENUM'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'n', type: 'integer', default: 1.5 }])] }).includes('INVALID_DEFAULT'));
  assert.ok(codes({ entities: [entity('a', [{ name: 'j', type: 'json', default: 'x' }])] }).includes('DEFAULT_NOT_SUPPORTED'));
  assert.ok(codes({ entities: [entity('a', [{ name: 't', type: 'string', auto: true }])] }).includes('INVALID_AUTO'));
  assert.ok(codes({ entities: [entity('a', [{ name: 't', type: 'timestamp', auto: true, default: 'x' }])] }).includes('AUTO_WITH_DEFAULT'));
});

test('validation: relationship rules', () => {
  const base = { entities: [entity('a'), entity('b')] };
  const rel = (r: object) => ({ ...base, relationships: [{ id: 'r', from: 'a', to: 'b', type: 'one-to-many', ...r }] });
  assert.deepEqual(codes(rel({})), []);
  assert.ok(codes(rel({ to: 'zzz' })).includes('UNKNOWN_ENTITY'));
  assert.ok(codes(rel({ type: 'many-to-lots' })).includes('INVALID_RELATIONSHIP_TYPE'));
  assert.ok(codes(rel({ type: 'self' })).includes('SELF_MISMATCH'));
  assert.ok(codes(rel({ to: 'a' })).includes('NON_SELF_SAME_ENTITY'));
  assert.ok(codes(rel({ attributes: [{ name: 'x', type: 'string', required: true }] })).includes('UNSUPPORTED_ON_FK_RELATIONSHIP'));
  assert.ok(codes({ ...base, relationships: [{ id: 'r', from: 'a', to: 'b', type: 'one-to-one' }, { id: 'R', from: 'a', to: 'b', type: 'one-to-one' }] }).includes('DUPLICATE_ID'));
  assert.ok(codes({ ...base, relationships: [{ id: 'a', from: 'a', to: 'b', type: 'many-to-many' }] }).includes('TABLE_NAME_CONFLICT'));
  assert.ok(codes({ ...base, relationships: [{ id: 'ion_x', from: 'a', to: 'b', type: 'one-to-one' }] }).includes('RESERVED_NAMESPACE'));
});

test('validation: relationship endpoints resolve by id or by unique name', () => {
  assert.deepEqual(codes({ entities: [entity('student'), entity('course')], relationships: [{ id: 'enr', from: 'Student', to: 'course', type: 'many-to-many' }] }), []);
});

// ---------------------------------------------------------------- Relationship Engine -> relationship_spec
const relOf = (def: unknown, id: string) => generateRelationshipSpec(def).relationship_spec.relationships.find((r) => r.id === id)!;

test('relationship_spec: many-to-many describes a junction, an active-only unique pair and 5 endpoints', () => {
  const r = relOf(mit, 'enrollment');
  assert.equal(r.foreign_key, undefined);
  assert.equal(r.junction!.table, 'enrollments');
  assert.deepEqual(r.junction!.columns, [{ name: 'student_id', references: 'students.id' }, { name: 'course_id', references: 'courses.id' }]);
  assert.deepEqual(r.junction!.attributes.map((a) => a.name), ['grade', 'enrolled_on']);
  assert.deepEqual(r.junction!.unique, [['student_id', 'course_id']]);
  assert.equal(r.junction!.active_only, true);
  assert.deepEqual(r.apis.map((a) => `${a.method} ${a.path}`), [
    'POST /api/students/:fromId/enrollments', 'GET /api/students/:fromId/enrollments', 'GET /api/courses/:toId/enrollments',
    'PATCH /api/students/:fromId/enrollments/:toId', 'DELETE /api/students/:fromId/enrollments/:toId',
  ]);
});

test('relationship_spec: one-to-many reuses a declared uuid column, many-to-one adds one', () => {
  const teaching = relOf(mit, 'teaching').foreign_key!;
  assert.deepEqual([teaching.table, teaching.column, teaching.references, teaching.create_column, teaching.index, teaching.unique], ['courses', 'professor_id', 'professors.id', false, true, false]);
  const dept = relOf(mit, 'course_department').foreign_key!;
  assert.deepEqual([dept.table, dept.column, dept.references, dept.create_column], ['courses', 'department_id', 'departments.id', true]);
  const fac = relOf(mit, 'department_faculty').foreign_key!;
  assert.deepEqual([fac.table, fac.column, fac.create_column], ['departments', 'faculty_id', false]);
});

test('relationship_spec: one-to-one is unique, self uses the relationship id, reverse path never clashes', () => {
  const def = { entities: [entity('user'), entity('profile'), entity('employee')], relationships: [
    { id: 'owns', from: 'user', to: 'profile', type: 'one-to-one' }, { id: 'manager', from: 'employee', to: 'employee', type: 'self' },
  ] };
  const owns = relOf(def, 'owns').foreign_key!;
  assert.deepEqual([owns.table, owns.column, owns.unique, owns.index], ['users', 'profile_id', true, false]);
  const mgr = relOf(def, 'manager');
  assert.deepEqual([mgr.foreign_key!.table, mgr.foreign_key!.column, mgr.foreign_key!.references], ['employees', 'manager_id', 'employees.id']);
  assert.ok(mgr.apis.some((a) => a.path === '/api/employees/:toId/managers-reverse'));
});

test('relationship_spec: attributes on FK relationships become prefixed columns', () => {
  const def = { entities: [entity('team'), entity('player')], relationships: [{ id: 'roster', from: 'team', to: 'player', type: 'one-to-many', attributes: [{ name: 'shirt', type: 'integer' }] }] };
  const fk = relOf(def, 'roster').foreign_key!;
  assert.deepEqual(fk.attributes.map((a) => [a.column, a.attribute.type]), [['roster_shirt', 'integer']]);
});

test('relationship_spec: conflicts and type mismatches are reported, not silently emitted', () => {
  failsWith(() => generateRelationshipSpec({ entities: [entity('a'), entity('b')], relationships: [{ id: 'r1', from: 'a', to: 'b', type: 'one-to-many' }, { id: 'r2', from: 'a', to: 'b', type: 'one-to-many' }] }), 'COLUMN_CONFLICT');
  failsWith(() => generateRelationshipSpec({ entities: [entity('a'), entity('b', [{ name: 'a_id', type: 'string' }])], relationships: [{ id: 'r', from: 'a', to: 'b', type: 'one-to-many' }] }), 'FK_COLUMN_TYPE_MISMATCH');
  failsWith(() => generateRelationshipSpec({ entities: [entity('a'), entity('b')], relationships: [{ id: 'r', from: 'a', to: 'b', type: 'many-to-many', attributes: [{ name: 'a_id', type: 'uuid' }] }] }), 'COLUMN_CONFLICT');
});

// ---------------------------------------------------------------- Event Engine -> event_spec
const build = (def: unknown) => buildSpecs(def).specs;
const evDef = (events: unknown[], extra: Partial<{ entities: unknown[]; relationships: unknown[] }> = {}) => ({
  entities: extra.entities ?? [
    entity('student', [{ name: 'name', type: 'string' }, { name: 'email', type: 'email' }, { name: 'backup_email', type: 'email' }, { name: 'gpa', type: 'number' }, { name: 'credits', type: 'integer', default: 0 }, { name: 'bio', type: 'json' }, { name: 'owner_id', type: 'uuid' }]),
    entity('course', [{ name: 'title', type: 'string', required: true }, { name: 'seats', type: 'integer', default: 0 }]),
  ],
  relationships: extra.relationships ?? [{ id: 'enrollment', from: 'student', to: 'course', type: 'many-to-many' }],
  events,
});
const ev = (o: object) => ({ id: 'student.enrolled', name: 'Enrolled', actor: 'student', target: 'course', triggers: [{ action: 'log' }], ...o });
const evCodes = (events: unknown[], extra = {}) => codes(evDef(events, extra));

test('event_spec: MIT events are fully resolved (entity, attribute, row), no handlers', () => {
  const { event_spec } = build(mit).event_spec;
  assert.deepEqual(event_spec.events.map((e) => e.id), ['student.enrolled', 'student.graduated', 'professor.hired']);
  const enrolled = event_spec.events[0];
  assert.equal(enrolled.relationship, 'enrollment');
  assert.deepEqual(enrolled.compensations, []);
  assert.deepEqual(enrolled.triggers, [
    { action: 'send_notification', to: 'student', row: 'actor', message: 'You are enrolled in a course' },
    { action: 'increment', entity: 'course', attribute: 'enrolled_count', field: 'course.enrolled_count', row: 'target', by: 1 },
    { action: 'log', to: 'audit' },
  ]);
  const hired = event_spec.events[2];
  assert.deepEqual(hired.triggers[1], { action: 'increment', entity: 'department', attribute: 'professor_count', field: 'department.professor_count', row: 'actor', by: 1 });
  assert.deepEqual(Object.keys(event_spec.system_records!), ['ledger', 'audit', 'notifications']);
  assert.equal(event_spec.system_records!.ledger.append_only, true);
  assert.equal(event_spec.system_records!.notifications.append_only, false);
});

test('event_spec: no events -> empty list and no system records', () => {
  const { event_spec } = build({ entities: [entity('a')] }).event_spec;
  assert.deepEqual(event_spec, { events: [] });
});

test('event validation: actor/target, ids, types and the emitting relationship', () => {
  assert.deepEqual(evCodes([ev({})]), []);
  assert.ok(evCodes([ev({ actor: 'nobody' })]).includes('UNKNOWN_ENTITY'));
  assert.ok(evCodes([ev({ id: 'Bad Id' })]).includes('INVALID_ID'));
  assert.ok(evCodes([ev({ id: 'a.b_c' }), ev({ id: 'a_b.c' })]).includes('AMBIGUOUS_EVENT_ID'));
  assert.ok(evCodes([ev({}), ev({})]).includes('DUPLICATE_ID'));
  assert.ok(evCodes([ev({ name: '' })]).includes('MISSING_NAME'));
  assert.ok(evCodes([ev({ triggers: [] })]).includes('MISSING_TRIGGERS'));
  assert.ok(evCodes([ev({ type: 'upsert' })]).includes('INVALID_EVENT_TYPE'));
  assert.ok(evCodes([ev({ relationship: 'ghost', type: 'create' })]).includes('UNKNOWN_RELATIONSHIP'));
  assert.ok(evCodes([ev({ relationship: 'enrollment' })]).includes('RELATIONSHIP_NEEDS_TYPE'));
  assert.ok(evCodes([ev({ relationship: 'enrollment', type: 'create', actor: 'course', target: 'course' })]).includes('RELATIONSHIP_MISMATCH'));
  assert.deepEqual(evCodes([ev({ relationship: 'enrollment', type: 'create' })]), []);
});

test('event validation: actions are a closed list and keys are checked', () => {
  const t = (trigger: object) => evCodes([ev({ triggers: [trigger] })]);
  assert.ok(t({ action: 'teleport' }).includes('INVALID_ACTION'));
  assert.ok(t({ action: 'log', typo: 1 }).includes('UNKNOWN_TRIGGER_KEY'));
  assert.ok(t({ action: 'log', to: 'elsewhere' }).includes('INVALID_LOG_TARGET'));
  assert.deepEqual(t({ action: 'log', to: 'audit', level: 'info' }), []);
  assert.ok(t({ action: 'send_notification' }).includes('MISSING_FIELD'));
  assert.ok(t({ action: 'send_notification', to: 'course' , channel: 'Push!' }).includes('INVALID_FIELD'));
  assert.deepEqual(t({ action: 'send_notification', to: 'student', channel: 'push', template: 'enrollment_confirmed' }), []);
  assert.ok(t({ action: 'send_notification', to: 'ghost' }).includes('UNKNOWN_ENTITY'));
  assert.ok(t({ action: 'delete_entity', entity: 'student', on: 'target' }).includes('ON_MISMATCH'));
  assert.ok(t({ action: 'trigger_workflow', workflow: 'nope' }).includes('UNKNOWN_WORKFLOW_EVENT'));
});

test('event validation: fields must exist, be numeric where needed, and values must fit their type', () => {
  const t = (trigger: object) => evCodes([ev({ triggers: [trigger] })]);
  assert.ok(t({ action: 'increment', field: 'course' }).includes('INVALID_FIELD'));
  assert.ok(t({ action: 'increment', field: 'course.nope' }).includes('UNKNOWN_ATTRIBUTE'));
  assert.ok(t({ action: 'increment', field: 'course.title' }).includes('FIELD_NOT_NUMERIC'));
  assert.ok(t({ action: 'increment', field: 'unrelated.x' }).includes('UNKNOWN_ENTITY'));
  assert.ok(t({ action: 'increment', field: 'course.seats', by: 0 }).includes('INVALID_AMOUNT'));
  assert.ok(t({ action: 'increment', field: 'course.seats', by: 1.5 }).includes('INVALID_AMOUNT'));
  assert.deepEqual(t({ action: 'decrement', field: 'course.seats', by: 2 }), []);
  assert.ok(t({ action: 'update_field', field: 'student.gpa', value: 'high' }).includes('INVALID_VALUE'));
  assert.ok(t({ action: 'update_field', field: 'student.email', value: 'not-an-email' }).includes('INVALID_VALUE'));
  assert.ok(t({ action: 'update_field', field: 'student.gpa' }).includes('MISSING_FIELD'));
  assert.ok(t({ action: 'update_field', field: 'student.gpa', value: { from: 'actor' } }).includes('FROM_REQUIRES_UUID'));
  assert.deepEqual(t({ action: 'update_field', field: 'student.owner_id', value: { from: 'target' } }), []);
  assert.deepEqual(t({ action: 'update_field', field: 'student.bio', value: { a: [1, 2] } }), []);
  assert.deepEqual(t({ action: 'update_field', field: 'student.gpa', value: 3.5 }), []);
});

test('event validation: a self-referencing event must say which row it means', () => {
  const def = { entities: [entity('employee', [{ name: 'headcount', type: 'integer' }])], relationships: [] };
  const e = (trigger: object) => ({ id: 'e.moved', name: 'Moved', actor: 'employee', target: 'employee', triggers: [trigger] });
  assert.ok(codes({ ...def, events: [e({ action: 'increment', field: 'employee.headcount' })] }).includes('AMBIGUOUS_ROW'));
  assert.deepEqual(codes({ ...def, events: [e({ action: 'increment', field: 'employee.headcount', on: 'target' })] }), []);
});

test('event validation: create_entity values, email rules, webhooks and workflow cycles', () => {
  const t = (trigger: object, extra = {}) => evCodes([ev({ triggers: [trigger] })], extra);
  assert.ok(t({ action: 'create_entity', entity: 'course' }).includes('MISSING_FIELD'));
  assert.ok(t({ action: 'create_entity', entity: 'course', values: {} }).includes('MISSING_REQUIRED_VALUE'));
  assert.ok(t({ action: 'create_entity', entity: 'course', values: { title: 'x', nope: 1 } }).includes('UNKNOWN_ATTRIBUTE'));
  assert.ok(t({ action: 'create_entity', entity: 'course', values: { title: 5 } }).includes('INVALID_VALUE'));
  assert.deepEqual(t({ action: 'create_entity', entity: 'course', values: { title: 'Intro' } }), []);
  // send_email
  assert.ok(t({ action: 'send_email', to: 'course', subject: 's', body: 'b' }).includes('NO_EMAIL_FIELD'));
  assert.ok(t({ action: 'send_email', to: 'student', subject: 's', body: 'b' }).includes('EMAIL_FIELD_REQUIRED'));
  assert.ok(t({ action: 'send_email', to: 'student', field: 'student.name', subject: 's', body: 'b' }).includes('EMAIL_FIELD_TYPE'));
  assert.ok(t({ action: 'send_email', to: 'student', field: 'student.email', body: 'b' }).includes('MISSING_FIELD'));
  assert.deepEqual(t({ action: 'send_email', to: 'student', field: 'student.backup_email', subject: 's', body: 'b' }), []);
  // webhook
  for (const url of ['javascript:alert(1)', 'ftp://x.test', 'https://user:pw@x.test/', 'not a url', '']) assert.ok(t({ action: 'call_webhook', url }).includes('INVALID_URL'), url);
  assert.deepEqual(t({ action: 'call_webhook', url: 'https://hooks.example.test/x' }), []);
  // workflows
  const wf = (a: string, b: string) => ev({ id: a, triggers: [{ action: 'trigger_workflow', workflow: b }] });
  assert.ok(evCodes([wf('a.one', 'a.one')]).includes('CYCLIC_WORKFLOW'));
  assert.ok(evCodes([wf('a.one', 'a.two'), wf('a.two', 'a.three'), wf('a.three', 'a.one')]).includes('CYCLIC_WORKFLOW'));
  assert.deepEqual(evCodes([wf('a.one', 'a.two'), ev({ id: 'a.two' })]), []);
  assert.ok(evCodes([wf('a.one', 'a.two'), ev({ id: 'a.two', actor: 'course', target: 'student' })]).includes('WORKFLOW_ENTITY_MISMATCH'));
});

test('event_spec: create_entity values follow attribute declaration order, not the author\'s key order', () => {
  const def = (values: object) => evDef([ev({ triggers: [{ action: 'create_entity', entity: 'student', values }] })]);
  const a = build(def({ gpa: 3, name: 'A', email: 'a@b.co' })).event_spec.event_spec.events[0].triggers[0] as any;
  const b = build(def({ email: 'a@b.co', name: 'A', gpa: 3 })).event_spec.event_spec.events[0].triggers[0] as any;
  assert.deepEqual(Object.keys(a.values), ['name', 'email', 'gpa']);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------- UI Engine -> ui_spec
const ui = (def: unknown = mit) => build(def).ui_spec.ui_spec;

test('ui_spec: four pages per entity, "new" before ":id", one permission key per page', () => {
  const u = ui();
  assert.equal(u.pages.length, 20);
  const student = u.pages.filter((p) => p.id.startsWith('student_'));
  assert.deepEqual(student.map((p) => [p.id, p.type, p.mode, p.path]), [
    ['student_list', 'list', undefined, '/students'], ['student_create', 'form', 'create', '/students/new'],
    ['student_detail', 'detail', undefined, '/students/:id'], ['student_edit', 'form', 'edit', '/students/:id/edit'],
  ]);
  assert.deepEqual(student.map((p) => p.permission), ['entity:student:list', 'entity:student:create', 'entity:student:read', 'entity:student:update']);
  assert.equal((student[1] as any).submit_action, 'student.create');
  assert.equal((student[3] as any).submit_action, 'student.update');
  for (const p of u.pages) assert.ok(u.permissions.includes(p.permission), p.permission);
  assert.deepEqual(u.navigation, { type: 'sidebar', items: ['students', 'professors', 'courses', 'departments', 'faculties'] });
  assert.deepEqual(u.theme, { primary_color: '#1E3A8A', density: 'medium' });
  assert.deepEqual(u.locales, ['ar', 'en']);
});

test('ui_spec: attribute type decides the widget; foreign keys become relation selects', () => {
  const s = ui().data_sources.find((d) => d.id === 'students')!;
  const w = Object.fromEntries(s.fields.map((f) => [f.name, f.widget]));
  assert.deepEqual(w, { name: 'text', email: 'email', gpa: 'number', status: 'select', enrolled_at: 'datetime', created_at: 'datetime' });
  const c = ui().data_sources.find((d) => d.id === 'courses')!;
  const fk = Object.fromEntries(c.fields.filter((f) => f.widget === 'relation').map((f) => [f.name, f.target]));
  assert.deepEqual(fk, { professor_id: 'professor', department_id: 'department' });
  const all = ui({ entities: [entity('t', ['string', 'number', 'integer', 'boolean', 'date', 'timestamp', 'uuid', 'email', 'url', 'phone', 'json', 'array'].map((type) => ({ name: `a_${type}`, type })).concat([{ name: 'a_enum', type: 'enum', values: ['x'] } as any]))] }).data_sources[0];
  assert.deepEqual(all.fields.filter((f) => !f.system).map((f) => f.widget), ['text', 'number', 'integer', 'checkbox', 'date', 'datetime', 'text', 'email', 'url', 'tel', 'json', 'json', 'select']);
});

test('ui_spec: lists get search, filters and pagination; auto fields are not form fields', () => {
  const u = ui();
  const list = u.pages.find((p) => p.id === 'student_list')!;
  assert.deepEqual(list.pagination, { size: 20 });
  assert.equal(list.search, true);
  assert.deepEqual(list.filters, ['gpa', 'status', 'enrolled_at']);
  assert.ok(!list.columns!.includes('id'));
  const create = u.pages.find((p) => p.id === 'student_create')!;
  assert.ok(!create.fields!.includes('enrolled_at') && !create.fields!.includes('created_at'));
  assert.ok(create.fields!.includes('status'));
  assert.deepEqual(u.data_sources[0].filters.find((f) => f.field === 'status'), { field: 'status', kind: 'select', values: ['active', 'graduated'] });
});

test('ui_spec: every relationship appears on both of its entities, with api paths from the relationship_spec', () => {
  const ds = ui().data_sources;
  const enr = (id: string) => ds.find((d) => d.id === id)!.relations.find((r) => r.relationship === 'enrollment')!;
  assert.deepEqual([enr('students').side, enr('students').other, enr('students').many], ['from', 'course', true]);
  assert.deepEqual([enr('courses').side, enr('courses').other, enr('courses').many], ['to', 'student', true]);
  assert.equal(enr('students').paths.list, '/api/students/:fromId/enrollments');
  assert.equal(enr('courses').paths.list, '/api/courses/:toId/enrollments');
  assert.deepEqual(enr('students').attributes.map((a) => a.name), ['grade', 'enrolled_on']);
  const course = ds.find((d) => d.id === 'courses')!;
  assert.deepEqual(course.relations.map((r) => [r.relationship, r.many]), [['enrollment', true], ['teaching', false], ['course_department', false]]);
});

test('ui_spec: two relationships to the same entity get distinct section titles; self shows both directions', () => {
  const def = { entities: [entity('person_x', [{ name: 'name', type: 'string' }]), entity('doc')], relationships: [
    { id: 'wrote', from: 'person_x', to: 'doc', type: 'one-to-many' }, { id: 'reviewed', from: 'person_x', to: 'doc', type: 'many-to-many' },
    { id: 'manager', from: 'person_x', to: 'person_x', type: 'self' },
  ] };
  const p = ui(def).data_sources.find((d) => d.entity === 'person_x')!;
  assert.deepEqual(p.relations.filter((r) => r.other === 'doc').map((r) => r.title.suffix), ['Wrote', 'Reviewed']);
  const mgr = p.relations.filter((r) => r.relationship === 'manager');
  assert.deepEqual(mgr.map((r) => [r.side, r.many, r.title.reverse]), [['from', false, false], ['to', true, true]]);
});

test('ui_spec: notification area and activity feed come from the event_spec', () => {
  const ds = Object.fromEntries(ui().data_sources.map((d) => [d.id, d]));
  assert.deepEqual(ds.students.surfaces, { notifications: true, activity: true });
  assert.deepEqual(ds.professors.surfaces, { notifications: true, activity: true });
  assert.deepEqual(ds.courses.surfaces, { notifications: false, activity: true });
  assert.deepEqual(ds.faculties.surfaces, { notifications: false, activity: false });
  assert.equal(ds.faculties.api.activity, undefined);
  assert.equal(ds.students.api.notifications!.path, '/api/students/:id/notifications');
  assert.deepEqual(ui().events.map((e) => e.id), ['student.enrolled', 'student.graduated', 'professor.hired']);
});

test('ui_spec: Arabic labels come only from metadata.i18n, English is the fallback, nothing is invented', () => {
  const def = clone(mit);
  def.entities[0].metadata = { i18n: { ar: { name: 'طالب', plural: 'الطلاب', attributes: { name: 'الاسم' } } } };
  def.events[0].metadata = { i18n: { ar: { name: 'تم التسجيل' } } };
  const u = ui(def);
  const s = u.data_sources.find((d) => d.id === 'students')!;
  assert.deepEqual(s.labels, { en: { singular: 'Student', plural: 'Students' }, ar: { singular: 'طالب', plural: 'الطلاب' } });
  assert.deepEqual(s.fields.find((f) => f.name === 'name')!.labels, { en: 'Name', ar: 'الاسم' });
  assert.equal(s.fields.find((f) => f.name === 'email')!.labels.ar, undefined);
  assert.equal(u.data_sources.find((d) => d.id === 'professors')!.labels.ar, undefined);
  assert.deepEqual(u.events[0].labels, { en: 'Student Enrolled', ar: 'تم التسجيل' });
  assert.ok(codes({ entities: [{ ...entity('a'), metadata: { i18n: { fr: { name: 'x' } } } }] }).includes('INVALID_I18N'));
  assert.ok(codes({ entities: [{ ...entity('a'), metadata: { i18n: { ar: { attributes: { ghost: 'x' } } } } }] }).includes('UNKNOWN_ATTRIBUTE'));
  assert.ok(codes({ entities: [{ ...entity('a'), metadata: { i18n: { ar: { name: '' } } } }] }).includes('INVALID_I18N'));
});

// ---------------------------------------------------------------- Spec Loader / Validator
test('spec validator: accepts what Core builds and rejects tampered specs', () => {
  const { files, specs } = buildSpecs(mit);
  assert.deepEqual(validateSpecs(specs), []);
  assert.deepEqual(loadSpecs(files).issues, []);
  const bad = (mutate: (s: any) => void): string[] => { const s = clone(specs) as any; mutate(s); return validateSpecs(s).map((i) => i.code); };
  assert.ok(bad((s) => { s.schema_spec.schema_spec.tables[0].columns[1].type = 'text'; }).includes('INVALID_ATTRIBUTE_TYPE'));
  assert.ok(bad((s) => { s.schema_spec.schema_spec.tables.push(clone(s.schema_spec.schema_spec.tables[0])); }).includes('DUPLICATE_TABLE'));
  assert.ok(bad((s) => { s.schema_spec.schema_spec.tables[0].columns.pop(); }).includes('MISSING_SYSTEM_COLUMN'));
  assert.ok(bad((s) => { s.relationship_spec.relationship_spec.relationships[0].junction.columns[0].references = 'ghosts.id'; }).includes('UNKNOWN_REFERENCE'));
  assert.ok(bad((s) => { s.relationship_spec.relationship_spec.relationships[1].foreign_key.create_column = true; }).includes('COLUMN_CONFLICT'));
  assert.ok(bad((s) => { s.event_spec.event_spec.events[0].triggers[1].attribute = 'ghost'; }).includes('UNKNOWN_ATTRIBUTE'));
  assert.ok(bad((s) => { s.event_spec.event_spec.events[0].actor = 'ghost'; }).includes('UNKNOWN_ENTITY'));
  assert.ok(bad((s) => { delete s.event_spec.event_spec.system_records; }).includes('MISSING_SYSTEM_RECORDS'));
  assert.ok(bad((s) => { s.ui_spec.ui_spec.data_sources[0].relations[0].paths.list = '/api/nope'; }).includes('PATH_MISMATCH'));
  assert.ok(bad((s) => { s.ui_spec.ui_spec.pages[0].permission = 'entity:x:y'; }).includes('UNKNOWN_PERMISSION'));
  assert.ok(bad((s) => { s.ui_spec.ui_spec.pages[0].columns.push('ghost'); }).includes('UNKNOWN_FIELD'));
  assert.ok(bad((s) => { s.ui_spec.ui_spec.navigation.items.push('ghosts'); }).includes('UNKNOWN_DATA_SOURCE'));
  const missing = loadSpecs({ ...files, 'ui_spec.json': undefined as never });
  assert.equal(missing.issues[0].code, 'MISSING_SPEC');
  assert.equal(loadSpecs({ ...files, 'event_spec.json': '{oops' }).issues[0].code, 'INVALID_JSON');
});

// ---------------------------------------------------------------- Whole pipeline and constitutional guarantees
test('build: MIT example yields exactly four specs in engine order and is deterministic', () => {
  const first = buildSpecs(mit);
  const second = buildSpecs(clone(mit));
  assert.deepEqual(Object.keys(first.files), ['schema_spec.json', 'relationship_spec.json', 'event_spec.json', 'ui_spec.json']);
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(first.sha256, second.sha256);
  assert.equal(first.specs.schema_spec.schema_spec.tables.length, 5);
  assert.equal(first.specs.relationship_spec.relationship_spec.relationships.length, 4);
});

test('build: the engines accept their stage inputs only (no engine can be skipped)', () => {
  const s = generateSchemaSpec(mit);
  const r = generateRelationshipSpec(mit);
  const e = generateEventSpec(mit, s, r);
  assert.equal(generateUiSpec(mit, s, r, e).ui_spec.pages.length, 20);
  failsWith(() => generateEventSpec(mit, { schema_spec: { tables: [] } }, r), 'SPEC_MISMATCH');
  failsWith(() => generateEventSpec(mit, s, { relationship_spec: { relationships: [] } }), 'SPEC_MISMATCH');
});

test('build: no timestamps, randomness or code leak into specs (sections 9, 37)', () => {
  const text = Object.values(buildSpecs(mit).files).join('\n');
  assert.doesNotMatch(text, /\b20\d\d-\d\d-\d\d/);
  assert.doesNotMatch(text, /CREATE TABLE|INSERT INTO|gen_random_uuid|<html|<div|function\s*\(|=>/);
});

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out); else out.push(p);
  }
  return out;
}

test('constitution: Core has no dependency, no framework, no code execution, no platform code (sections 10, 84, 85, 96)', () => {
  const core = readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.ts'));
  assert.ok(core.length > 0);
  const allowed = new Set(['node:crypto', 'node:fs', 'node:path', 'node:url']);
  for (const f of core) {
    const src = readFileSync(join(ROOT, 'src', f), 'utf8');
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('./') || allowed.has(m[1]), `${f} imports ${m[1]}`);
    assert.doesNotMatch(src, /\beval\s*\(|new Function|child_process|node:vm|\bsetTimeout\(\s*['"`]/, f);
    assert.doesNotMatch(src, /CREATE TABLE|INSERT INTO|gen_random_uuid|createElement|document\.|React|Vue|Angular|Svelte/, f);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
});

test('constitution: generated extensions never use eval / Function / child_process either (section 10)', () => {
  for (const f of sources(join(ROOT, '02-extensions')).filter((p) => /\.(ts|js)$/.test(p) && !p.endsWith('tests.ts'))) { // tests name the patterns they forbid
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\beval\s*\(|new Function|child_process|node:vm/, f);
  }
});

test('constitution: no other project is named anywhere in Ion (sections 8, 81)', () => {
  const banned = new RegExp(['ca', 'io'].join('') + '|' + ['near', 'me'].join(''), 'i');
  for (const f of sources(ROOT).filter((p) => /\.(ts|js|json|md|html|css)$/.test(p) && !p.endsWith('package-lock.json'))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), banned, f);
  }
});

function big(n: number, events = Math.min(n, 1000)) {
  const entities = Array.from({ length: n }, (_, i) => entity(`ent${i}`, [{ name: 'name', type: 'string', required: true }, { name: 'score', type: 'number' }]));
  const relationships = Array.from({ length: n }, (_, i) => ({ id: `rel${i}`, from: `ent${i}`, to: `ent${(i + 1) % n}`, type: ['one-to-many', 'many-to-one', 'many-to-many', 'one-to-one'][i % 4] }));
  const evs = Array.from({ length: events }, (_, i) => ({ id: `ev${i}.done`, name: 'Done', actor: `ent${i}`, target: `ent${(i + 1) % n}`, triggers: [{ action: 'log' }, { action: 'increment', field: `ent${(i + 1) % n}.score` }] }));
  return { entities, relationships, events: evs };
}

test('performance (section 117): 10 entities < 500ms, 100 < 2s, 1000 < 10s', () => {
  for (const [n, limit] of [[10, 500], [100, 2000], [1000, 10000]] as const) {
    const def = big(n);
    const t0 = performance.now();
    buildSpecs(def);
    const ms = performance.now() - t0;
    assert.ok(ms < limit, `${n} entities took ${ms.toFixed(0)}ms (limit ${limit}ms)`);
  }
});
