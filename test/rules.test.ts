// The 45 rules (section 17): the counts are pinned, the shipped examples satisfy every rule, and each rule is
// broken on purpose to prove its check fires (a rule nobody can fail is not a rule).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES, RULE_COUNTS, RULE_TOTAL, checkRules, validateSpecs } from '../src/index.ts';
import { specsOf } from './helpers.ts';

const base = specsOf();
const clone = (): any => structuredClone(base);

// Each mutation breaks exactly the rule it is named after. `m` is a fresh copy of the MIT specs.
const BREAK: Record<string, (m: any) => void> = {
  S1: (m) => { const t = m.schema_spec.schema_spec.tables; t.push(structuredClone(t[0])); },
  S2: (m) => { const t = m.schema_spec.schema_spec.tables[0]; t.columns = t.columns.filter((c: any) => c.name !== 'id'); },
  S3: (m) => { m.schema_spec.schema_spec.tables[0].columns[1].primary = true; },
  S4: (m) => { m.schema_spec.schema_spec.tables[0].columns[1].type = 'varchar'; },
  S5: (m) => { delete m.schema_spec.schema_spec.tables[0].columns[1].nullable; },
  S6: (m) => { m.schema_spec.schema_spec.tables[0].columns[1].unique = false; },
  S7: (m) => { const c = m.schema_spec.schema_spec.tables[0].columns[1]; c.type = 'string'; c.auto = true; },
  S8: (m) => { const c = m.schema_spec.schema_spec.tables[0].columns[1]; c.type = 'string'; c.values = ['a']; },
  S9: (m) => { m.schema_spec.schema_spec.tables[0].security.row_level = false; },
  S10: (m) => { m.schema_spec.schema_spec.tables[0].archivable = false; },
  R1: (m) => { m.relationship_spec.relationship_spec.relationships[0].type = 'bogus'; },
  R2: (m) => { m.relationship_spec.relationship_spec.relationships.find((r: any) => r.foreign_key).foreign_key.table = 'nowhere'; },
  R3: (m) => { m.relationship_spec.relationship_spec.relationships.find((r: any) => r.foreign_key).foreign_key.references = 'ghosts.id'; },
  R4: (m) => { m.relationship_spec.relationship_spec.relationships.find((r: any) => r.junction).junction.active_only = false; },
  R5: (m) => { m.relationship_spec.relationship_spec.relationships[0].apis = []; },
  E1: (m) => { m.event_spec.event_spec.events[0].id = 'Bad Id'; },
  E2: (m) => { m.event_spec.event_spec.events[0].actor = 'ghost'; },
  E3: (m) => { m.event_spec.event_spec.events[0].type = 'weird'; },
  E4: (m) => { m.event_spec.event_spec.events[0].relationship = 'ghost'; },
  E5: (m) => { m.event_spec.event_spec.events[0].triggers.push({ action: 'explode' }); },
  E6: (m) => { m.event_spec.event_spec.events[0].triggers.push({ action: 'increment', entity: 'x' }); },
  E7: (m) => { const e = m.event_spec.event_spec.events[0]; e.triggers.push({ action: 'increment', entity: e.target, attribute: 'ghost', row: 'target', by: 1 }); },
  E8: (m) => { m.event_spec.event_spec.events.push({ id: 'loop.back', name: 'Loop', type: 'custom', actor: 'x', target: 'x', triggers: [{ action: 'trigger_workflow', workflow: 'loop.back' }], compensations: [] }); },
  E9: (m) => { m.event_spec.event_spec.events[0].triggers.push({ action: 'call_webhook', url: 'ftp://example.com' }); },
  E10: (m) => { m.event_spec.event_spec.system_records.audit.append_only = false; },
  U1: (m) => { const u = m.ui_spec.ui_spec; u.pages = u.pages.filter((p: any) => !(p.type === 'detail' && p.data_source === u.data_sources[0].id)); },
  U2: (m) => { const p = m.ui_spec.ui_spec.pages.find((x: any) => x.type === 'form'); p.fields = []; },
  U3: (m) => { m.ui_spec.ui_spec.data_sources[0].fields[0].widget = 'banana'; },
  U4: (m) => { m.ui_spec.ui_spec.data_sources.find((d: any) => d.relations.length).relations = []; },
  U5: (m) => { m.ui_spec.ui_spec.pages.find((p: any) => p.type === 'list').pagination.size = 0; },
  U6: (m) => { m.ui_spec.ui_spec.data_sources.find((d: any) => d.filters.length).filters = []; },
  U7: (m) => { const p = m.ui_spec.ui_spec.pages.find((x: any) => x.type === 'list'); p.search = !p.search; },
  U8: (m) => { const s = m.ui_spec.ui_spec.data_sources.find((d: any) => d.surfaces.activity).surfaces; s.activity = false; },
  U9: (m) => { m.ui_spec.ui_spec.permissions = []; },
  U10: (m) => { m.ui_spec.ui_spec.locales = ['en']; },
  U11: (m) => { delete m.ui_spec.ui_spec.dashboard; },
  U12: (m) => { delete m.ui_spec.ui_spec.pages.find((p: any) => p.type === 'list').sort; },
  U13: (m) => { m.ui_spec.ui_spec.pages.find((p: any) => p.type === 'list').confirm = []; },
  U14: (m) => { delete m.ui_spec.ui_spec.pages.find((p: any) => p.type === 'list').states.error; },
  U15: (m) => { m.ui_spec.ui_spec.pages.find((p: any) => p.type === 'list').breadcrumb = []; },
  U16: (m) => { m.ui_spec.ui_spec.pages.find((p: any) => p.type === 'list').responsive.compact = 'grid'; },
  U17: (m) => { m.ui_spec.ui_spec.data_sources[0].fields[0].labels = {}; },
  U18: (m) => { m.ui_spec.ui_spec.directions.ar = 'ltr'; },
  U19: (m) => { m.ui_spec.ui_spec.pages.find((p: any) => p.type === 'list').page_sizes = [10, 20, 5]; },
  U20: (m) => { m.ui_spec.ui_spec.theme.primary_color = '#FFFF00'; },
};

test('rules: 45 in total, split 10 / 5 / 10 / 20 / 0 as section 17 fixes, ids unique and ordered', () => {
  assert.equal(RULES.length, RULE_TOTAL);
  assert.equal(RULE_TOTAL, 45);
  const count = (e: string): number => RULES.filter((r) => r.engine === e).length;
  assert.deepEqual({ schema: count('schema'), relationship: count('relationship'), event: count('event'), ui: count('ui'), publish: 0 }, RULE_COUNTS);
  assert.equal(new Set(RULES.map((r) => r.id)).size, 45);
  const prefix = { schema: 'S', relationship: 'R', event: 'E', ui: 'U' } as const;
  for (const e of Object.keys(prefix) as Array<keyof typeof prefix>) {
    RULES.filter((r) => r.engine === e).forEach((r, i) => assert.equal(r.id, `${prefix[e]}${i + 1}`));
  }
  assert.equal(RULES.filter((r) => r.origin === 'added').length, 10, 'U11-U20 are the ten rules added to complete the UI engine');
});

test('rules: the MIT example satisfies all 45 and the validator reports no issue', () => {
  assert.deepEqual(checkRules(base), []);
  assert.deepEqual(validateSpecs(base), []);
});

test('rules: every one of the 45 has a mutation that breaks it, and the validator names it by id', () => {
  assert.deepEqual(Object.keys(BREAK).sort(), RULES.map((r) => r.id).sort(), 'a rule without a failing case is unproven');
  for (const rule of RULES) {
    const m = clone();
    BREAK[rule.id](m);
    const codes = new Set(checkRules(m).map((i) => i.code));
    assert.ok(codes.has(`RULE_${rule.id}`), `${rule.id} did not fire (got: ${[...codes].join(', ') || 'nothing'})`);
  }
});

test('rules: validateSpecs enforces them, so a generator never receives a spec set that breaks a rule', () => {
  for (const id of ['S9', 'R4', 'E10', 'U11', 'U13', 'U20']) {
    const m = clone();
    BREAK[id](m);
    assert.ok(validateSpecs(m).some((i) => i.code === `RULE_${id}`), `${id} not enforced by validateSpecs`);
  }
});

test('rules: checks are pure and deterministic (same specs, same verdict, input untouched)', () => {
  const m = clone();
  BREAK.U12(m);
  const before = JSON.stringify(m);
  const a = JSON.stringify(checkRules(m));
  assert.equal(JSON.stringify(checkRules(m)), a);
  assert.equal(JSON.stringify(m), before);
});
