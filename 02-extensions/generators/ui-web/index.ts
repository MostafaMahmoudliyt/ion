// UI Generator / Web Renderer (constitution sections 50, 62). An Extension, not Core.
// ui_spec -> a dependency-free web app. app.js is a classic script (no modules, no build step),
// so index.html also works when opened straight from disk.
import { RUNTIME_JS } from './runtime.ts';
import { STYLES_CSS } from './styles.ts';

type Obj = Record<string, any>; // validated spec JSON

// JSON embedded in a script: make the line separators and "</" safe regardless of where it is pasted.
const embed = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function page(title: string, locale: string, body: string): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return [
    '<!doctype html>',
    `<html lang="${locale}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<link rel="stylesheet" href="styles.css">',
    '</head>',
    '<body>',
    '<div id="app"></div>',
    '<script src="ui_advanced.js"></script>', // optional overlay from the ui-advanced extension; harmless if absent
    '<script src="app.js"></script>',
    '<script>',
    body,
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function generate(specs: Obj): Record<string, string> {
  const ui = specs.ui_spec.ui_spec;
  const locale = ui.default_locale;
  const css = STYLES_CSS.replace('/* Ion UI:', '/* Ion ui-web:') + `:root { --primary: ${ui.theme.primary_color}; }\n.ion a, .ion .link { color: var(--primary); }\n.ion [hidden] { display: none !important; }\n.ion .empty { padding: 2rem 0; }\n.ion .review { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin-block-end: 1rem; }\n`;
  const app =
    '// Ion ui-web. Deterministic: same ui_spec => same output. Generated, do not edit.\n' +
    '(function () {\n  "use strict";\n  var SPEC = ' + embed(ui) + ';\n' + RUNTIME_JS + '})();\n';
  return {
    'app.js': app,
    'styles.css': css,
    // Real backend: supply permissions from your authentication layer. Nothing is visible until you do.
    'index.html': page('Ion app', locale,
      "  Ion.start({\n    root: document.getElementById('app'),\n    dataSource: Ion.createRestDataSource({ baseUrl: '' }),\n    permissions: [], // e.g. ['entity:student:list', 'entity:student:read'] or a function (key) => boolean\n    locale: '" + locale + "'\n  });"),
    // Preview: in-memory data, every permission granted. For looking at the generated UI, not for production.
    'demo.html': page('Ion app (demo)', locale,
      "  Ion.start({\n    root: document.getElementById('app'),\n    dataSource: Ion.createMemoryDataSource(),\n    permissions: '*',\n    locale: '" + locale + "'\n  });"),
  };
}
