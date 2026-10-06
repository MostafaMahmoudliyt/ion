import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATOR_KINDS, IonValidationError, runGenerators, safeRelativePath, validateManifest } from '../src/index.ts';
import { mit, specsOf } from './helpers.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, '02-extensions');
const failsWith = async (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: any) => e instanceof IonValidationError && e.issues.some((i: any) => i.code === code), code);

const manifest = (o: object = {}) => ({ id: 'fake', kind: 'utility', version: '1.0.0', official: false, entry: 'index.js', reads: ['schema'], ion: '3.0.0', description: 'test', ...o });

// A throw-away extensions folder with one fake generator.
function fake(body: string, m: object = {}, entry: object = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ion-ext-'));
  mkdirSync(join(dir, 'generators', 'fake'), { recursive: true });
  writeFileSync(join(dir, 'generators', 'fake', 'index.js'), body);
  const mf = manifest({ official: true, ...m }); // official, so the default run picks it up
  writeFileSync(join(dir, 'generators', 'fake', 'manifest.json'), JSON.stringify(mf));
  writeFileSync(join(dir, 'registry.json'), JSON.stringify({ generators: [{ id: 'fake', path: 'generators/fake', version: mf.version, official: mf.official, ...entry }] }));
  return dir;
}

test('registry: every entry has a valid manifest, an entry file, tests and a README (sections 40, 41)', () => {
  const registry = JSON.parse(readFileSync(join(EXT, 'registry.json'), 'utf8')).generators;
  assert.deepEqual(registry.map((g: any) => g.id), ['sql-postgres', 'events-node-postgres', 'ui-web', 'api-rest', 'ui-terminal', 'ui-android', 'ui-ios', 'ui-desktop', 'cloud-cloudflare', 'ui-advanced', 'server-node-sqlite']);
  assert.equal(new Set(registry.map((g: any) => g.id)).size, registry.length);
  for (const entry of registry) {
    const dir = join(EXT, entry.path);
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    assert.deepEqual(validateManifest(m, entry), [], entry.id);
    for (const f of [m.entry, 'tests.ts', 'README.md']) assert.ok(existsSync(join(dir, f)), `${entry.id}/${f}`);
  }
  // nothing in the folder is outside the registry
  assert.deepEqual(readdirSync(join(EXT, 'generators')).sort(), registry.map((g: any) => g.id).sort());
  assert.equal(GENERATOR_KINDS.length, 5);
});

test('manifest validation: closed kinds, semantic version, safe entry, compatible Ion, registry agreement', () => {
  const codes = (m: unknown, e?: any) => validateManifest(m, e).map((i) => i.code);
  assert.deepEqual(codes(manifest()), []);
  assert.ok(codes(manifest({ id: 'Bad Id' })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest({ kind: 'framework' })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest({ version: '1.0' })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest({ entry: '../outside.js' })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest({ entry: '/etc/passwd' })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest({ reads: [] })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest({ reads: ['publish'] })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest({ ion: '4.0.0' })).includes('INCOMPATIBLE_ION'));
  assert.ok(codes(manifest({ official: 'yes' })).includes('INVALID_MANIFEST'));
  assert.ok(codes(manifest(), { id: 'fake', version: '2.0.0', official: false, path: 'x' }).includes('REGISTRY_MISMATCH'));
  assert.deepEqual(codes(null), ['INVALID_MANIFEST']);
});

test('generators may only write plain relative paths', () => {
  for (const ok of ['a.sql', 'dir/b.js', 'a/b/c.txt']) assert.ok(safeRelativePath(ok), ok);
  for (const bad of ['', '/abs', '../up', 'a/../b', './a', 'a//b', 'a\\b', 'a/', 'x\0y', 'a'.repeat(201)]) assert.ok(!safeRelativePath(bad), JSON.stringify(bad));
});

test('runner: default is every official generator; an explicit id runs only that one', async () => {
  const specs = specsOf();
  const all = await runGenerators(specs, EXT);
  assert.deepEqual(all.map((r) => r.id), ['sql-postgres', 'events-node-postgres', 'ui-web', 'api-rest', 'ui-terminal', 'ui-android', 'ui-ios', 'ui-desktop', 'cloud-cloudflare', 'ui-advanced', 'server-node-sqlite']);
  const one = await runGenerators(specs, EXT, ['api-rest']);
  assert.deepEqual(one.map((r) => r.id), ['api-rest']);
  assert.deepEqual(Object.keys(one[0].files), ['routes.js']);
  await failsWith(runGenerators(specs, EXT, ['sql-oracle']), 'UNKNOWN_GENERATOR');
});

test('runner: tampered specs are rejected before any generator runs', async () => {
  const specs = JSON.parse(JSON.stringify(specsOf()));
  specs.schema_spec.schema_spec.tables[0].columns[1].type = 'text';
  await failsWith(runGenerators(specs, EXT), 'INVALID_ATTRIBUTE_TYPE');
});

test('runner: a generator cannot escape its sandbox, return non-strings, or skip generate()', async () => {
  const specs = specsOf();
  await failsWith(runGenerators(specs, fake("export function generate() { return { '../evil.txt': 'x' }; }")), 'UNSAFE_PATH');
  await failsWith(runGenerators(specs, fake("export function generate() { return { '/etc/x': 'x' }; }")), 'UNSAFE_PATH');
  await failsWith(runGenerators(specs, fake("export function generate() { return { 'a.txt': 5 }; }")), 'INVALID_GENERATOR');
  await failsWith(runGenerators(specs, fake('export const nothing = 1;')), 'INVALID_GENERATOR');
  await failsWith(runGenerators(specs, fake('export function generate() { return {}; }', { ion: '9.0.0' })), 'INCOMPATIBLE_ION');
  await failsWith(runGenerators(specs, fake('export function generate() { return {}; }', {}, { version: '2.0.0' })), 'REGISTRY_MISMATCH');
  await failsWith(runGenerators(specs, fake('export function generate() { return {}; }', {}, { path: '../outside' })), 'UNSAFE_PATH');
});

test('runner: a generator that mutates its input cannot change the specs Core holds', async () => {
  const specs = specsOf();
  const before = JSON.stringify(specs);
  const dir = fake("export function generate(specs) { specs.schema_spec.schema_spec.tables.length = 0; return { 'ok.txt': 'x' }; }", { official: true }, { official: true });
  const [run] = await runGenerators(specs, dir);
  assert.deepEqual(run.files, { 'ok.txt': 'x' });
  assert.equal(JSON.stringify(specs), before);
});

test('cli: build writes exactly the five specs; preview adds every official generator; reruns are byte-identical', () => {
  const cli = join(ROOT, 'src', 'cli.ts');
  const run = (cmd: string, out: string) => execFileSync('node', [cli, cmd, join(ROOT, 'examples', 'mit.json'), '--out', out], { encoding: 'utf8' });
  const list = (dir: string, prefix = ''): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? list(join(dir, d.name), prefix + d.name + '/') : [prefix + d.name])).sort();
  const a = mkdtempSync(join(tmpdir(), 'ion-cli-'));
  const b = mkdtempSync(join(tmpdir(), 'ion-cli-'));
  run('build', a);
  assert.deepEqual(list(a), ['specs/event_spec.json', 'specs/relationship_spec.json', 'specs/schema_spec.json', 'specs/uapp_spec.json', 'specs/ui_spec.json']);
  const p1 = mkdtempSync(join(tmpdir(), 'ion-cli-'));
  run('preview', p1); run('preview', b);
  const files = list(p1);
  assert.ok(files.includes('generated/ui-web/app.js') && files.includes('generated/sql-postgres/0001_schema.sql') && files.includes('specs/ui_spec.json'));
  assert.deepEqual(list(b), files);
  for (const f of files) assert.equal(readFileSync(join(p1, f), 'utf8'), readFileSync(join(b, f), 'utf8'), f);
  // an invalid definition fails with exit code 1 and writes nothing
  const bad = join(a, 'bad.json');
  writeFileSync(bad, JSON.stringify({ entities: [{ id: 'x y', name: 'X', type: 'custom', attributes: [] }] }));
  assert.throws(() => execFileSync('node', [cli, 'build', bad, '--out', join(a, 'never')], { stdio: 'pipe' }), (e: any) => e.status === 1 && /INVALID_ID/.test(String(e.stderr)));
  assert.ok(!existsSync(join(a, 'never')));
  // publish on an invalid definition fails the same way and writes nothing
  assert.throws(() => execFileSync('node', [cli, 'publish', bad, '--out', join(a, 'never2')], { stdio: 'pipe' }), (e: any) => e.status === 1);
  assert.ok(!existsSync(join(a, 'never2')));
});

test('the same definition reaches the same bytes through every layer (specs and all official generators)', async () => {
  const x = await runGenerators(specsOf(mit), EXT);
  const y = await runGenerators(specsOf(JSON.parse(JSON.stringify(mit))), EXT);
  assert.deepEqual(x, y);
});
