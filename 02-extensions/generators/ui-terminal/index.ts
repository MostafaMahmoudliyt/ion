// Terminal Renderer (constitution sections 6, 66). An Extension, not Core.
// ui_spec -> a dependency-free Node terminal app. Pure, deterministic: same ui_spec => same bytes.
import { RUNTIME_JS } from './runtime.ts';

type Obj = Record<string, any>; // validated spec JSON

// JSON embedded in a script: safe regardless of where it is pasted.
const embed = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function generate(specs: Obj): Record<string, string> {
  const ui = specs.ui_spec.ui_spec;
  const tui =
    '#!/usr/bin/env node\n// Ion ui-terminal. Deterministic: same ui_spec => same output. Generated, do not edit.\n' +
    '// Run: node tui.cjs --demo   |   ION_PERMISSIONS="entity:student:list,..." node tui.cjs --api http://localhost:3000\n' +
    '"use strict";\n(function () {\n  var SPEC = ' + embed(ui) + ';\n' + RUNTIME_JS + '})();\n';
  return {
    'tui.cjs': tui,
    'package.json': JSON.stringify({ name: 'ion-tui', private: true, version: '1.0.0', engines: { node: '>=18' }, scripts: { demo: 'node tui.cjs --demo', start: 'node tui.cjs --api http://localhost:3000' } }, null, 2) + '\n',
  };
}
