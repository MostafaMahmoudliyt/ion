import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { bundleText, buildApp, buildUapp, createBundle } from '../src/index.ts';
import { mit } from './helpers.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, '02-extensions');
const bundle = () => bundleText(createBundle(buildApp(mit, JSON.parse(readFileSync(join(EXT, 'registry.json'), 'utf8')).generators.map((g: any) => g.id))));

test('.uapp holds one folder per platform: web, ios, android, desktop, terminal, backend/*, cloud/* (the layout you decided on)', async () => {
  const uapp = await buildUapp(bundle(), EXT);
  const folders = uapp.manifest.uapp.entries.map((e) => e.path);
  assert.deepEqual(folders, ['android', 'backend/api', 'backend/database', 'backend/events', 'backend/server', 'cloud/cloudflare', 'desktop', 'ios', 'terminal', 'web', 'web']); // web twice: ui-web and the ui-advanced overlay share the folder
  assert.ok(uapp.files['android/app/src/main/AndroidManifest.xml'] && uapp.files['ios/project.yml'] && uapp.files['desktop/src-tauri/tauri.conf.json'] && uapp.files['terminal/tui.cjs'] && uapp.files['web/index.html']);
  // every platform renders the very same ui_spec
  const spec = JSON.parse(JSON.stringify(buildApp(mit).specs.ui_spec.ui_spec));
  assert.deepEqual(JSON.parse(uapp.files['android/app/src/main/assets/ui_spec.json']), spec);
  assert.deepEqual(JSON.parse(uapp.files['ios/Resources/ui_spec.json']), spec);
  assert.ok(uapp.files['web/app.js'].includes(JSON.stringify(spec.theme.primary_color)));
  assert.ok(uapp.files['terminal/tui.cjs'].includes(JSON.stringify(spec.data_sources[0].id)));
});

test('cross-target paths resolve inside the .uapp: desktop and cloudflare point at the real web output', async () => {
  const uapp = await buildUapp(bundle(), EXT);
  const conf = JSON.parse(uapp.files['desktop/src-tauri/tauri.conf.json']);
  const dist = posix.normalize(posix.join('desktop/src-tauri', conf.build.frontendDist));
  assert.equal(dist, 'web');
  assert.ok(uapp.files[`${dist}/${conf.app.windows[0].url}`] !== undefined, 'the window url exists in web/');
  const toml = uapp.files['cloud/cloudflare/wrangler.toml'];
  const dir = /directory = "([^"]+)"/.exec(toml)![1];
  assert.equal(posix.normalize(posix.join('cloud/cloudflare', dir)), 'web');
  assert.ok(uapp.files['web/index.html']);
});

test('without ui-web the web-dependent targets are the caller\'s choice: a subset deploys exactly what was chosen', async () => {
  const uapp = await buildUapp(bundle(), EXT, ['ui-android', 'ui-ios']);
  assert.deepEqual(uapp.manifest.uapp.entries.map((e) => e.path), ['android', 'ios']);
  assert.ok(!Object.keys(uapp.files).some((f) => f.startsWith('web/')));
});

test('cli --generators: preview, publish and deploy honour the choice (section 42)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ion-gen-'));
  const cli = join(ROOT, 'src', 'cli.ts');
  const def = join(ROOT, 'examples', 'mit.json');
  const run = (...a: string[]) => execFileSync('node', [cli, ...a], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  run('preview', def, '--out', 'p', '--generators', 'ui-web,ui-terminal');
  assert.deepEqual(readdirSync(join(dir, 'p', 'generated')).sort(), ['ui-terminal', 'ui-web']);
  run('publish', def, '--out', 'b', '--generators', 'ui-ios');
  run('deploy', 'b/university.ion', 'd');
  assert.deepEqual(readdirSync(join(dir, 'd', 'university.uapp')).sort(), ['ios', 'manifest.json']); // the choice recorded in the .ion
  run('deploy', 'b/university.ion', 'd2', '--generators', 'ui-android,ui-web'); // override at deploy time
  assert.deepEqual(readdirSync(join(dir, 'd2', 'university.uapp')).sort(), ['android', 'manifest.json', 'web']);
  assert.throws(() => run('deploy', 'b/university.ion', 'd3', '--generators', 'nope'), (e: any) => e.status === 1 && /UNKNOWN_GENERATOR/.test(String(e.stderr)));
  assert.ok(!existsSync(join(dir, 'd3')));
});
