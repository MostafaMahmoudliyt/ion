import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildSpecs, validateDefinition } from '../../src/index.ts';
import { expandDefinition, loadProcessors, validateProcessor } from './expand.ts';

const DIR = new URL('.', import.meta.url).pathname;
const procs = loadProcessors(DIR);
const order = (metadata: unknown): any => ({
  app: { id: 'shop', name: 'Shop' },
  entities: [{ id: 'order', name: 'Order', type: 'transaction', metadata, attributes: [{ name: 'note', type: 'string' }] }],
  relationships: [], events: [],
});
const codes = (f: () => unknown): string => { try { f(); return 'none'; } catch (e: any) { return e.issues?.map((i: any) => i.code).join(',') ?? String(e); } };

test('processors: payable expands into plain primitives that pass all 45 rules and keep Core closed', () => {
  const { definition, applied } = expandDefinition(order({ payable: { currency: 'EGP' } }), procs) as any;
  assert.deepEqual(applied, [{ processor: 'payable', entity: 'order', added: ['entity:order_payment', 'relationship:order_payments'] }]);
  assert.equal(definition.entities[0].metadata, undefined, 'the processor key is consumed');
  assert.deepEqual(validateDefinition(definition), []);
  const t = (buildSpecs(definition).specs.schema_spec as any).schema_spec.tables.find((x: any) => x.table === 'order_payments');
  assert.equal(t.versioned, true);
  assert.equal(t.columns.find((c: any) => c.name === 'amount').type, 'money', 'amounts use the money type: whole minor units, never a float');
  assert.equal(t.columns.find((c: any) => c.name === 'currency').default, 'EGP');
  assert.deepEqual(t.columns.find((c: any) => c.name === 'status').transitions, { pending: ['paid', 'failed'], paid: ['refunded'] });
});

test('processors: commentable adds a comment entity linked many-to-one with archive cascade', () => {
  const { definition } = expandDefinition(order({ commentable: true }), procs) as any;
  assert.deepEqual(validateDefinition(definition), []);
  assert.deepEqual(definition.relationships.map((r: any) => [r.id, r.metadata.cascade]), [['order_comments', 'archive']]);
  buildSpecs(definition);
});

test('processors: pure and deterministic (input untouched, same bytes twice)', () => {
  const input = order({ payable: true, commentable: true });
  const before = JSON.stringify(input);
  const a = JSON.stringify(expandDefinition(input, procs));
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(expandDefinition(input, procs)), a);
});

test('processors: Core vocabulary stays closed — an unregistered key is still UNKNOWN_METADATA', () => {
  const { definition } = expandDefinition(order({ ml_model: true, payable: true }), procs) as any;
  assert.ok(validateDefinition(definition).some((i) => i.code === 'UNKNOWN_METADATA' && i.path.endsWith('.ml_model')));
});

test('processors: bad params and name collisions are refused, nothing is silently merged', () => {
  assert.equal(codes(() => expandDefinition(order({ payable: { currency: 'XYZ' } }), procs)), 'INVALID_PARAMS');
  assert.equal(codes(() => expandDefinition(order({ payable: { gateway: 'stripe' } }), procs)), 'INVALID_PARAMS');
  assert.equal(codes(() => expandDefinition(order({ payable: false }), procs)), 'INVALID_PARAMS');
  const clash = order({ payable: true });
  clash.entities.push({ id: 'order_payment', name: 'X', type: 'custom', attributes: [{ name: 'n', type: 'string' }] });
  assert.equal(codes(() => expandDefinition(clash, procs)), 'EXPANSION_CONFLICT');
});

test('processors: manifests are validated (Core key, bad version, no entity, recursion, unknown placeholder)', () => {
  const ok = JSON.parse(readFileSync(join(DIR, 'commentable', 'processor.json'), 'utf8'));
  assert.equal(codes(() => validateProcessor({ ...ok, key: 'versioned' })), 'INVALID_PROCESSOR');
  assert.equal(codes(() => validateProcessor({ ...ok, version: '1' })), 'INVALID_PROCESSOR');
  assert.equal(codes(() => validateProcessor({ ...ok, on: 'event' })), 'INVALID_PROCESSOR');
  assert.equal(codes(() => validateProcessor({ ...ok, expand: { relationships: [] } })), 'INVALID_PROCESSOR');
  assert.equal(codes(() => validateProcessor({ ...ok, expand: { entities: [{ id: 'x', metadata: { commentable: true } }] } })), 'INVALID_PROCESSOR');
  const bad = { ...ok, expand: { entities: [{ id: '{{entity.nope}}', name: 'x', type: 'custom', attributes: [] }] } };
  assert.equal(codes(() => expandDefinition(order({ commentable: true }), [bad])), 'INVALID_PROCESSOR');
  assert.equal(codes(() => expandDefinition(order({ commentable: true }), [ok, ok])), 'INVALID_PROCESSOR', 'two processors, one key');
});

test('processors: no dynamic code anywhere in the extension (section 10)', () => {
  for (const f of ['expand.ts', 'payable/processor.json', 'commentable/processor.json']) {
    assert.doesNotMatch(readFileSync(join(DIR, f), 'utf8'), /\beval\s*\(|new Function|child_process|node:vm|fetch\(|https?:\/\//, f);
  }
});

test('processors: the CLI expands before Core (build succeeds, key never reaches the specs)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ion-proc-'));
  writeFileSync(join(dir, 'def.json'), JSON.stringify(order({ payable: true, commentable: true })));
  const out = execFileSync('node', [join(DIR, '..', '..', 'src', 'cli.ts'), 'build', 'def.json', '--out', 'o'], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /processor payable on order/);
  const schema = readFileSync(join(dir, 'o', 'specs', 'schema_spec.json'), 'utf8');
  assert.match(schema, /order_payments/);
  assert.match(schema, /order_comments/);
  assert.doesNotMatch(schema, /"payable"|"commentable"/);
});
