import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, FRONTEND_DIST, IDENTIFIER } from './index.ts';
import { mit, specsOf } from '../../../test/helpers.ts';

const out = generate(specsOf());

test('ui-desktop: Tauri 2 project files, valid JSON, deterministic', () => {
  for (const f of ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/build.rs', 'src-tauri/src/main.rs', 'src-tauri/capabilities/default.json', 'README.md']) assert.ok(out[f] !== undefined, f);
  for (const f of Object.keys(out).filter((x) => x.endsWith('.json'))) JSON.parse(out[f]);
  assert.deepEqual(generate(specsOf(JSON.parse(JSON.stringify(mit)))), out);
});

test('ui-desktop: loads the sibling web output, own-files CSP, no fs/shell capability', () => {
  const conf = JSON.parse(out['src-tauri/tauri.conf.json']);
  assert.equal(conf.build.frontendDist, FRONTEND_DIST);
  assert.equal(conf.identifier, IDENTIFIER);
  assert.equal(conf.app.windows[0].url, 'demo.html');
  assert.equal(conf.app.windows[0].label, 'main');
  assert.match(conf.app.security.csp, /default-src 'self'/);
  assert.doesNotMatch(conf.app.security.csp, /\*|https?:/);
  const cap = JSON.parse(out['src-tauri/capabilities/default.json']);
  assert.deepEqual(cap.permissions, ['core:default']);
  assert.deepEqual(cap.windows, ['main']);
  assert.doesNotMatch(JSON.stringify(out), /"fs:|"shell:|plugin-shell|plugin-fs/);
});
