// Engine 2 — Relationship Engine: relationship -> relationship_spec.json (constitution sections 4, 32).
// Describes storage and endpoints; emits neither SQL nor routes. Needs entities to find tables and
// columns, knows nothing about events or UI.
//
// Storage rules:
//   one-to-many   FK column in the "to" table   (to.<from>_id)
//   many-to-one   FK column in the "from" table (from.<to>_id)
//   one-to-one    FK column in the "from" table + unique
//   self          FK column in the entity's own table (<relationship id>_id)
//   many-to-many  junction table named after the relationship id
// Uniqueness always applies to non-archived rows only, so archiving never blocks re-linking.

import { pathSegment, snake, tableName } from './naming.ts';
import { columnSpec } from './schema-engine.ts';
import { makeResolver } from './resolve.ts';
import type { Attribute, Entity, Relationship, IonDefinition } from './types.ts';
import type { RelationshipItem, RelationshipSpec, SpecApi } from './specs.ts';
import type { Issue } from './validate.ts';
import { IonValidationError, validateDefinition } from './validate.ts';

// Where a relationship is stored. Pure; the UI Engine reuses it so forms and related-item
// sections always agree with the relationship_spec.
export type Placement =
  | { kind: 'junction'; table: string; fromCol: string; toCol: string }
  | { kind: 'fk'; holder: Entity; target: Entity; column: string };

export function placeRelationship(rel: Relationship, from: Entity, to: Entity): Placement {
  switch (rel.type) {
    case 'many-to-many': return { kind: 'junction', table: tableName(rel.id), fromCol: `${snake(from.id)}_id`, toCol: `${snake(to.id)}_id` };
    case 'one-to-many': return { kind: 'fk', holder: to, target: from, column: `${snake(from.id)}_id` };
    case 'many-to-one': return { kind: 'fk', holder: from, target: to, column: `${snake(to.id)}_id` };
    case 'one-to-one': return { kind: 'fk', holder: from, target: to, column: `${snake(to.id)}_id` };
    default: return { kind: 'fk', holder: from, target: from, column: `${snake(rel.id)}_id` }; // self
  }
}

function apisFor(rel: Relationship, from: Entity, to: Entity): SpecApi[] {
  const F = pathSegment(from.id);
  const T = pathSegment(to.id);
  const R = pathSegment(rel.id);
  const reverse = rel.type === 'self' ? `${R}-reverse` : R;
  const link = `${from.name} -> ${to.name} (${rel.id})`;
  return [
    { method: 'POST', path: `/api/${F}/:fromId/${R}`, operation: 'create', summary: `Create link ${link}` },
    { method: 'GET', path: `/api/${F}/:fromId/${R}`, operation: 'read', summary: `List ${to.name} linked from a ${from.name}` },
    { method: 'GET', path: `/api/${T}/:toId/${reverse}`, operation: 'read', summary: `List ${from.name} linked to a ${to.name}` },
    { method: 'PATCH', path: `/api/${F}/:fromId/${R}/:toId`, operation: 'update', summary: `Update link ${link}` },
    { method: 'DELETE', path: `/api/${F}/:fromId/${R}/:toId`, operation: 'delete', summary: `Archive link ${link}` },
  ];
}

export function generateRelationshipSpec(input: unknown): RelationshipSpec {
  const issues = validateDefinition(input);
  if (issues.length) throw new IonValidationError(issues);
  const def = input as IonDefinition;
  const resolve = makeResolver(def.entities);

  const declared = new Map<string, Map<string, Attribute>>();
  for (const e of def.entities) declared.set(tableName(e.id), new Map(e.attributes.map((a) => [a.name, a])));

  const problems: Issue[] = [];
  const claims = new Map<string, string>(); // "table.column" -> relationship id

  // Registers a column this engine wants in `table`. Returns true when the user already declared it.
  const claim = (table: string, col: string, relId: string, asFk: boolean): boolean => {
    const key = `${table}.${col}`;
    const prior = claims.get(key);
    if (prior !== undefined) {
      problems.push({ code: 'COLUMN_CONFLICT', path: `relationship "${relId}"`, message: `column ${key} is already produced by relationship "${prior}"` });
      return false;
    }
    claims.set(key, relId);
    const decl = declared.get(table)?.get(col);
    if (!decl) return false;
    if (!asFk) {
      problems.push({ code: 'COLUMN_CONFLICT', path: `relationship "${relId}"`, message: `column ${key} collides with a declared attribute` });
    } else if (decl.type !== 'uuid') {
      problems.push({ code: 'FK_COLUMN_TYPE_MISMATCH', path: `relationship "${relId}"`, message: `attribute ${key} must be of type uuid to hold a foreign key` });
    }
    return true;
  };

  const items: RelationshipItem[] = [];

  for (const rel of def.relationships ?? []) {
    const from = resolve(rel.from)!;
    const to = resolve(rel.to)!;
    const fromT = tableName(from.id);
    const toT = tableName(to.id);
    const place = placeRelationship(rel, from, to);
    const cascade = rel.metadata?.cascade;
    const base = { id: rel.id, from: from.id, to: to.id, type: rel.type, ...(cascade && cascade !== 'none' ? { cascade: cascade as 'restrict' | 'archive' } : {}) };
    const apis = apisFor(rel, from, to);

    if (place.kind === 'junction') {
      const used = new Set([place.fromCol, place.toCol]);
      const attributes = [];
      for (const a of rel.attributes ?? []) {
        if (used.has(a.name)) problems.push({ code: 'COLUMN_CONFLICT', path: `relationship "${rel.id}"`, message: `attribute "${a.name}" collides with a generated key column` });
        used.add(a.name);
        attributes.push(columnSpec(a));
      }
      items.push({
        ...base,
        storage: { table: place.table, columns: [place.fromCol, place.toCol, ...attributes.map((a) => a.name)] },
        junction: {
          table: place.table,
          columns: [
            { name: place.fromCol, references: `${fromT}.id` },
            { name: place.toCol, references: `${toT}.id` },
          ],
          attributes,
          unique: [[place.fromCol, place.toCol]],
          indexes: [[place.toCol]],
          active_only: true,
        },
        apis,
      });
    } else {
      const holder = tableName(place.holder.id);
      const target = tableName(place.target.id);
      const col = place.column;
      const createColumn = !claim(holder, col, rel.id, true);
      const attributes = (rel.attributes ?? []).map((a) => {
        const column = `${snake(rel.id)}_${a.name}`; // prefixed so it cannot clash with entity attributes
        claim(holder, column, rel.id, false);
        return { column, attribute: columnSpec(a, column) };
      });
      items.push({
        ...base,
        storage: { table: holder, columns: [col, ...attributes.map((a) => a.column)] },
        foreign_key: {
          table: holder,
          column: col,
          references: `${target}.id`,
          create_column: createColumn,
          unique: rel.type === 'one-to-one',
          index: rel.type !== 'one-to-one',
          attributes,
        },
        apis,
      });
    }
  }

  if (problems.length) throw new IonValidationError(problems);
  return { relationship_spec: { relationships: items } };
}
