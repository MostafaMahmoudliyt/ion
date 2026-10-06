import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './index.ts';
import { entity, mit, specsOf } from '../../../test/helpers.ts';

const routes = (def: unknown = mit) => {
  const js = generate(specsOf(def))['routes.js'];
  return JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1).replace(/,\n\]$/, ']').replace(/,(\s*\])/g, '$1')) as Array<Record<string, string>>;
};

test('api-rest: entity CRUD, relationship, notification and activity routes are all present', () => {
  const r = routes();
  const has = (m: string, p: string) => r.some((x) => x.method === m && x.path === p);
  for (const [m, p] of [['GET', '/api/students'], ['POST', '/api/students'], ['GET', '/api/students/:id'], ['PATCH', '/api/students/:id'], ['DELETE', '/api/students/:id'],
    ['GET', '/api/students/:id/notifications'], ['GET', '/api/students/:id/activity'], ['PATCH', '/api/notifications/:id/read'],
    ['POST', '/api/students/:fromId/enrollments'], ['GET', '/api/courses/:toId/enrollments'], ['DELETE', '/api/students/:fromId/enrollments/:toId']]) assert.ok(has(m, p), `${m} ${p}`);
  assert.ok(!has('GET', '/api/faculties/:id/notifications'));
});

test('api-rest: handler names are unique, routes are sorted and unique', () => {
  const r = routes();
  assert.equal(new Set(r.map((x) => x.handler)).size, r.length);
  assert.equal(new Set(r.map((x) => `${x.method} ${x.path}`)).size, r.length);
  const keys = r.map((x) => `${x.path} ${x.method}`);
  assert.deepEqual(keys, [...keys].sort());
});

test('api-rest: every path the UI calls exists in the route table (UI and API cannot drift)', () => {
  const specs = specsOf();
  const table = new Set(routes().map((x) => `${x.method} ${x.path}`));
  for (const d of specs.ui_spec.ui_spec.data_sources) {
    for (const a of Object.values(d.api)) if (a) assert.ok(table.has(`${a.method} ${a.path}`), `${a.method} ${a.path}`);
    for (const rel of d.relations) {
      assert.ok(table.has(`GET ${rel.paths.list}`), rel.paths.list);
      assert.ok(table.has(`POST ${rel.paths.create}`), rel.paths.create);
      assert.ok(table.has(`DELETE ${rel.paths.delete}`), rel.paths.delete);
    }
  }
});

test('api-rest: deterministic regardless of definition order of entities', () => {
  const a = { entities: [entity('alpha'), entity('beta')], relationships: [{ id: 'r', from: 'alpha', to: 'beta', type: 'many-to-many' }] };
  const b = { entities: [entity('beta'), entity('alpha')], relationships: a.relationships };
  assert.equal(generate(specsOf(a))['routes.js'], generate(specsOf(b))['routes.js']);
});
