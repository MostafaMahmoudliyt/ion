// The `money` attribute type (constitution section 22, amended): whole minor units, never a float.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ATTRIBUTE_TYPES, WIDGETS, buildSpecs, validateDefinition } from '../src/index.ts';
import { entity, specsOf } from './helpers.ts';
import { generate as generatePg } from '../02-extensions/generators/sql-postgres/index.ts';

const def = (attrs: unknown[], events: unknown[] = []): any => ({ app: { id: 'shop', name: 'Shop' }, entities: [entity('item', attrs)], relationships: [], events });
const codes = (d: unknown): string[] => validateDefinition(d).map((i) => i.code);

test('money: is the 14th type, with its own widget', () => {
  assert.equal(ATTRIBUTE_TYPES.length, 14);
  assert.ok((ATTRIBUTE_TYPES as readonly string[]).includes('money'));
  assert.equal(WIDGETS.money, 'money');
});

test('money: definition rules (integer default, scale 0-4 and only on money)', () => {
  assert.deepEqual(codes(def([{ name: 'price', type: 'money', required: true, default: 12050, scale: 2 }])), []);
  assert.deepEqual(codes(def([{ name: 'price', type: 'money', scale: 0 }])), []);
  assert.deepEqual(codes(def([{ name: 'price', type: 'money', scale: 4 }])), []);
  assert.ok(codes(def([{ name: 'price', type: 'money', default: 120.5 }])).includes('INVALID_DEFAULT'), 'a float default is refused');
  assert.ok(codes(def([{ name: 'price', type: 'money', default: '12' }])).includes('INVALID_DEFAULT'));
  assert.ok(codes(def([{ name: 'price', type: 'money', scale: 5 }])).includes('INVALID_SCALE'));
  assert.ok(codes(def([{ name: 'price', type: 'money', scale: 1.5 }])).includes('INVALID_SCALE'));
  assert.ok(codes(def([{ name: 'qty', type: 'integer', scale: 2 }])).includes('SCALE_ON_NON_MONEY'));
});

test('money: specs carry the scale (default 2) and the UI gets the money widget with the same scale', () => {
  const s: any = specsOf(def([{ name: 'price', type: 'money' }, { name: 'fee', type: 'money', scale: 3 }]));
  const cols = s.schema_spec.schema_spec.tables[0].columns;
  assert.equal(cols.find((c: any) => c.name === 'price').scale, 2);
  assert.equal(cols.find((c: any) => c.name === 'fee').scale, 3);
  const f = s.ui_spec.ui_spec.data_sources[0].fields;
  assert.deepEqual([f.find((x: any) => x.name === 'price').widget, f.find((x: any) => x.name === 'price').scale, f.find((x: any) => x.name === 'fee').scale], ['money', 2, 3]);
  assert.equal(cols.find((c: any) => c.name === 'name'), undefined, 'scale only appears on money columns');
});

test('money: events can add to it with whole amounts only; other values must be whole minor units', () => {
  const base = (action: Record<string, unknown>) => def([{ name: 'balance', type: 'money', default: 0 }], [{ id: 'item.topup', name: 'Top up', actor: 'item', target: 'item', triggers: [action] }]);
  assert.deepEqual(codes(base({ action: 'increment', field: 'item.balance', on: 'target', by: 500 })), []);
  assert.ok(codes(base({ action: 'increment', field: 'item.balance', on: 'target', by: 5.5 })).includes('INVALID_AMOUNT'), 'half a minor unit does not exist');
  assert.ok(codes(base({ action: 'update_field', field: 'item.balance', on: 'target', value: 1.5 })).length > 0, 'a float value is refused');
  assert.deepEqual(codes(base({ action: 'update_field', field: 'item.balance', on: 'target', value: 150 })), []);
});

test('money: PostgreSQL stores it as BIGINT (never NUMERIC or a float)', () => {
  const sql = Object.values(generatePg(specsOf(def([{ name: 'price', type: 'money', required: true }])) as any)).join('\n');
  assert.match(sql, /"?price"?\s+BIGINT NOT NULL/i);
});

// the web and terminal runtimes parse and show money with string math; evaluate their helpers directly
const helpers = (file: string): any => {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');
  const a = src.indexOf('function moneyShow'), b = src.indexOf('function', src.indexOf('function moneyParse') + 10);
  return new Function(src.slice(a, b) + '; return { moneyShow, moneyParse };')();
};
for (const file of ['../02-extensions/generators/ui-web/runtime.ts', '../02-extensions/generators/ui-terminal/runtime.ts']) {
  test(`money: ${file.split('/').slice(-2).join('/')} shows and parses without floating point`, () => {
    const { moneyShow, moneyParse } = helpers(file);
    assert.equal(moneyShow(12050, 2), '120.50'); assert.equal(moneyShow(5, 2), '0.05'); assert.equal(moneyShow(0, 2), '0.00');
    assert.equal(moneyShow(-12050, 2), '-120.50'); assert.equal(moneyShow(1234, 0), '1234'); assert.equal(moneyShow(1234, 3), '1.234'); assert.equal(moneyShow(9007199254740991, 2), '90071992547409.91');
    assert.equal(moneyParse('120.50', 2), 12050); assert.equal(moneyParse('120.5', 2), 12050); assert.equal(moneyParse('120', 2), 12000);
    assert.equal(moneyParse('0.07', 2), 7); assert.equal(moneyParse('-3.10', 2), -310); assert.equal(moneyParse(' 8.00 ', 2), 800);
    assert.equal(moneyParse('1.005', 2), null, 'more decimals than the scale is refused, never rounded');
    assert.equal(moneyParse('', 2), null); assert.equal(moneyParse('abc', 2), null); assert.equal(moneyParse('1e3', 2), null); assert.equal(moneyParse('1,50', 2), null);
    assert.equal(moneyParse('99999999999999999.00', 2), null, 'beyond the safe integer range');
    assert.equal(moneyParse('0.1', 2) + moneyParse('0.2', 2), moneyParse('0.3', 2), '0.1 + 0.2 is exactly 0.3 in minor units');
    for (const n of [0, 1, 99, 100, 101, 12050, -1, -99, 123456789]) assert.equal(moneyParse(moneyShow(n, 2), 2), n, 'round trip ' + n);
  });
}

// ---------------------------------------------------------------- every renderer and the dashboard metrics
import { generate as genAdvanced } from '../02-extensions/generators/ui-advanced/index.ts';
import { generate as genWeb } from '../02-extensions/generators/ui-web/index.ts';
import { generate as genTerminal } from '../02-extensions/generators/ui-terminal/index.ts';
import { generate as genAndroid } from '../02-extensions/generators/ui-android/index.ts';
import { generate as genIos } from '../02-extensions/generators/ui-ios/index.ts';
import { generate as genDesktop } from '../02-extensions/generators/ui-desktop/index.ts';

const shopDef = def([{ name: 'price', type: 'money', required: true }, { name: 'fee', type: 'money', scale: 3 }, { name: 'qty', type: 'integer' }]);
const all = (files: Record<string, string>): string => Object.values(files).join('\n');

test('money: the dashboard declares an average per money column, carrying the scale, same as number and integer', () => {
  const a: any = JSON.parse(genAdvanced(specsOf(shopDef) as any)['ui_advanced.json']).ui_advanced;
  const m = a.entities.item.metrics;
  assert.deepEqual(m.map((x: any) => x.id), ['count', 'avg_price', 'avg_fee', 'avg_qty', 'trend_created_at']);
  assert.equal(m.find((x: any) => x.id === 'avg_price').scale, 2); assert.equal(m.find((x: any) => x.id === 'avg_fee').scale, 3);
  assert.equal(m.find((x: any) => x.id === 'avg_qty').scale, undefined, 'only money metrics carry a scale');
});

test('money: web, terminal, Android and iOS renderers all parse it, show it, and show it when editing (not raw minor units)', () => {
  const specs = specsOf(shopDef) as any;
  const web = all(genWeb(specs)), tui = all(genTerminal(specs)), kt = all(genAndroid(specs)), sw = all(genIos(specs));
  for (const [name, src] of [['web', web], ['terminal', tui], ['android', kt], ['ios', sw]] as const) {
    assert.match(src, /moneyParse/, `${name}: parses money text into minor units`);
    assert.match(src, /moneyShow/, `${name}: shows minor units as an amount`);
  }
  // an edit form must start from the formatted amount, otherwise saving would multiply it by 100
  assert.match(kt, /f\.widget == "money"\) moneyShow\(v, f\.scale\) else v\.toString\(\)/);
  assert.match(sw, /f\.widget == "money" \? moneyShow\(\$0, f\.scale\)/);
  assert.match(web, /f\.widget === 'money'\) return moneyShow\(v, f\.scale\)/);
  // lists and details go through the field-aware formatter, not the raw one
  assert.match(kt, /showField\(src\.field\(it\), row\.opt\(it\)\)/); assert.match(kt, /showField\(f, r\.opt\(f\.name\)\)/);
  assert.match(sw, /showField\(src\.field\(\$0\), row\[\$0\]\)/); assert.match(sw, /showField\(f, row\[name\]\)/);
  // the scale reaches the native field model
  assert.match(kt, /optInt\("scale", 2\)/); assert.match(sw, /scale = j\["scale"\] as\? Int \?\? 2/);
  assert.match(kt, /"money" -> moneyParse\(text, f\.scale\)/); assert.match(sw, /case "money": return moneyParse\(text, f\.scale\)/);
});

test('money: the desktop app serves the web output, so it gets the same money handling', () => {
  const specs = specsOf(shopDef) as any;
  const conf = all(genDesktop(specs));
  assert.match(conf, /\.\.\/\.\.\/web/, 'frontendDist points at the web renderer');
  assert.match(all(genWeb(specs)), /moneyParse/);
});
