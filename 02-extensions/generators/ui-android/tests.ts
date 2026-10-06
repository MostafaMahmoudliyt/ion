import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, PACKAGE } from './index.ts';
import { mit, specsOf } from '../../../test/helpers.ts';

const out = generate(specsOf());

test('ui-android: a complete Gradle/Compose project layout, deterministic', () => {
  const dir = PACKAGE.replace(/\./g, '/');
  for (const f of ['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties', 'app/build.gradle.kts', 'app/src/main/AndroidManifest.xml', 'app/src/main/assets/ui_spec.json',
    `app/src/main/kotlin/${dir}/MainActivity.kt`, `app/src/main/kotlin/${dir}/Spec.kt`, `app/src/main/kotlin/${dir}/Data.kt`, `app/src/main/kotlin/${dir}/Screens.kt`]) assert.ok(out[f] !== undefined, f);
  assert.deepEqual(generate(specsOf(JSON.parse(JSON.stringify(mit)))), out);
});

test('ui-android: the spec asset is exactly ui_spec; sources carry the package and no template placeholder', () => {
  assert.deepEqual(JSON.parse(out['app/src/main/assets/ui_spec.json']), JSON.parse(JSON.stringify(specsOf().ui_spec.ui_spec)));
  for (const [name, text] of Object.entries(out)) if (name.endsWith('.kt')) { assert.match(text, new RegExp(`^package ${PACKAGE.replace(/\./g, '\\.')}\\n`)); assert.doesNotMatch(text, /\bPKG\b/, name); }
});

test('ui-android: manifest is RTL-aware, HTTPS only, one launcher activity; gradle ids match the package', () => {
  const m = out['app/src/main/AndroidManifest.xml'];
  assert.match(m, /android:supportsRtl="true"/);
  assert.match(m, /usesCleartextTraffic="false"/);
  assert.equal((m.match(/<activity /g) ?? []).length, 1);
  assert.match(m, /android\.intent\.category\.LAUNCHER/);
  assert.match(out['app/build.gradle.kts'], new RegExp(`applicationId = "${PACKAGE.replace(/\./g, '\\.')}"`));
  assert.match(out['app/build.gradle.kts'], /buildConfig = true/); // MainActivity reads BuildConfig
});

test('ui-android: Kotlin is balanced, uses the same permission keys and API paths as the spec, and runs no dynamic code', () => {
  for (const [name, text] of Object.entries(out)) {
    if (!name.endsWith('.kt')) continue;
    const strip = text.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])'/g, "''");
    for (const [o, c] of [['(', ')'], ['{', '}'], ['[', ']']]) assert.equal(strip.split(o).length, strip.split(c).length, `${name}: ${o}${c}`);
    assert.doesNotMatch(text, /Runtime\.getRuntime|ProcessBuilder|DexClassLoader|Class\.forName|evaluateJavascript|loadUrl/);
  }
  const screens = out[Object.keys(out).find((k) => k.endsWith('Screens.kt'))!];
  assert.match(screens, /"entity:" \+ it\.entity \+ ":list"/);
  assert.match(screens, /":update"/); assert.match(screens, /":archive"/); assert.match(screens, /":create"/);
  const data = out[Object.keys(out).find((k) => k.endsWith('Data.kt'))!];
  for (const op of ['list', 'read', 'create', 'update', 'archive']) assert.match(data, new RegExp(`api\\("${op}"\\)`));
  const spec = specsOf().ui_spec.ui_spec;
  for (const ds of spec.data_sources) for (const op of ['list', 'read', 'create', 'update', 'archive']) assert.ok((ds.api as any)[op]?.path, `${ds.id}.${op}`);
});
