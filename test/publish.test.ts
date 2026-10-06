import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Ion, IonValidationError, buildApp, buildUapp, createBundle, bundleText, bundleFileName, openBundle,
  validateUappSpec, specFiles, validateDefinition,
} from '../src/index.ts';
import { mit } from './helpers.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, '02-extensions');
const CLI = join(ROOT, 'src', 'cli.ts');
const tmp = () => mkdtempSync(join(tmpdir(), 'ion-pub-'));
const failsWith = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: any) => e instanceof IonValidationError && e.issues.some((i: any) => i.code === code), code);
const list = (dir: string, prefix = ''): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? list(join(dir, d.name), prefix + d.name + '/') : [prefix + d.name])).sort();

test('publish engine: uapp_spec has the section 35 shape, a manifest hash over the four specs, no timestamps', () => {
  const b = buildApp(mit, ['ui-web', 'sql-postgres', 'ui-web']);
  const u = b.uapp_spec.uapp_spec;
  assert.deepEqual(Object.keys(u), ['ion_version', 'app', 'genome', 'specs', 'manifest_hash', 'generators_used']);
  assert.deepEqual(u.app, { id: 'university', name: 'University', domain: 'education' });
  assert.equal(u.ion_version, '3.1.0');
  assert.equal(u.genome.direction, u.genome.locale === 'ar' ? 'rtl' : 'ltr');
  assert.deepEqual(u.specs, { schema: 'schema_spec.json', relationship: 'relationship_spec.json', event: 'event_spec.json', ui: 'ui_spec.json' });
  assert.match(u.manifest_hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(u.generators_used, ['sql-postgres', 'ui-web']); // sorted, de-duplicated
  assert.deepEqual(Object.keys(b.files), ['schema_spec.json', 'relationship_spec.json', 'event_spec.json', 'ui_spec.json', 'uapp_spec.json']);
  assert.doesNotMatch(b.files['uapp_spec.json'], /\d{4}-\d{2}-\d{2}T/);
});

test('publish engine: deterministic, and the hash follows the specs', () => {
  assert.equal(buildApp(mit).files['uapp_spec.json'], buildApp(JSON.parse(JSON.stringify(mit))).files['uapp_spec.json']);
  const other = JSON.parse(JSON.stringify(mit));
  other.entities[0].attributes.push({ name: 'nickname', type: 'string' });
  assert.notEqual(buildApp(other).uapp_spec.uapp_spec.manifest_hash, buildApp(mit).uapp_spec.uapp_spec.manifest_hash);
  // the app block never changes the specs, only uapp_spec
  const renamed = { ...mit, app: { id: 'uni', name: 'Uni', domain: 'x' } };
  assert.equal(buildApp(renamed).uapp_spec.uapp_spec.manifest_hash, buildApp(mit).uapp_spec.uapp_spec.manifest_hash);
});

test('app block: optional, defaults, and validated', () => {
  const { app, ...bare } = mit;
  assert.deepEqual(buildApp(bare).uapp_spec.uapp_spec.app, { id: 'app', name: 'App', domain: 'general' });
  failsWith(() => buildApp({ ...mit, app: { id: 'Bad Id' } }), 'INVALID_APP');
  failsWith(() => buildApp({ ...mit, app: 'x' }), 'INVALID_APP');
  assert.ok(validateDefinition({ ...mit, app: { name: '' } }).some((i) => i.code === 'INVALID_APP'));
  failsWith(() => buildApp(mit, ['../evil']), 'INVALID_GENERATOR_ID');
});

test('validateUappSpec: rejects tampered specs, wrong spec names and a foreign major version', () => {
  const b = buildApp(mit);
  assert.deepEqual(validateUappSpec(b.uapp_spec, specFiles(b.specs)), []);
  const files = specFiles(b.specs);
  files['ui_spec.json'] += ' ';
  assert.ok(validateUappSpec(b.uapp_spec, files).some((i) => i.code === 'MANIFEST_MISMATCH'));
  const u = structuredClone(b.uapp_spec);
  u.uapp_spec.specs.ui = 'x.json'; u.uapp_spec.ion_version = '4.0.0';
  const codes = validateUappSpec(u, specFiles(b.specs)).map((i) => i.code);
  assert.ok(codes.includes('INVALID_SPEC') && codes.includes('INCOMPATIBLE_ION'));
  assert.equal(validateUappSpec(undefined, {}).length, 1);
});

test('.ion bundle: five specs + metadata + hash, round-trips, rejects edits', () => {
  const built = buildApp(mit);
  const bundle = createBundle(built);
  assert.equal(bundleFileName(bundle), 'university.ion');
  assert.deepEqual(Object.keys(bundle.ion_bundle.specs), ['schema_spec.json', 'relationship_spec.json', 'event_spec.json', 'ui_spec.json', 'uapp_spec.json']);
  const text = bundleText(bundle);
  assert.equal(text, bundleText(createBundle(buildApp(mit))));
  const opened = openBundle(text);
  assert.equal(JSON.stringify(opened.specs), JSON.stringify(built.specs)); // what is serialised is identical
  // editing a spec inside the bundle after publishing is refused
  const edited = JSON.parse(text);
  edited.ion_bundle.specs['schema_spec.json'].schema_spec.tables[0].name = 'Hacked';
  failsWith(() => openBundle(JSON.stringify(edited)), 'MANIFEST_MISMATCH');
  failsWith(() => openBundle('{not json'), 'INVALID_JSON');
  failsWith(() => openBundle('{"x":1}'), 'INVALID_BUNDLE');
  const major = JSON.parse(text); major.ion_bundle.ion_version = '9.0.0';
  failsWith(() => openBundle(JSON.stringify(major)), 'INCOMPATIBLE_ION');
  const missing = JSON.parse(text); delete missing.ion_bundle.specs['event_spec.json'];
  failsWith(() => openBundle(JSON.stringify(missing)), 'MISSING_SPEC');
});

test('.uapp: a folder per target + manifest.json listing every file with its hash; deterministic', async () => {
  const text = bundleText(createBundle(buildApp(mit, ['ui-web', 'sql-postgres', 'events-node-postgres', 'api-rest'])));
  const a = await buildUapp(text, EXT);
  const b = await buildUapp(text, EXT);
  assert.deepEqual(a, b);
  assert.equal(a.dir, 'university.uapp');
  const paths = Object.keys(a.files);
  assert.ok(paths.includes('manifest.json') && paths.includes('web/app.js') && paths.includes('web/index.html'));
  assert.ok(paths.some((p) => p.startsWith('backend/database/')) && paths.some((p) => p.startsWith('backend/events/')) && paths.some((p) => p.startsWith('backend/api/')));
  const m = a.manifest.uapp;
  assert.equal(m.source_manifest_hash, openBundle(text).uapp_spec.uapp_spec.manifest_hash);
  assert.deepEqual(JSON.parse(a.files['manifest.json']), a.manifest);
  // every manifest entry matches the file really there
  const { createHash } = await import('node:crypto');
  for (const e of m.entries) for (const f of e.files) {
    const content = a.files[`${e.path}/${f.path}`];
    assert.equal(createHash('sha256').update(content).digest('hex'), f.sha256);
    assert.equal(Buffer.byteLength(content), f.bytes);
  }
  assert.equal(m.entries.reduce((n, e) => n + e.files.length, 0), paths.length - 1);
  // choosing generators narrows the app; an unknown one is refused
  const only = await buildUapp(text, EXT, ['ui-web']);
  assert.deepEqual(only.manifest.uapp.entries.map((e) => e.generator), ['ui-web']);
  await assert.rejects(buildUapp(text, EXT, ['nope']), (e: any) => e.issues?.some((i: any) => i.code === 'UNKNOWN_GENERATOR'));
});

test('.uapp: a tampered bundle never reaches the generators', async () => {
  const edited = JSON.parse(bundleText(createBundle(buildApp(mit))));
  edited.ion_bundle.specs['ui_spec.json'].ui_spec.theme.primary_color = '#000000';
  await assert.rejects(buildUapp(JSON.stringify(edited), EXT), (e: any) => e.issues?.some((i: any) => i.code === 'MANIFEST_MISMATCH'));
});

test('library API (section 24): define x3, build, publish', async () => {
  const t = new Ion({ app: { id: 'school', name: 'School', domain: 'education' } });
  t.define('entity', 'Student', { type: 'person', attributes: [{ name: 'name', type: 'string', required: true }] });
  t.define('entity', 'Course', { type: 'course', attributes: [{ name: 'title', type: 'string' }] });
  t.define('relationship', 'enrollment', { from: 'student', to: 'course', type: 'many-to-many' });
  t.define('event', 'student.enrolled', { actor: 'student', target: 'course', triggers: [{ action: 'log' }] });
  const uapp = await t.build();
  assert.equal(uapp.uapp_spec.app.id, 'school');
  const { file, content } = await t.publish(uapp);
  assert.equal(file, 'school.ion');
  assert.equal(openBundle(content).uapp_spec.uapp_spec.manifest_hash, uapp.uapp_spec.manifest_hash);
  // same calls, same bytes
  const t2 = new Ion({ app: { id: 'school', name: 'School', domain: 'education' } });
  t2.define('entity', 'Student', { type: 'person', attributes: [{ name: 'name', type: 'string', required: true }] })
    .define('entity', 'Course', { type: 'course', attributes: [{ name: 'title', type: 'string' }] })
    .define('relationship', 'enrollment', { from: 'student', to: 'course', type: 'many-to-many' })
    .define('event', 'student.enrolled', { actor: 'student', target: 'course', triggers: [{ action: 'log' }] });
  assert.equal((await t2.publish(await t2.build())).content, content);
  // guards
  failsWith(() => t.define('entity', 'Student', { attributes: [] }), 'INVALID_DEFINE');
  failsWith(() => t.define('widget' as any, 'x', {}), 'INVALID_DEFINE');
  t.define('entity', 'Teacher', { attributes: [{ name: 'name', type: 'string' }] });
  await assert.rejects(t.publish(uapp), (e: any) => e.issues?.[0]?.code === 'STALE_BUILD'); // a new define() makes the earlier build stale
  const bad = new Ion();
  bad.define('entity', 'Bad', { id: 'bad id', attributes: [] });
  await assert.rejects(bad.build(), (e: any) => e instanceof IonValidationError);
});

test('cli: init -> add -> build -> publish -> deploy, end to end (sections 23, 29)', () => {
  const dir = tmp();
  const run = (...a: string[]) => execFileSync('node', [CLI, ...a], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  run('init', 'shop');
  assert.ok(existsSync(join(dir, 'shop', 'ion.json')));
  assert.throws(() => run('init', 'shop'), (e: any) => e.status === 1);
  assert.throws(() => run('init', 'Bad Name'), (e: any) => e.status === 2);
  const project = join(dir, 'shop', 'ion.json');
  const put = (name: string, v: unknown) => { writeFileSync(join(dir, name), JSON.stringify(v)); return name; };
  run('add', 'entity', put('p.json', { name: 'Product', type: 'product', attributes: [{ name: 'title', type: 'string' }] }), '--id', 'product', '--to', project);
  run('add', 'entity', put('c.json', { name: 'Customer', type: 'person', attributes: [{ name: 'name', type: 'string' }] }), '--id', 'customer', '--to', project);
  run('add', 'relation', put('r.json', { from: 'customer', to: 'product', type: 'many-to-many' }), '--id', 'purchase', '--to', project);
  run('add', 'event', put('e.json', { actor: 'customer', target: 'product', triggers: [{ action: 'log' }] }), '--id', 'customer.bought', '--to', project);
  // nothing is replaced, nothing invalid is written
  assert.throws(() => run('add', 'entity', 'p.json', '--id', 'product', '--to', project), (e: any) => e.status === 1);
  const before = readFileSync(project, 'utf8');
  assert.throws(() => run('add', 'relation', put('bad.json', { from: 'ghost', to: 'product', type: 'one-to-many' }), '--id', 'broken', '--to', project), (e: any) => e.status === 1 && /UNKNOWN_ENTITY/.test(String(e.stderr)));
  assert.equal(readFileSync(project, 'utf8'), before);

  run('build', project, '--out', 'o1');
  assert.deepEqual(list(join(dir, 'o1')), ['specs/event_spec.json', 'specs/relationship_spec.json', 'specs/schema_spec.json', 'specs/uapp_spec.json', 'specs/ui_spec.json']);
  run('publish', project, '--out', 'o2');
  assert.deepEqual(list(join(dir, 'o2')), ['shop.ion']);
  run('deploy', join('o2', 'shop.ion'), 'site');
  const files = list(join(dir, 'site'));
  assert.ok(files.includes('shop.uapp/manifest.json') && files.includes('shop.uapp/web/index.html') && files.includes('shop.uapp/backend/database/0001_schema.sql'));
  // the uapp_spec written by build and the one inside the bundle agree
  assert.equal(readFileSync(join(dir, 'o1', 'specs', 'uapp_spec.json'), 'utf8'), JSON.stringify(JSON.parse(readFileSync(join(dir, 'o2', 'shop.ion'), 'utf8')).ion_bundle.specs['uapp_spec.json'], null, 2) + '\n');
  // deploy twice: refuses, then --force replaces with identical bytes
  assert.throws(() => run('deploy', join('o2', 'shop.ion'), 'site'), (e: any) => e.status === 1 && /--force/.test(String(e.stderr)));
  const first = readFileSync(join(dir, 'site', 'shop.uapp', 'manifest.json'), 'utf8');
  run('deploy', join('o2', 'shop.ion'), 'site', '--force');
  assert.equal(readFileSync(join(dir, 'site', 'shop.uapp', 'manifest.json'), 'utf8'), first);
  // --force never deletes a folder that is not a .uapp
  mkdirSync(join(dir, 'site2', 'shop.uapp'), { recursive: true });
  writeFileSync(join(dir, 'site2', 'shop.uapp', 'precious.txt'), 'x');
  assert.throws(() => run('deploy', join('o2', 'shop.ion'), 'site2', '--force'), (e: any) => e.status === 1);
  assert.ok(existsSync(join(dir, 'site2', 'shop.uapp', 'precious.txt')));
  // a tampered .ion is refused by deploy and nothing is written
  const t = JSON.parse(readFileSync(join(dir, 'o2', 'shop.ion'), 'utf8'));
  t.ion_bundle.specs['schema_spec.json'].schema_spec.tables[0].name = 'X';
  writeFileSync(join(dir, 'tampered.ion'), JSON.stringify(t));
  assert.throws(() => run('deploy', 'tampered.ion', 'site3'), (e: any) => e.status === 1 && /MANIFEST_MISMATCH/.test(String(e.stderr)));
  assert.ok(!existsSync(join(dir, 'site3')));
});
