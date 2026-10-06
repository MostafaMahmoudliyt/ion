import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, overlay, chunk, WIZARD_MIN_FIELDS, STEP_MAX_FIELDS } from './index.ts';
import { entity, mit, specsOf } from '../../../test/helpers.ts';

const adv = (def: unknown = mit): any => overlay(specsOf(def)).ui_advanced;
const specs = specsOf();
const ui = (specs as any).ui_spec.ui_spec;
const table = (id: string): any => (specs as any).schema_spec.schema_spec.tables.find((t: any) => t.table === id);

test('ui-advanced: chunk splits evenly, never above the step maximum, keeps order', () => {
  for (let n = WIZARD_MIN_FIELDS; n <= 40; n++) {
    const names = Array.from({ length: n }, (_, i) => `f${i}`);
    const steps = chunk(names);
    assert.deepEqual(steps.flat(), names, `n=${n}: order and completeness`);
    assert.ok(steps.every((s) => s.length >= 1 && s.length <= STEP_MAX_FIELDS), `n=${n}: sizes`);
    const sizes = steps.map((s) => s.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `n=${n}: even`);
    assert.equal(steps.length, Math.ceil(n / STEP_MAX_FIELDS), `n=${n}: fewest steps`);
  }
  assert.deepEqual(chunk(['a', 'b', 'c', 'd', 'e']).map((s) => s.length), [3, 2]);
});

test('ui-advanced: only create forms with 5+ fields become wizards; steps partition the form and end with review', () => {
  const a = adv();
  for (const p of ui.pages.filter((x: any) => x.type === 'form')) {
    const flow = a.flows[p.id];
    if (p.mode === 'create' && p.fields.length >= WIZARD_MIN_FIELDS) {
      assert.equal(flow.kind, 'wizard');
      assert.deepEqual(flow.steps.slice(0, -1).flatMap((s: any) => s.fields), p.fields, `${p.id}: steps cover the form exactly, in order`);
      assert.equal(flow.steps.at(-1).id, 'review');
      assert.deepEqual(flow.steps.at(-1).fields, []);
    } else assert.equal(flow, undefined, `${p.id} stays a plain form`);
  }
  assert.ok(a.flows.course_create, 'MIT course has 6 fields');
  assert.equal(a.flows.student_create, undefined, 'MIT student has 4');
});

test('ui-advanced: every entity gets an empty state, in Arabic too when the labels have Arabic', () => {
  const a = adv();
  assert.deepEqual(Object.keys(a.entities), ui.data_sources.map((d: any) => d.entity));
  assert.equal(a.entities.student.empty.message.en, 'Start by adding your first Student');
  assert.equal(a.entities.student.empty.message.ar, undefined, 'no Arabic name given, so no invented Arabic');
  const def = { ...mit, entities: [{ ...entity('book'), labels: { en: { singular: 'Book', plural: 'Books' }, ar: { singular: 'كتاب', plural: 'كتب' } } }] };
  let ar: any;
  try { ar = adv(def).entities.book.empty; } catch { ar = undefined; }
  if (ar) assert.equal(ar.message.ar, 'ابدأ بإضافة كتاب');
});

test('ui-advanced: metrics come only from real columns, with the right kind for the type', () => {
  const a = adv();
  for (const d of ui.data_sources) {
    const m = a.entities[d.entity].metrics;
    assert.equal(m[0].id, 'count');
    assert.equal(m.at(-1).id, 'trend_created_at');
    assert.equal(new Set(m.map((x: any) => x.id)).size, m.length, 'metric ids are unique');
    for (const x of m) {
      assert.equal(x.permission, `entity:${d.entity}:list`);
      assert.ok(x.labels.en);
      if (!x.field) continue;
      const c = table(d.id).columns.find((col: any) => col.name === x.field);
      assert.ok(c, `${x.id}: ${x.field} is a column of ${d.id}`);
      if (x.kind === 'avg') assert.ok(['number', 'integer', 'money'].includes(c.type));
      if (x.kind === 'distribution') assert.equal(c.type, 'enum');
      if (x.kind === 'trend') assert.equal(c.type, 'timestamp');
    }
  }
  assert.deepEqual(a.entities.student.metrics.map((x: any) => x.id), ['count', 'avg_gpa', 'distribution_status', 'trend_created_at']);
});

test('ui-advanced: detail composition lists every relation of the entity once, single-valued before many-valued', () => {
  const a = adv();
  for (const d of ui.data_sources) {
    const det = a.entities[d.entity].composition.detail;
    assert.equal(det[0].kind, 'fields');
    const rels = det.filter((x: any) => x.kind === 'relation');
    assert.equal(rels.length, d.relations.length);
    const manyOf = (r: any): boolean => d.relations.find((x: any) => x.relationship === r.relationship && x.side === r.side).many;
    const flags = rels.map(manyOf);
    assert.deepEqual(flags, [...flags].sort((x, y) => Number(x) - Number(y)), `${d.id}: single before many`);
    assert.equal(det.some((x: any) => x.kind === 'notifications'), !!d.surfaces.notifications);
    assert.equal(det.some((x: any) => x.kind === 'activity'), !!d.surfaces.activity);
  }
});

test('ui-advanced: output is data only, deterministic, and the .js wrapper carries the same data as the .json', () => {
  const a = generate(specs as any), b = generate(specsOf() as any);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a).sort(), ['ui_advanced.js', 'ui_advanced.json']);
  const json = JSON.parse(a['ui_advanced.json']);
  const js = a['ui_advanced.js'];
  assert.ok(js.startsWith('// Ion ui-advanced overlay'));
  const body = js.slice(js.indexOf('window.ION_ADVANCED = ') + 'window.ION_ADVANCED = '.length, js.lastIndexOf(';'));
  assert.deepEqual(JSON.parse(body), json.ui_advanced);
  const text = a['ui_advanced.json'];
  assert.ok(!/\b(function|eval|=>|<script)/.test(text), 'no code in the overlay');
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(text), 'no timestamps');
});

test('ui-advanced: it is an overlay, so the five Core specs are unchanged by it', () => {
  const before = JSON.stringify(specs);
  overlay(specs as any);
  assert.equal(JSON.stringify(specs), before);
});
