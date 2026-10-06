// Metadata (3.1.0): properties on entity / attribute / relationship / event. Closed vocabulary, additive, deterministic.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES, RULE_TOTAL, checkRules, validateDefinition, validateSpecs } from '../src/index.ts';
import { entity, mit, specsOf } from './helpers.ts';

const codes = (def: unknown): string[] => validateDefinition(def).map((i) => i.code);
const withEntity = (e: object): any => ({ app: { id: 'a', name: 'A' }, entities: [e, entity('other')], relationships: [], events: [] });
const order = (metadata: unknown): any => ({ id: 'order', name: 'Order', type: 'transaction', metadata, attributes: [{ name: 'state', type: 'enum', values: ['a', 'b', 'c'] }, { name: 'note', type: 'string' }] });

test('metadata: the definitions in the MIT example are valid and reach the specs', () => {
  assert.deepEqual(validateDefinition(mit), []);
  const s: any = specsOf();
  const course = s.schema_spec.schema_spec.tables.find((t: any) => t.table === 'courses');
  assert.equal(course.versioned, true);
  assert.deepEqual(course.indexes, [{ columns: ['code'] }]);
  assert.deepEqual(course.columns.find((c: any) => c.name === 'version'), { name: 'version', type: 'integer', nullable: false, default: 1, system: true });
  assert.deepEqual(s.schema_spec.schema_spec.tables.find((t: any) => t.table === 'students').columns.find((c: any) => c.name === 'status').transitions, { active: ['graduated'] });
  assert.deepEqual(s.relationship_spec.relationship_spec.relationships.map((r: any) => [r.id, r.cascade]), [['enrollment', undefined], ['teaching', 'restrict'], ['course_department', undefined], ['department_faculty', 'restrict']]);
  assert.deepEqual(s.event_spec.event_spec.events.find((e: any) => e.id === 'student.enrolled').rate, { max: 1000, per_seconds: 60 });
});

test('metadata: the vocabulary is closed, so nothing is accepted and then silently ignored', () => {
  for (const key of ['weighted', 'ml_model', 'personalized', 'queue', 'stateful']) {
    assert.ok(codes(withEntity(order({ [key]: true }))).includes('UNKNOWN_METADATA'), `${key} on an entity`);
  }
  const rel = (m: unknown): any => ({ ...withEntity(entity('x')), relationships: [{ id: 'r', from: 'x', to: 'other', type: 'one-to-many', metadata: m }] });
  assert.ok(codes(rel({ weight_formula: 'a*b' })).includes('UNKNOWN_METADATA'));
  const ev = (m: unknown): any => ({ ...withEntity(entity('x')), events: [{ id: 'x.go', name: 'Go', actor: 'x', target: 'other', triggers: [{ action: 'log', to: 'audit' }], metadata: m }] });
  assert.ok(codes(ev({ retry: { max: 3 } })).includes('UNKNOWN_METADATA'));
  assert.deepEqual(codes(ev({})), []);
  assert.ok(codes(withEntity({ ...entity('y'), attributes: [{ name: 'n', type: 'string', metadata: { encrypted: true } }] })).includes('UNKNOWN_METADATA'));
});

test('metadata: entity keys (versioned, indexed) are checked', () => {
  assert.deepEqual(codes(withEntity(order({ versioned: true, indexed: ['state', 'note'] }))), []);
  assert.ok(codes(withEntity(order({ versioned: false }))).includes('INVALID_METADATA'));
  assert.ok(codes(withEntity(order({ indexed: [] }))).includes('INVALID_METADATA'));
  assert.ok(codes(withEntity(order({ indexed: ['nope'] }))).includes('UNKNOWN_ATTRIBUTE'));
  assert.ok(codes(withEntity(order({ indexed: ['note', 'note'] }))).includes('INVALID_METADATA'));
});

test('metadata: transitions need an enum and only its own values, never a state pointing at itself', () => {
  const t = (transitions: unknown, type = 'enum'): any => withEntity({ id: 'order', name: 'Order', type: 'transaction', attributes: [{ name: 's', type, ...(type === 'enum' ? { values: ['a', 'b', 'c'] } : {}), metadata: { transitions } }] });
  assert.deepEqual(codes(t({ a: ['b'], b: ['c', 'a'] })), []);
  assert.ok(codes(t({ a: ['z'] })).includes('INVALID_METADATA'), 'unknown target');
  assert.ok(codes(t({ z: ['a'] })).includes('INVALID_METADATA'), 'unknown source');
  assert.ok(codes(t({ a: ['a'] })).includes('INVALID_METADATA'), 'self loop');
  assert.ok(codes(t({ a: ['b', 'b'] })).includes('INVALID_METADATA'), 'duplicates');
  assert.ok(codes(t({})).includes('INVALID_METADATA'), 'empty');
  assert.ok(codes(t({ a: ['b'] }, 'string')).includes('INVALID_METADATA'), 'not an enum');
});

test('metadata: cascade and rate accept exactly their documented values', () => {
  const rel = (m: unknown): any => ({ ...withEntity(entity('x')), relationships: [{ id: 'r', from: 'x', to: 'other', type: 'one-to-many', metadata: m }] });
  for (const ok of ['none', 'restrict', 'archive']) assert.deepEqual(codes(rel({ cascade: ok })), [], ok);
  for (const bad of ['delete', 'CASCADE', true, 1, null]) assert.ok(codes(rel({ cascade: bad })).includes('INVALID_METADATA'), String(bad));
  const ev = (rate: unknown): any => ({ ...withEntity(entity('x')), events: [{ id: 'x.go', name: 'Go', actor: 'x', target: 'other', triggers: [{ action: 'log', to: 'audit' }], metadata: { rate } }] });
  assert.deepEqual(codes(ev({ max: 5, per_seconds: 60 })), []);
  for (const bad of [{ max: 0, per_seconds: 60 }, { max: 5, per_seconds: 0 }, { max: 1.5, per_seconds: 60 }, { max: 5 }, { max: 5, per_seconds: 60, burst: 2 }, { max: 5, per_seconds: 100000 }, 'fast', 5]) {
    assert.ok(codes(ev(bad)).includes('INVALID_METADATA'), JSON.stringify(bad));
  }
});

test('metadata: "none" cascade leaves no trace in the spec, so older builds keep their exact bytes', () => {
  const s: any = specsOf({ ...mit, relationships: mit.relationships.map((r: any) => ({ ...r, metadata: undefined })) });
  assert.ok(s.relationship_spec.relationship_spec.relationships.every((r: any) => !('cascade' in r)));
  const s2: any = specsOf({ ...mit, entities: mit.entities.map((e: any) => ({ ...e, metadata: e.id === 'course' ? undefined : e.metadata })) });
  const course = s2.schema_spec.schema_spec.tables.find((t: any) => t.table === 'courses');
  assert.ok(!('versioned' in course) && !course.columns.some((c: any) => c.name === 'version') && course.indexes.length === 0);
});

test('metadata: it adds no rule, no engine and no spec: 45 rules, and the spec checks cover it', () => {
  assert.equal(RULES.length, RULE_TOTAL);
  assert.equal(RULE_TOTAL, 45);
  assert.deepEqual(checkRules(specsOf()), []);
  const broken = (mutate: (s: any) => void): string[] => { const s: any = structuredClone(specsOf()); mutate(s); return validateSpecs(s).map((i) => i.code); };
  assert.ok(broken((s) => { s.schema_spec.schema_spec.tables[0].columns.find((c: any) => c.name === 'status').transitions = { active: ['ghost'] }; }).includes('RULE_S6'));
  assert.ok(broken((s) => { const t = s.schema_spec.schema_spec.tables.find((x: any) => x.table === 'courses'); t.columns = t.columns.filter((c: any) => c.name !== 'version'); }).includes('RULE_S6'));
  assert.ok(broken((s) => { s.relationship_spec.relationship_spec.relationships[1].cascade = 'delete'; }).includes('RULE_R1'));
  assert.ok(broken((s) => { s.event_spec.event_spec.events[0].rate = { max: 0, per_seconds: 5 }; }).includes('RULE_E3'));
});

test('metadata: same definition, same specs (deterministic), and the definition is not mutated', () => {
  const before = JSON.stringify(mit);
  assert.equal(JSON.stringify(specsOf()), JSON.stringify(specsOf()));
  assert.equal(JSON.stringify(mit), before);
});
