// The 45 rules of section 17 (10 Schema, 5 Relationship, 10 Event, 20 UI, 0 Publish).
// The constitution fixes the counts but does not list the rules. This file is the list PROPOSED to close that
// gap: every rule has an id, a one-line statement, and a check that runs over a finished SpecSet. Nothing here
// is enforced by convention: `validateSpecs` calls `checkRules`, so no generator ever receives a spec set that
// breaks a rule, and test/rules.test.ts breaks each rule on purpose to prove its check fires.
//
// Status: proposed, pending the vision owner's approval (section 112). Rules are additive-only after approval (law 17).
// `origin: 'existing'` = the engines already produced this behaviour; 'added' = introduced to complete the 20 UI rules.

import { ATTRIBUTE_TYPES, EVENT_ACTIONS, EVENT_TYPES, RELATIONSHIP_TYPES, WIDGETS } from './constitution.ts';
import { eventKey } from './naming.ts';
import type { Issue } from './validate.ts';
import type { SpecSet } from './specs.ts';

type Obj = Record<string, any>; // specs arrive as untyped JSON
type Add = (message: string, path?: string) => void;
type Engine = 'schema' | 'relationship' | 'event' | 'ui';

export interface Rule {
  id: string; // S1-S10, R1-R5, E1-E10, U1-U20
  engine: Engine;
  title: string;
  origin: 'existing' | 'added';
  check(set: Obj, add: Add): void;
}

const EVENT_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const tablesOf = (s: Obj): Obj[] => s.schema_spec?.schema_spec?.tables ?? [];
const relsOf = (s: Obj): Obj[] => s.relationship_spec?.relationship_spec?.relationships ?? [];
const eventsOf = (s: Obj): Obj[] => s.event_spec?.event_spec?.events ?? [];
const uiOf = (s: Obj): Obj => s.ui_spec?.ui_spec ?? {};
const sourcesOf = (s: Obj): Obj[] => uiOf(s).data_sources ?? [];
const pagesOf = (s: Obj, type?: string): Obj[] => (uiOf(s).pages ?? []).filter((p: Obj) => !type || p.type === type);
const col = (t: Obj | undefined, name: string): Obj | undefined => t?.columns?.find((c: Obj) => c.name === name);
const entityTable = (s: Obj): Map<string, Obj> => new Map(tablesOf(s).map((t) => [t.entity, t]));
const NUMERIC = ['number', 'integer', 'money'];

// WCAG relative luminance / contrast of a #rrggbb colour against white (U20).
function contrastOnWhite(hex: string): number {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(hex.slice(1), 16);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05);
}

// ------------------------------------------------------------------------------------------ rules
export const RULES: Rule[] = [
  // ---------------------------------------------------------------- Schema Engine (10)
  { id: 'S1', engine: 'schema', origin: 'existing', title: 'One table per entity: entity ids and table names are unique',
    check(s, add) {
      const e = new Set<string>(), t = new Set<string>();
      for (const x of tablesOf(s)) {
        if (typeof x.entity !== 'string' || typeof x.table !== 'string') add('every table needs an entity id and a table name');
        if (e.has(x.entity)) add(`entity "${x.entity}" has more than one table`);
        if (t.has(x.table)) add(`table "${x.table}" is used twice`);
        e.add(x.entity); t.add(x.table);
      }
    } },
  { id: 'S2', engine: 'schema', origin: 'existing', title: 'Every table owns the system columns id (uuid, primary, auto), created_at and archived_at',
    check(s, add) {
      for (const t of tablesOf(s)) {
        const id = col(t, 'id'), c = col(t, 'created_at'), a = col(t, 'archived_at');
        if (!id || id.type !== 'uuid' || id.primary !== true || id.auto !== true || id.nullable !== false) add(`${t.table}.id must be a non-null auto uuid primary key`);
        if (!c || c.type !== 'timestamp' || c.auto !== true || c.nullable !== false) add(`${t.table}.created_at must be a non-null auto timestamp`);
        if (!a || a.type !== 'timestamp' || a.nullable !== true) add(`${t.table}.archived_at must be a nullable timestamp`);
      }
    } },
  { id: 'S3', engine: 'schema', origin: 'existing', title: 'Exactly one primary column per table, and it is id',
    check(s, add) {
      for (const t of tablesOf(s)) {
        const p = (t.columns ?? []).filter((c: Obj) => c.primary);
        if (p.length !== 1 || p[0].name !== 'id') add(`${t.table} must have exactly one primary column, named id`);
      }
    } },
  { id: 'S4', engine: 'schema', origin: 'existing', title: 'Columns use only the 13 Ion attribute types, never a platform type',
    check(s, add) {
      for (const t of tablesOf(s)) for (const c of t.columns ?? []) if (!(ATTRIBUTE_TYPES as readonly string[]).includes(c.type)) add(`${t.table}.${c.name}: "${c.type}" is not a Ion type`);
    } },
  { id: 'S5', engine: 'schema', origin: 'existing', title: 'Every column states its nullability explicitly (required attribute = not nullable)',
    check(s, add) {
      for (const t of tablesOf(s)) for (const c of t.columns ?? []) if (typeof c.nullable !== 'boolean') add(`${t.table}.${c.name} must declare nullable true or false`);
    } },
  { id: 'S6', engine: 'schema', origin: 'existing', title: 'Column flags are literal true, a default has the column type, and enum transitions only use the enum values',
    check(s, add) {
      for (const t of tablesOf(s)) for (const c of t.columns ?? []) {
        for (const f of ['primary', 'auto', 'unique', 'system']) if (c[f] !== undefined && c[f] !== true) add(`${t.table}.${c.name}.${f} must be true when present`);
        if (c.default === undefined) continue;
        const d = c.default;
        const ok = NUMERIC.includes(c.type) ? typeof d === 'number' : c.type === 'boolean' ? typeof d === 'boolean' : c.type === 'enum' ? (c.values ?? []).includes(d) : c.type === 'json' || c.type === 'array' ? false : typeof d === 'string';
        if (!ok) add(`${t.table}.${c.name}: default does not match type ${c.type}`);
      }
      for (const t of tablesOf(s)) {
        if (t.versioned !== undefined && (t.versioned !== true || col(t, 'version')?.type !== 'integer')) add(`${t.table}: versioned needs an integer version column`);
        for (const c of t.columns ?? []) if (c.transitions !== undefined) {
          const vals = c.values ?? [];
          const okT = c.type === 'enum' && isObj(c.transitions) && Object.entries(c.transitions).every(([k, v]) => vals.includes(k) && Array.isArray(v) && v.every((n: unknown) => vals.includes(n) && n !== k));
          if (!okT) add(`${t.table}.${c.name}: transitions must map enum values to other enum values`);
        }
      }
    } },
  { id: 'S7', engine: 'schema', origin: 'existing', title: 'auto is only for date, timestamp and uuid, and never together with a default',
    check(s, add) {
      for (const t of tablesOf(s)) for (const c of t.columns ?? []) if (c.auto) {
        if (!['date', 'timestamp', 'uuid'].includes(c.type)) add(`${t.table}.${c.name}: auto is not valid for ${c.type}`);
        if (c.default !== undefined) add(`${t.table}.${c.name}: auto and default together`);
      }
    } },
  { id: 'S8', engine: 'schema', origin: 'existing', title: 'enum columns carry a non-empty list of unique values; no other type has values',
    check(s, add) {
      for (const t of tablesOf(s)) for (const c of t.columns ?? []) {
        if (c.type === 'enum') {
          const v = c.values;
          if (!Array.isArray(v) || v.length === 0 || new Set(v).size !== v.length || v.some((x: unknown) => typeof x !== 'string' || x === '')) add(`${t.table}.${c.name}: enum needs unique, non-empty values`);
        } else if (c.values !== undefined) add(`${t.table}.${c.name}: values only belong to enum columns`);
      }
    } },
  { id: 'S9', engine: 'schema', origin: 'existing', title: 'Row-level security is declared on every table',
    check(s, add) { for (const t of tablesOf(s)) if (t.security?.row_level !== true) add(`${t.table} must declare security.row_level`); } },
  { id: 'S10', engine: 'schema', origin: 'existing', title: 'Nothing is deleted: every table is archivable through archived_at',
    check(s, add) { for (const t of tablesOf(s)) if (t.archivable !== true || !col(t, 'archived_at')) add(`${t.table} must be archivable`); } },

  // ---------------------------------------------------------------- Relationship Engine (5)
  { id: 'R1', engine: 'relationship', origin: 'existing', title: 'One of the 5 types, exactly one storage form (junction for many-to-many, foreign key otherwise), and cascade is restrict or archive when present',
    check(s, add) {
      for (const r of relsOf(s)) {
        if (!(RELATIONSHIP_TYPES as readonly string[]).includes(r.type)) add(`${r.id}: "${r.type}" is not a relationship type`);
        const m2m = r.type === 'many-to-many';
        if (m2m ? !(r.junction && !r.foreign_key) : !(r.foreign_key && !r.junction)) add(`${r.id}: ${r.type} must use ${m2m ? 'a junction' : 'a foreign key'} only`);
        if (r.cascade !== undefined && !['restrict', 'archive'].includes(r.cascade)) add(`${r.id}: cascade must be restrict or archive`);
      }
    } },
  { id: 'R2', engine: 'relationship', origin: 'existing', title: 'Placement is fixed by type: one-to-many holds the key in "to"; many-to-one, one-to-one and self in "from"',
    check(s, add) {
      const tb = entityTable(s);
      for (const r of relsOf(s)) {
        const fk = r.foreign_key;
        if (!fk) continue;
        const from = tb.get(r.from)?.table, to = tb.get(r.to)?.table;
        const holder = r.type === 'one-to-many' ? to : from;
        const target = r.type === 'one-to-many' ? from : r.type === 'self' ? from : to;
        if (r.type === 'self' && r.from !== r.to) add(`${r.id}: a self relationship must have the same entity on both sides`);
        if (r.type !== 'self' && r.from === r.to) add(`${r.id}: same entity on both sides requires type self`);
        if (fk.table !== holder) add(`${r.id}: the key belongs in ${holder}, not ${fk.table}`);
        if (fk.references !== `${target}.id`) add(`${r.id}: the key must reference ${target}.id`);
      }
    } },
  { id: 'R3', engine: 'relationship', origin: 'existing', title: 'Every reference resolves to a real table.column, and both ends are entities of the schema',
    check(s, add) {
      const tb = entityTable(s);
      const byTable = new Map(tablesOf(s).map((t) => [t.table, t]));
      const ok = (ref: string): boolean => { const [t, c] = String(ref).split('.'); return !!col(byTable.get(t), c); };
      for (const r of relsOf(s)) {
        if (!tb.has(r.from) || !tb.has(r.to)) add(`${r.id}: from/to must be entities of the schema`);
        for (const c of r.junction?.columns ?? []) if (!ok(c.references)) add(`${r.id}: "${c.references}" does not exist`);
        if (r.foreign_key && !ok(r.foreign_key.references)) add(`${r.id}: "${r.foreign_key.references}" does not exist`);
      }
    } },
  { id: 'R4', engine: 'relationship', origin: 'existing', title: 'Uniqueness covers active rows only, so archiving never blocks re-linking',
    check(s, add) {
      for (const r of relsOf(s)) {
        if (r.junction && (r.junction.active_only !== true || !Array.isArray(r.junction.unique) || r.junction.unique.length === 0)) add(`${r.id}: a junction needs an active-only unique key`);
        if (r.foreign_key && r.foreign_key.unique !== (r.type === 'one-to-one')) add(`${r.id}: only one-to-one keys are unique`);
      }
    } },
  { id: 'R5', engine: 'relationship', origin: 'existing', title: 'Every relationship exposes create, read, update and delete endpoints, with no duplicate method+path',
    check(s, add) {
      for (const r of relsOf(s)) {
        const ops = new Set((r.apis ?? []).map((a: Obj) => a.operation));
        for (const op of ['create', 'read', 'update', 'delete']) if (!ops.has(op)) add(`${r.id}: missing ${op} endpoint`);
        const seen = new Set<string>();
        for (const a of r.apis ?? []) {
          const k = `${a.method} ${a.path}`;
          if (seen.has(k)) add(`${r.id}: duplicate endpoint ${k}`);
          seen.add(k);
          if (typeof a.path !== 'string' || !a.path.startsWith('/api/')) add(`${r.id}: endpoint path must start with /api/`);
        }
      }
    } },

  // ---------------------------------------------------------------- Event Engine (10)
  { id: 'E1', engine: 'event', origin: 'existing', title: 'Event ids are dotted lower-case, unique, and unambiguous between "." and "_"',
    check(s, add) {
      const ids = new Set<string>(), keys = new Map<string, string>();
      for (const e of eventsOf(s)) {
        if (typeof e.id !== 'string' || !EVENT_ID.test(e.id)) { add(`"${String(e.id)}" is not a valid event id`); continue; }
        if (ids.has(e.id)) add(`duplicate event "${e.id}"`);
        const k = eventKey(e.id), prior = keys.get(k);
        if (prior !== undefined && prior !== e.id) add(`"${e.id}" and "${prior}" are the same event to every generator`);
        ids.add(e.id); keys.set(k, e.id);
      }
    } },
  { id: 'E2', engine: 'event', origin: 'existing', title: 'Actor and target are entities of the schema',
    check(s, add) { const tb = entityTable(s); for (const e of eventsOf(s)) for (const k of ['actor', 'target']) if (!tb.has(e[k])) add(`${e.id}.${k}: "${e[k]}" is not an entity`); } },
  { id: 'E3', engine: 'event', origin: 'existing', title: 'Event type is one of create, update, delete, custom, and a rate limit is whole numbers max per seconds',
    check(s, add) {
      for (const e of eventsOf(s)) {
        if (!(EVENT_TYPES as readonly string[]).includes(e.type)) add(`${e.id}: "${e.type}" is not an event type`);
        if (e.rate !== undefined && !(isObj(e.rate) && Number.isInteger(e.rate.max) && e.rate.max >= 1 && Number.isInteger(e.rate.per_seconds) && e.rate.per_seconds >= 1)) add(`${e.id}: rate must be { max, per_seconds } as whole numbers >= 1`);
      }
    } },
  { id: 'E4', engine: 'event', origin: 'existing', title: 'An event that names a relationship names one that exists',
    check(s, add) {
      const rels = new Set(relsOf(s).map((r) => r.id));
      for (const e of eventsOf(s)) if (e.relationship !== undefined && !rels.has(e.relationship)) add(`${e.id}: relationship "${e.relationship}" does not exist`);
    } },
  { id: 'E5', engine: 'event', origin: 'existing', title: 'Triggers use only the 10 declared actions',
    check(s, add) { for (const e of eventsOf(s)) for (const t of e.triggers ?? []) if (!(EVENT_ACTIONS as readonly string[]).includes(t.action)) add(`${e.id}: "${t.action}" is not an action`); } },
  { id: 'E6', engine: 'event', origin: 'existing', title: 'Every trigger is fully resolved: entity, attribute and row (actor or target) are never left implicit',
    check(s, add) {
      const need: Record<string, string[]> = {
        send_notification: ['to', 'row', 'message'], send_email: ['to', 'row', 'attribute', 'subject', 'body'],
        increment: ['entity', 'attribute', 'row', 'by'], decrement: ['entity', 'attribute', 'row', 'by'], update_field: ['entity', 'attribute', 'row'],
        create_entity: ['entity', 'values'], delete_entity: ['entity', 'row'], log: ['to'], call_webhook: ['url'], trigger_workflow: ['workflow'],
      };
      for (const e of eventsOf(s)) for (const t of e.triggers ?? []) {
        for (const k of need[t.action] ?? []) if (t[k] === undefined) add(`${e.id}: ${t.action} is missing "${k}"`);
        if ('row' in t && !['actor', 'target'].includes(t.row)) add(`${e.id}: row must be actor or target`);
        if (t.action === 'log' && t.to !== 'audit') add(`${e.id}: log writes to audit`);
      }
    } },
  { id: 'E7', engine: 'event', origin: 'existing', title: 'Trigger attributes exist in the schema; increment and decrement act on numbers, send_email on an email column',
    check(s, add) {
      const tb = entityTable(s);
      for (const e of eventsOf(s)) for (const t of e.triggers ?? []) {
        if (t.attribute === undefined) continue;
        const entity = t.action === 'send_email' ? t.to : t.entity;
        const c = col(tb.get(entity), t.attribute);
        if (!c) { add(`${e.id}: ${entity}.${t.attribute} is not a column`); continue; }
        if ((t.action === 'increment' || t.action === 'decrement') && !NUMERIC.includes(c.type)) add(`${e.id}: ${entity}.${t.attribute} is ${c.type}, not numeric`);
        if (t.action === 'send_email' && c.type !== 'email') add(`${e.id}: ${entity}.${t.attribute} is not an email column`);
      }
    } },
  { id: 'E8', engine: 'event', origin: 'existing', title: 'trigger_workflow points at a declared event and the chain never loops',
    check(s, add) {
      const events = eventsOf(s), ids = new Set(events.map((e) => e.id));
      const next = new Map<string, string[]>();
      for (const e of events) {
        const out: string[] = [];
        for (const t of e.triggers ?? []) if (t.action === 'trigger_workflow') { if (!ids.has(t.workflow)) add(`${e.id}: workflow "${t.workflow}" is not declared`); else out.push(t.workflow); }
        next.set(e.id, out);
      }
      const state = new Map<string, 1 | 2>();
      const visit = (id: string): void => {
        if (state.get(id) === 2) return;
        if (state.get(id) === 1) { add(`workflow cycle through "${id}"`); return; }
        state.set(id, 1);
        for (const n of next.get(id) ?? []) visit(n);
        state.set(id, 2);
      };
      for (const id of next.keys()) visit(id);
    } },
  { id: 'E9', engine: 'event', origin: 'existing', title: 'Webhook targets are http(s) URLs without embedded credentials',
    check(s, add) {
      for (const e of eventsOf(s)) for (const t of e.triggers ?? []) if (t.action === 'call_webhook') {
        let ok = false;
        try { const u = new URL(t.url); ok = /^https?:$/.test(u.protocol) && u.username === '' && u.password === '' && u.hostname !== ''; } catch { ok = false; }
        if (!ok) add(`${e.id}: "${String(t.url)}" is not an acceptable webhook URL`);
      }
    } },
  { id: 'E10', engine: 'event', origin: 'existing', title: 'Once events exist: ledger and audit are append-only, notifications exist, and each event declares compensations',
    check(s, add) {
      const events = eventsOf(s);
      if (events.length === 0) return;
      const sr = s.event_spec?.event_spec?.system_records;
      if (!sr || !sr.ledger || !sr.audit || !sr.notifications) { add('system_records ledger, audit and notifications are required'); return; }
      if (sr.ledger.append_only !== true || sr.audit.append_only !== true) add('ledger and audit must be append-only');
      for (const e of events) if (!Array.isArray(e.compensations)) add(`${e.id}: compensations must be declared (an array)`);
    } },

  // ---------------------------------------------------------------- UI Engine (20)
  { id: 'U1', engine: 'ui', origin: 'existing', title: 'Four pages per entity: list, create, detail, edit, each with its own path',
    check(s, add) {
      const pages = pagesOf(s);
      for (const d of sourcesOf(s)) {
        const mine = pages.filter((p) => p.data_source === d.id);
        for (const [type, mode] of [['list', undefined], ['detail', undefined], ['form', 'create'], ['form', 'edit']] as const) {
          if (!mine.some((p) => p.type === type && p.mode === mode)) add(`${d.id}: missing ${mode ?? type} page`);
        }
        if (new Set(mine.map((p) => p.path)).size !== mine.length) add(`${d.id}: two pages share a path`);
      }
    } },
  { id: 'U2', engine: 'ui', origin: 'existing', title: 'Every declared attribute is a field, and forms offer exactly the non-automatic fields',
    check(s, add) {
      const tb = new Map(tablesOf(s).map((t) => [t.table, t]));
      for (const d of sourcesOf(s)) {
        const names = new Set((d.fields ?? []).map((f: Obj) => f.name));
        for (const c of tb.get(d.id)?.columns ?? []) if (!c.system && !names.has(c.name)) add(`${d.id}: attribute "${c.name}" has no field`);
        const editable = (d.fields ?? []).filter((f: Obj) => !f.auto).map((f: Obj) => f.name).join(',');
        for (const p of pagesOf(s, 'form')) if (p.data_source === d.id && (p.fields ?? []).join(',') !== editable) add(`${p.id}: a form must list exactly the non-automatic fields`);
      }
    } },
  { id: 'U3', engine: 'ui', origin: 'existing', title: 'The attribute type picks the widget (relation fields are uuid and name their target)',
    check(s, add) {
      for (const d of sourcesOf(s)) for (const f of d.fields ?? []) {
        if (f.widget === 'relation') { if (f.type !== 'uuid' || !f.target || !f.relationship) add(`${d.id}.${f.name}: a relation field is a uuid with a target and a relationship`); }
        else if (f.widget !== WIDGETS[f.type]) add(`${d.id}.${f.name}: ${f.type} must use widget ${WIDGETS[f.type]}`);
      }
    } },
  { id: 'U4', engine: 'ui', origin: 'existing', title: 'Every relationship appears as a related-items section on both of its entities',
    check(s, add) {
      const tb = entityTable(s), src = new Map(sourcesOf(s).map((d) => [d.id, d]));
      for (const r of relsOf(s)) for (const [end, side] of r.from === r.to ? [[r.from, 'from'], [r.to, 'to']] : [[r.from, 'from'], [r.to, 'to']]) {
        const d = src.get(tb.get(end)?.table);
        if (!d?.relations?.some((x: Obj) => x.relationship === r.id && x.side === side)) add(`${r.id}: no ${side} section on ${end}`);
      }
    } },
  { id: 'U5', engine: 'ui', origin: 'existing', title: 'Lists paginate with a positive page size',
    check(s, add) { for (const p of pagesOf(s, 'list')) if (!Number.isInteger(p.pagination?.size) || p.pagination.size <= 0) add(`${p.id}: pagination.size must be a positive integer`); } },
  { id: 'U6', engine: 'ui', origin: 'existing', title: 'Lists filter every enum, boolean, number, integer, date and timestamp field',
    check(s, add) {
      const tb = new Map(tablesOf(s).map((t) => [t.table, t]));
      for (const d of sourcesOf(s)) {
        const want = (d.filters ?? []).map((f: Obj) => f.field).join(',');
        // the entity's own declared attributes (relationship-owned columns are not in the schema table)
        const must = (d.fields ?? []).filter((f: Obj) => !f.system && !f.auto && col(tb.get(d.id), f.name) && ['enum', 'boolean', 'number', 'integer', 'money', 'date', 'timestamp'].includes(f.type)).map((f: Obj) => f.name);
        for (const m of must) if (!(d.filters ?? []).some((f: Obj) => f.field === m)) add(`${d.id}: "${m}" should be filterable`);
        const list = pagesOf(s, 'list').find((p) => p.data_source === d.id);
        if (list && (list.filters ?? []).join(',') !== want) add(`${list.id}: list filters must equal the data source filters`);
      }
    } },
  { id: 'U7', engine: 'ui', origin: 'existing', title: 'Lists search the text fields (string, email, url, phone) and say so with search:true',
    check(s, add) {
      for (const d of sourcesOf(s)) {
        const list = pagesOf(s, 'list').find((p) => p.data_source === d.id);
        if (list && list.search !== ((d.search_fields ?? []).length > 0)) add(`${list.id}: search must be true exactly when there are search fields`);
        for (const n of d.search_fields ?? []) { const f = (d.fields ?? []).find((x: Obj) => x.name === n); if (!f || !['string', 'email', 'url', 'phone'].includes(f.type)) add(`${d.id}: "${n}" is not a searchable text field`); }
      }
    } },
  { id: 'U8', engine: 'ui', origin: 'existing', title: 'Events surface as a notification area (receivers) and an activity feed (actors and targets)',
    check(s, add) {
      const notified = new Set<string>(), involved = new Set<string>();
      for (const e of eventsOf(s)) { involved.add(e.actor); involved.add(e.target); for (const t of e.triggers ?? []) if (t.action === 'send_notification') notified.add(t.to); }
      for (const d of sourcesOf(s)) {
        if (!!d.surfaces?.notifications !== notified.has(d.entity)) add(`${d.id}: notification surface must match the send_notification triggers`);
        if (!!d.surfaces?.activity !== involved.has(d.entity)) add(`${d.id}: activity surface must match the events that involve it`);
        if (!!d.api?.notifications !== !!d.surfaces?.notifications || !!d.api?.activity !== !!d.surfaces?.activity) add(`${d.id}: surface endpoints must match the surfaces`);
      }
    } },
  { id: 'U9', engine: 'ui', origin: 'existing', title: 'Permissions: a key per page and per action; every page names a declared key',
    check(s, add) {
      const perms = new Set<string>(uiOf(s).permissions ?? []);
      for (const d of sourcesOf(s)) for (const k of ['list', 'read', 'create', 'update', 'archive']) if (!perms.has(`entity:${d.entity}:${k}`)) add(`missing permission entity:${d.entity}:${k}`);
      for (const r of relsOf(s)) for (const k of ['read', 'link', 'unlink']) if (!perms.has(`relationship:${r.id}:${k}`)) add(`missing permission relationship:${r.id}:${k}`);
      for (const p of pagesOf(s)) if (!perms.has(p.permission)) add(`${p.id}: permission "${p.permission}" is not declared`);
    } },
  { id: 'U10', engine: 'ui', origin: 'existing', title: 'Locales include ar and en, the default is one of them, and every entity has an English name',
    check(s, add) {
      const u = uiOf(s);
      for (const l of ['ar', 'en']) if (!(u.locales ?? []).includes(l)) add(`locale "${l}" is required`);
      if (!(u.locales ?? []).includes(u.default_locale)) add('default_locale must be one of the locales');
      for (const d of sourcesOf(s)) if (!d.labels?.en?.singular || !d.labels?.en?.plural) add(`${d.id}: English singular and plural names are required`);
    } },
  { id: 'U11', engine: 'ui', origin: 'added', title: 'A dashboard home page shows one count widget per data source, guarded by that list permission',
    check(s, add) {
      const dash = uiOf(s).dashboard, ids = sourcesOf(s).map((d) => d.id);
      if (!isObj(dash) || dash.path !== '/' || !Array.isArray(dash.widgets)) { add('ui_spec.dashboard with path "/" and widgets is required'); return; }
      const got = dash.widgets.map((w: Obj) => w.data_source);
      if (got.join(',') !== ids.join(',')) add('the dashboard needs exactly one widget per data source, in data source order');
      for (const w of dash.widgets) {
        if (w.kind !== 'count') add(`${w.data_source}: widget kind must be count`);
        const d = sourcesOf(s).find((x) => x.id === w.data_source);
        if (d && w.permission !== `entity:${d.entity}:list`) add(`${w.data_source}: the widget is guarded by the list permission`);
        if (!w.labels?.en) add(`${w.data_source}: widget needs an English label`);
      }
    } },
  { id: 'U12', engine: 'ui', origin: 'added', title: 'Every list has a declared default sort on an existing field',
    check(s, add) {
      for (const p of pagesOf(s, 'list')) {
        const d = sourcesOf(s).find((x) => x.id === p.data_source);
        if (!p.sort || !['asc', 'desc'].includes(p.sort.direction) || !(d?.fields ?? []).some((f: Obj) => f.name === p.sort.field)) add(`${p.id}: sort needs a direction and an existing field`);
      }
    } },
  { id: 'U13', engine: 'ui', origin: 'added', title: 'Archiving always asks for confirmation (lists with a delete action, and detail pages)',
    check(s, add) {
      for (const p of pagesOf(s)) {
        const destructive = p.type === 'detail' || (p.actions ?? []).includes('delete');
        if (destructive && !(p.confirm ?? []).includes('delete')) add(`${p.id}: confirm must include "delete"`);
      }
    } },
  { id: 'U14', engine: 'ui', origin: 'added', title: 'Every list declares empty, loading and error states with an English label',
    check(s, add) {
      for (const p of pagesOf(s, 'list')) for (const k of ['empty', 'loading', 'error']) if (!p.states?.[k]?.labels?.en) add(`${p.id}: state "${k}" needs an English label`);
    } },
  { id: 'U15', engine: 'ui', origin: 'added', title: 'Every page declares a breadcrumb that starts at its entity list and ends at itself',
    check(s, add) {
      const all = new Map(pagesOf(s).map((p) => [p.id, p]));
      for (const p of pagesOf(s)) {
        const b = p.breadcrumb;
        if (!Array.isArray(b) || b.length === 0 || b[b.length - 1] !== p.id) { add(`${p.id}: breadcrumb must end at the page itself`); continue; }
        if (all.get(b[0])?.type !== 'list' || all.get(b[0])?.data_source !== p.data_source) add(`${p.id}: breadcrumb must start at its entity list`);
        for (const id of b) if (!all.has(id)) add(`${p.id}: breadcrumb names unknown page "${id}"`);
      }
    } },
  { id: 'U16', engine: 'ui', origin: 'added', title: 'Every list says how it adapts: cards on compact screens, a table on regular ones',
    check(s, add) {
      for (const p of pagesOf(s, 'list')) if (!['cards', 'table'].includes(p.responsive?.compact) || !['cards', 'table'].includes(p.responsive?.regular)) add(`${p.id}: responsive needs compact and regular layouts (cards | table)`);
    } },
  { id: 'U17', engine: 'ui', origin: 'added', title: 'Every page, field and related-items section has an English label (the accessible name)',
    check(s, add) {
      for (const p of pagesOf(s)) if (!p.labels?.en) add(`${p.id}: English label missing`);
      for (const d of sourcesOf(s)) {
        for (const f of d.fields ?? []) if (!f.labels?.en) add(`${d.id}.${f.name}: English label missing`);
        for (const r of d.relations ?? []) if (!r.title?.entity && !r.title?.text) add(`${d.id}.${r.relationship}: related section needs a title`);
      }
    } },
  { id: 'U18', engine: 'ui', origin: 'added', title: 'Text direction is declared per locale (ar rtl, en ltr), never guessed by a renderer',
    check(s, add) {
      const u = uiOf(s);
      for (const l of u.locales ?? []) if (!['rtl', 'ltr'].includes(u.directions?.[l])) add(`directions.${l} must be rtl or ltr`);
      if (u.directions?.ar !== undefined && u.directions.ar !== 'rtl') add('ar is right-to-left');
      if (u.directions?.en !== undefined && u.directions.en !== 'ltr') add('en is left-to-right');
    } },
  { id: 'U19', engine: 'ui', origin: 'added', title: 'Lists offer ascending page sizes (max 100) that include the default size',
    check(s, add) {
      for (const p of pagesOf(s, 'list')) {
        const o = p.page_sizes;
        const ok = Array.isArray(o) && o.length > 0 && o.every((n: unknown, i: number) => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 100 && (i === 0 || (n as number) > o[i - 1])) && o.includes(p.pagination?.size);
        if (!ok) add(`${p.id}: page_sizes must be ascending integers up to 100 containing pagination.size`);
      }
    } },
  { id: 'U20', engine: 'ui', origin: 'added', title: 'The theme colour is #rrggbb with at least 4.5:1 contrast on white, and density is compact, medium or comfortable',
    check(s, add) {
      const t = uiOf(s).theme;
      if (typeof t?.primary_color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(t.primary_color)) add('theme.primary_color must be #rrggbb');
      else if (contrastOnWhite(t.primary_color) < 4.5) add(`theme.primary_color has contrast ${contrastOnWhite(t.primary_color).toFixed(2)}:1 on white (need 4.5:1)`);
      if (!['compact', 'medium', 'comfortable'].includes(t?.density)) add('theme.density must be compact, medium or comfortable');
    } },
];

// Runs all 45 rules over a SpecSet. Issue codes are RULE_<id> so a failure names the rule it broke.
export function checkRules(set: SpecSet): Issue[] {
  const issues: Issue[] = [];
  for (const rule of RULES) {
    try {
      rule.check(set as Obj, (message, path = rule.id) => { issues.push({ code: `RULE_${rule.id}`, path, message: `${rule.title} — ${message}` }); });
    } catch (e) {
      issues.push({ code: `RULE_${rule.id}`, path: rule.id, message: `${rule.title} — could not be checked: ${(e as Error).message}` });
    }
  }
  return issues;
}
