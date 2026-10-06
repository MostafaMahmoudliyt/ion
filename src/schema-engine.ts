// Engine 1 — Schema Engine: entity -> schema_spec.json (constitution sections 4, 31).
// Output is a description of tables, never SQL. Knows nothing about relationships, events or UI.

import { tableName } from './naming.ts';
import type { Attribute, Entity, IonDefinition } from './types.ts';
import type { SchemaSpec, SchemaTable, SpecColumn } from './specs.ts';
import { IonValidationError, validateDefinition } from './validate.ts';

// One user attribute as a spec column. Relationship attributes reuse this (relationship engine).
export function columnSpec(a: Attribute, name: string = a.name): SpecColumn {
  const c: SpecColumn = { name, type: a.type, nullable: !a.required };
  if (a.unique) c.unique = true;
  if (a.auto) c.auto = true;
  else if (a.default !== undefined) c.default = a.default;
  if (a.type === 'money') c.scale = a.scale ?? 2;
  if (a.type === 'enum') {
    c.values = [...(a.values ?? [])];
    if (a.metadata?.transitions) c.transitions = Object.fromEntries(Object.entries(a.metadata.transitions).map(([k, v]) => [k, [...v]]));
  }
  return c;
}

function tableSpec(e: Entity): SchemaTable {
  const versioned = e.metadata?.versioned === true;
  const indexed = Array.isArray(e.metadata?.indexed) ? (e.metadata!.indexed as string[]) : [];
  return {
    entity: e.id,
    name: e.name,
    type: e.type,
    table: tableName(e.id),
    columns: [
      { name: 'id', type: 'uuid', nullable: false, primary: true, auto: true, system: true },
      ...e.attributes.map((a) => columnSpec(a)),
      ...(versioned ? [{ name: 'version', type: 'integer' as const, nullable: false, default: 1, system: true as const }] : []),
      { name: 'created_at', type: 'timestamp', nullable: false, auto: true, system: true },
      { name: 'archived_at', type: 'timestamp', nullable: true, system: true },
    ],
    indexes: indexed.map((n) => ({ columns: [n] })),
    constraints: [],
    ...(versioned ? { versioned: true as const } : {}),
    security: { row_level: true },
    archivable: true,
  };
}

export function generateSchemaSpec(input: unknown): SchemaSpec {
  const issues = validateDefinition(input);
  if (issues.length) throw new IonValidationError(issues);
  return { schema_spec: { tables: (input as IonDefinition).entities.map(tableSpec) } };
}
