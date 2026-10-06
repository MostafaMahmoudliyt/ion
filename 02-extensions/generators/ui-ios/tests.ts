import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, BUNDLE_ID } from './index.ts';
import { mit, specsOf } from '../../../test/helpers.ts';

const out = generate(specsOf());

test('ui-ios: XcodeGen project + Swift sources + the spec resource, deterministic', () => {
  assert.deepEqual(Object.keys(out).sort(), ['Resources/ui_spec.json', 'Sources/Data.swift', 'Sources/Spec.swift', 'Sources/IonApp.swift', 'Sources/Views.swift', 'project.yml'].sort());
  assert.deepEqual(generate(specsOf(JSON.parse(JSON.stringify(mit)))), out);
  assert.deepEqual(JSON.parse(out['Resources/ui_spec.json']), JSON.parse(JSON.stringify(specsOf().ui_spec.ui_spec)));
});

test('ui-ios: project.yml names the sources, resources, bundle id and keeps ATS on', () => {
  const p = out['project.yml'];
  assert.match(p, /sources: \[Sources, Resources\]/);
  assert.match(p, /projectFormat: xcode15_3/);
  assert.ok(p.includes(`PRODUCT_BUNDLE_IDENTIFIER: ${BUNDLE_ID}`));
  assert.match(p, /ION_API: ""/); assert.match(p, /ION_PERMISSIONS: ""/);
  assert.doesNotMatch(p, /NSAllowsArbitraryLoads/);
  assert.ok(!p.includes('\t'), 'YAML must not contain tabs');
});

test('ui-ios: Swift is balanced, @main exactly once, same permission keys and API ops as the spec, no dynamic code', () => {
  let mains = 0;
  for (const [name, text] of Object.entries(out)) {
    if (!name.endsWith('.swift')) continue;
    mains += (text.match(/^@main$/gm) ?? []).length;
    const strip = text.replace(/"(?:\\.|[^"\\])*"/g, '""');
    for (const [o, c] of [['(', ')'], ['{', '}'], ['[', ']']]) assert.equal(strip.split(o).length, strip.split(c).length, `${name}: ${o}${c}`);
    assert.doesNotMatch(text, /NSExpression|dlopen|NSClassFromString|JSContext|evaluateJavaScript|Process\(\)/);
    assert.ok(!text.includes('PKG'));
  }
  assert.equal(mains, 1);
  const views = out['Sources/Views.swift'];
  for (const op of ['list', 'create', 'update', 'archive']) assert.ok(views.includes(`entity:\\(src.entity):${op}`) || views.includes(`entity:\\($0.entity):${op}`), op);
  const data = out['Sources/Data.swift'];
  for (const op of ['list', 'read', 'create', 'update', 'archive']) assert.ok(data.includes(`path("${op}")`), op);
});
