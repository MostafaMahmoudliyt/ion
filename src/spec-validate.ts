// Spec Validator (constitution section 26, component 2): checks a *set* of specs against each other.
// Generators call this before reading specs, so a hand-edited or stale spec is rejected, not guessed at.
// Pure data in, issues out.

import { ATTRIBUTE_TYPES } from './constitution.ts';
import type { Issue } from './validate.ts';
import type { SpecSet } from './specs.ts';
import { checkRules } from './rules.ts';

type Obj = Record<string, any>; // specs arrive as untyped JSON

export const SPEC_FILES = {
  schema_spec: 'schema_spec.json',
  relationship_spec: 'relationship_spec.json',
  event_spec: 'event_spec.json',
  ui_spec: 'ui_spec.json',
} as const;

// Spec Loader (component 1): parse the files a Core build wrote.
export function loadSpecs(files: Record<string, string>): { specs?: SpecSet; issues: Issue[] } {
  const issues: Issue[] = [];
  const out: Obj = {};
  for (const [key, file] of Object.entries(SPEC_FILES)) {
    if (files[file] === undefined) { issues.push({ code: 'MISSING_SPEC', path: file, message: `${file} is required` }); continue; }
    try { out[key] = JSON.parse(files[file]); } catch (e) { issues.push({ code: 'INVALID_JSON', path: file, message: (e as Error).message }); }
  }
  if (issues.length) return { issues };
  const found = validateSpecs(out as SpecSet);
  return found.length ? { issues: found } : { specs: out as SpecSet, issues: [] };
}

export function validateSpecs(set: SpecSet): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };

  const tables: Obj[] = (set as Obj).schema_spec?.schema_spec?.tables;
  const rels: Obj[] = (set as Obj).relationship_spec?.relationship_spec?.relationships;
  const ev: Obj | undefined = (set as Obj).event_spec?.event_spec;
  const ui: Obj | undefined = (set as Obj).ui_spec?.ui_spec;
  if (!Array.isArray(tables)) { add('INVALID_SPEC', 'schema_spec', 'schema_spec.tables must be an array'); return issues; }
  if (!Array.isArray(rels)) { add('INVALID_SPEC', 'relationship_spec', 'relationship_spec.relationships must be an array'); return issues; }
  if (!ev || !Array.isArray(ev.events)) { add('INVALID_SPEC', 'event_spec', 'event_spec.events must be an array'); return issues; }
  if (!ui || !Array.isArray(ui.pages) || !Array.isArray(ui.data_sources)) { add('INVALID_SPEC', 'ui_spec', 'ui_spec.pages and ui_spec.data_sources must be arrays'); return issues; }

  // ---- schema_spec ----
  const byEntity = new Map<string, Obj>();
  const byTable = new Map<string, Obj>();
  const types = ATTRIBUTE_TYPES as readonly string[];
  tables.forEach((t, i) => {
    const p = `schema_spec.tables[${i}]`;
    if (byEntity.has(t.entity)) add('DUPLICATE_ID', p, `duplicate entity "${t.entity}"`);
    if (byTable.has(t.table)) add('DUPLICATE_TABLE', p, `duplicate table "${t.table}"`);
    byEntity.set(t.entity, t); byTable.set(t.table, t);
    const names = new Set<string>();
    let primaries = 0;
    for (const c of t.columns ?? []) {
      if (names.has(c.name)) add('DUPLICATE_COLUMN', `${p}.columns`, `duplicate column "${c.name}" in ${t.table}`);
      names.add(c.name);
      if (!types.includes(c.type)) add('INVALID_ATTRIBUTE_TYPE', `${p}.columns.${c.name}`, `"${c.type}" is not one of the 13 Ion attribute types (platform types belong to generators)`);
      if (c.primary) primaries++;
    }
    if (primaries !== 1) add('PRIMARY_KEY', p, `${t.table} must have exactly one primary column`);
    for (const need of ['id', 'created_at', 'archived_at']) if (!names.has(need)) add('MISSING_SYSTEM_COLUMN', p, `${t.table} lacks ${need}`);
  });
  const column = (table: string, name: string): Obj | undefined => byTable.get(table)?.columns?.find((c: Obj) => c.name === name);

  // ---- relationship_spec ----
  const relById = new Map<string, Obj>();
  const claimed = new Set<string>();
  rels.forEach((r, i) => {
    const p = `relationship_spec.relationships[${i}]`;
    if (relById.has(r.id)) add('DUPLICATE_ID', p, `duplicate relationship "${r.id}"`);
    relById.set(r.id, r);
    if (!byEntity.has(r.from)) add('UNKNOWN_ENTITY', `${p}.from`, `"${r.from}" is not in schema_spec`);
    if (!byEntity.has(r.to)) add('UNKNOWN_ENTITY', `${p}.to`, `"${r.to}" is not in schema_spec`);
    const refOk = (ref: string, where: string): void => {
      const [t, c] = String(ref).split('.');
      if (!column(t, c)) add('UNKNOWN_REFERENCE', where, `"${ref}" is not a table.column in schema_spec`);
    };
    if (r.junction) {
      if (byTable.has(r.junction.table)) add('TABLE_NAME_CONFLICT', p, `junction table "${r.junction.table}" collides with an entity table`);
      for (const c of r.junction.columns) refOk(c.references, `${p}.junction.columns`);
    } else if (r.foreign_key) {
      const fk = r.foreign_key;
      refOk(fk.references, `${p}.foreign_key.references`);
      const existing = column(fk.table, fk.column);
      if (fk.create_column && existing) add('COLUMN_CONFLICT', p, `${fk.table}.${fk.column} already exists but create_column is true`);
      if (!fk.create_column && !existing) add('UNKNOWN_COLUMN', p, `${fk.table}.${fk.column} does not exist but create_column is false`);
      if (existing && existing.type !== 'uuid') add('FK_COLUMN_TYPE_MISMATCH', p, `${fk.table}.${fk.column} must be uuid`);
      const key = `${fk.table}.${fk.column}`;
      if (claimed.has(key)) add('COLUMN_CONFLICT', p, `${key} is produced twice`);
      claimed.add(key);
    } else add('INVALID_SPEC', p, 'a relationship needs a junction or a foreign_key');
    const paths = new Set<string>();
    for (const a of r.apis ?? []) {
      const k = `${a.method} ${a.path}`;
      if (paths.has(k)) add('DUPLICATE_ENDPOINT', p, `duplicate endpoint ${k}`);
      paths.add(k);
    }
  });

  // ---- event_spec ----
  const eventIds = new Set<string>(ev.events.map((e: Obj) => e.id));
  ev.events.forEach((e: Obj, i: number) => {
    const p = `event_spec.events[${i}]`;
    if (!byEntity.has(e.actor)) add('UNKNOWN_ENTITY', `${p}.actor`, `"${e.actor}" is not in schema_spec`);
    if (!byEntity.has(e.target)) add('UNKNOWN_ENTITY', `${p}.target`, `"${e.target}" is not in schema_spec`);
    if (e.relationship !== undefined && !relById.has(e.relationship)) add('UNKNOWN_RELATIONSHIP', `${p}.relationship`, `"${e.relationship}" is not in relationship_spec`);
    (e.triggers ?? []).forEach((t: Obj, j: number) => {
      const tp = `${p}.triggers[${j}]`;
      for (const k of ['entity', 'to']) if (typeof t[k] === 'string' && t.action !== 'log' && !byEntity.has(t[k])) add('UNKNOWN_ENTITY', `${tp}.${k}`, `"${t[k]}" is not in schema_spec`);
      if (t.attribute !== undefined && t.action !== 'send_email') {
        const col = column(byEntity.get(t.entity)?.table, t.attribute);
        if (!col) add('UNKNOWN_ATTRIBUTE', tp, `${t.entity}.${t.attribute} is not a column in schema_spec`);
        else if ((t.action === 'increment' || t.action === 'decrement') && !['number', 'integer', 'money'].includes(col.type)) add('FIELD_NOT_NUMERIC', tp, `${t.field} is ${col.type}`);
      }
      if (t.action === 'send_email' && column(byEntity.get(t.to)?.table, t.attribute)?.type !== 'email') add('EMAIL_FIELD_TYPE', tp, `${t.to}.${t.attribute} is not an email column`);
      if ('row' in t && !['actor', 'target'].includes(t.row)) add('INVALID_ROW', tp, 'row must be "actor" or "target"');
      if (t.action === 'trigger_workflow' && !eventIds.has(t.workflow)) add('UNKNOWN_WORKFLOW_EVENT', tp, `"${t.workflow}" is not in event_spec`);
    });
  });
  if (ev.events.length && !ev.system_records) add('MISSING_SYSTEM_RECORDS', 'event_spec', 'events exist but system_records (ledger, audit, notifications) are missing');

  // ---- ui_spec ----
  const sources = new Map<string, Obj>();
  ui.data_sources.forEach((d: Obj, i: number) => {
    const p = `ui_spec.data_sources[${i}]`;
    sources.set(d.id, d);
    if (byTable.get(d.id)?.entity !== d.entity) add('UNKNOWN_ENTITY', p, `data source "${d.id}" does not match a schema_spec table of entity "${d.entity}"`);
    for (const rel of d.relations ?? []) {
      const r = relById.get(rel.relationship);
      if (!r) { add('UNKNOWN_RELATIONSHIP', p, `"${rel.relationship}" is not in relationship_spec`); continue; }
      for (const [k, path] of Object.entries(rel.paths as Obj)) if (!r.apis.some((a: Obj) => a.path === path)) add('PATH_MISMATCH', `${p}.relations`, `${rel.relationship}.${k} path "${path}" is not an endpoint of relationship_spec`);
    }
  });
  const perms = new Set<string>(ui.permissions ?? []);
  const pageIds = new Set<string>();
  ui.pages.forEach((pg: Obj, i: number) => {
    const p = `ui_spec.pages[${i}]`;
    if (pageIds.has(pg.id)) add('DUPLICATE_ID', p, `duplicate page "${pg.id}"`);
    pageIds.add(pg.id);
    const src = sources.get(pg.data_source);
    if (!src) { add('UNKNOWN_DATA_SOURCE', p, `"${pg.data_source}" is not a ui_spec data source`); return; }
    const names = new Set<string>(src.fields.map((f: Obj) => f.name));
    for (const k of ['columns', 'fields', 'filters']) for (const n of pg[k] ?? []) if (!names.has(n)) add('UNKNOWN_FIELD', `${p}.${k}`, `"${n}" is not a field of ${pg.data_source}`);
    if (!perms.has(pg.permission)) add('UNKNOWN_PERMISSION', p, `permission "${pg.permission}" is not listed in ui_spec.permissions`);
  });
  for (const n of ui.navigation?.items ?? []) if (!sources.has(n)) add('UNKNOWN_DATA_SOURCE', 'ui_spec.navigation', `"${n}" is not a ui_spec data source`);

  // ---- the 45 rules of section 17 (rules.ts): run last, only on a structurally sound set ----
  if (issues.length === 0) issues.push(...checkRules(set));
  return issues;
}
