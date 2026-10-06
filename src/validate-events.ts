// Event validation (laws 3, 6, 7, 9, 18, 32): every cross-reference between
// events, triggers, entities, attributes and relationships is checked here,
// before any engine runs. Pure data in, issues out; nothing is evaluated.

import { EVENT_ACTIONS, EVENT_TYPES } from './constitution.ts';
import { eventKey } from './naming.ts';
import { makeResolver } from './resolve.ts';
import type { Attribute, Entity } from './types.ts';

type Add = (code: string, path: string, message: string) => void;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const EVENT_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keys each action accepts. Anything else is a typo and is rejected (law 33).
const ALLOWED_KEYS: Record<string, string[]> = {
  send_notification: ['to', 'on', 'message', 'channel', 'template'],
  send_email: ['to', 'on', 'field', 'subject', 'body'],
  increment: ['field', 'on', 'by'],
  decrement: ['field', 'on', 'by'],
  update_field: ['field', 'on', 'value'],
  create_entity: ['entity', 'values'],
  delete_entity: ['entity', 'on'],
  log: ['to', 'level'],
  trigger_workflow: ['workflow'],
  call_webhook: ['url'],
};

const NUMERIC = ['number', 'integer', 'money'];

// Returns an error message when `v` cannot be stored in an attribute of this type.
export function valueProblem(a: Attribute, v: unknown): string | undefined {
  switch (a.type) {
    case 'string': case 'phone':
      return typeof v === 'string' ? undefined : `expected a string for ${a.type}`;
    case 'email':
      return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? undefined : 'expected a valid email address';
    case 'url':
      return typeof v === 'string' && /^https?:\/\//i.test(v) ? undefined : 'expected an http(s) URL';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? undefined : 'expected a finite number';
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v) ? undefined : 'expected an integer';
    case 'money':
      return typeof v === 'number' && Number.isSafeInteger(v) ? undefined : 'expected whole minor units (an integer, 12050 = 120.50)';
    case 'boolean':
      return typeof v === 'boolean' ? undefined : 'expected a boolean';
    case 'date': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'expected a date as YYYY-MM-DD';
      const [y, m, d] = v.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1, d));
      return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? undefined : 'not a real calendar date';
    }
    case 'timestamp':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(v) && !Number.isNaN(Date.parse(v))
        ? undefined : 'expected an ISO timestamp';
    case 'uuid':
      return typeof v === 'string' && UUID.test(v) ? undefined : 'expected a UUID';
    case 'enum':
      return typeof v === 'string' && (a.values ?? []).includes(v) ? undefined : `expected one of: ${(a.values ?? []).join(', ')}`;
    case 'array':
      return Array.isArray(v) ? undefined : 'expected an array';
    case 'json':
      return v !== null && v !== undefined && (typeof v === 'object' || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        ? undefined : 'expected a JSON value';
    default:
      return 'unsupported attribute type';
  }
}

export function validateEvents(def: Obj, add: Add): void {
  if (def.events === undefined) return;
  if (!Array.isArray(def.events)) {
    add('INVALID_EVENTS', '$.events', 'events must be an array');
    return;
  }
  const events = def.events as unknown[];
  if (events.length === 0) return;

  // Well-formed entities only: structural problems are already reported elsewhere.
  const entities = (def.entities as unknown[]).filter(
    (e): e is Entity => isObj(e) && typeof e.id === 'string' && typeof e.name === 'string' && Array.isArray(e.attributes),
  );
  const resolveEntity = makeResolver(entities);
  const rels = (Array.isArray(def.relationships) ? def.relationships : []).filter(
    (r): r is Obj => isObj(r) && typeof r.id === 'string',
  );
  const relById = new Map(rels.map((r) => [r.id as string, r]));

  const eventIds = new Set<string>();
  const keys = new Map<string, string>();
  const known = new Map<string, { actor?: Entity; target?: Entity }>();
  events.forEach((ev) => { if (isObj(ev) && typeof ev.id === 'string') known.set(ev.id, { actor: resolveEntity(ev.actor), target: resolveEntity(ev.target) }); });
  const edges = new Map<string, string[]>(); // event -> events it triggers (for cycle detection)

  events.forEach((ev, i) => {
    const p = `$.events[${i}]`;
    if (!isObj(ev)) { add('INVALID_EVENT', p, 'event must be an object'); return; }

    // ---- identity (laws 9, 27) ----
    if (typeof ev.id !== 'string' || !EVENT_ID.test(ev.id)) {
      add('INVALID_ID', `${p}.id`, 'event id is required: lower-case segments of a-z, 0-9, _ joined by dots (e.g. "student.enrolled")');
    } else {
      if (eventIds.has(ev.id)) add('DUPLICATE_ID', `${p}.id`, `duplicate event id "${ev.id}"`);
      eventIds.add(ev.id);
      const key = eventKey(ev.id);
      const prior = keys.get(key);
      if (prior !== undefined && prior !== ev.id) add('AMBIGUOUS_EVENT_ID', `${p}.id`, `"${ev.id}" and "${prior}" differ only by "." / "_" and would be the same event to every generator`);
      keys.set(key, ev.id);
    }
    if (typeof ev.name !== 'string' || ev.name.trim() === '') add('MISSING_NAME', `${p}.name`, 'event name is required');

    // ---- actor / target (section 22) ----
    const actor = resolveEntity(ev.actor);
    const target = resolveEntity(ev.target);
    if (!actor) add('UNKNOWN_ENTITY', `${p}.actor`, `"${String(ev.actor)}" is not a known (or is an ambiguous) entity`);
    if (!target) add('UNKNOWN_ENTITY', `${p}.target`, `"${String(ev.target)}" is not a known (or is an ambiguous) entity`);

    // ---- type (law 6) and the relationship that emits it (section 25) ----
    if (ev.type !== undefined && !(EVENT_TYPES as readonly string[]).includes(ev.type as string)) {
      add('INVALID_EVENT_TYPE', `${p}.type`, `type must be one of: ${EVENT_TYPES.join(', ')}`);
    }
    if (ev.relationship !== undefined) {
      const rel = typeof ev.relationship === 'string' ? relById.get(ev.relationship) : undefined;
      if (!rel) {
        add('UNKNOWN_RELATIONSHIP', `${p}.relationship`, `"${String(ev.relationship)}" is not a declared relationship`);
      } else {
        if (ev.type === undefined || ev.type === 'custom') {
          add('RELATIONSHIP_NEEDS_TYPE', `${p}.type`, 'an event emitted by a relationship must have type create, update or delete');
        }
        const a = resolveEntity(rel.from);
        const b = resolveEntity(rel.to);
        if (actor && target && a && b) {
          const sameSet = (actor.id === a.id && target.id === b.id) || (actor.id === b.id && target.id === a.id);
          if (!sameSet) add('RELATIONSHIP_MISMATCH', `${p}.relationship`, `actor/target must be the entities of relationship "${String(ev.relationship)}" (${a.id}, ${b.id})`);
        }
      }
    }

    // ---- triggers (law 18) ----
    if (!Array.isArray(ev.triggers) || ev.triggers.length === 0) {
      add('MISSING_TRIGGERS', `${p}.triggers`, 'an event needs at least one trigger');
      return;
    }
    ev.triggers.forEach((t: unknown, j: number) => {
      const tp = `${p}.triggers[${j}]`;
      if (!isObj(t)) { add('INVALID_TRIGGER', tp, 'trigger must be an object'); return; }
      if (typeof t.action !== 'string' || !(EVENT_ACTIONS as readonly string[]).includes(t.action)) {
        add('INVALID_ACTION', `${tp}.action`, `action must be one of: ${EVENT_ACTIONS.join(', ')}`);
        return;
      }
      const action = t.action;
      for (const k of Object.keys(t)) {
        if (k !== 'action' && !ALLOWED_KEYS[action].includes(k)) add('UNKNOWN_TRIGGER_KEY', `${tp}.${k}`, `"${k}" is not used by ${action}`);
      }
      validateTrigger(t, action, tp, actor, target, resolveEntity, add, ev, known, edges);
    });
  });

  // ---- workflow cycles: an event may not (transitively) trigger itself ----
  const color = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (color.get(next) === 1) {
        add('CYCLIC_WORKFLOW', `event "${id}"`, `trigger_workflow forms a cycle: ${[...stack.slice(stack.indexOf(next)), next].join(' -> ')}`);
      } else if (!color.has(next)) visit(next);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of edges.keys()) if (!color.has(id)) visit(id);
}

function validateTrigger(
  t: Obj, action: string, tp: string, actor: Entity | undefined, target: Entity | undefined,
  resolveEntity: (ref: unknown) => Entity | undefined, add: Add, ev: Obj,
  known: Map<string, { actor?: Entity; target?: Entity }>, edges: Map<string, string[]>,
): void {
  const sides = (): Array<'actor' | 'target'> => ['actor', 'target'];
  const entityOf = (s: 'actor' | 'target'): Entity | undefined => (s === 'actor' ? actor : target);

  // Which side of the event addresses the row of `ref` (the actor's row or the target's row)?
  const address = (ref: unknown, path: string): { side: 'actor' | 'target'; entity: Entity } | undefined => {
    const entity = resolveEntity(ref);
    if (!entity) { add('UNKNOWN_ENTITY', path, `"${String(ref)}" is not a known (or is an ambiguous) entity`); return undefined; }
    if (!actor || !target) return undefined; // already reported
    if (t.on !== undefined && t.on !== 'actor' && t.on !== 'target') {
      add('INVALID_ON', `${tp}.on`, 'on must be "actor" or "target"');
      return undefined;
    }
    const matching = sides().filter((s) => entityOf(s)!.id === entity.id);
    if (matching.length === 0) { add('ENTITY_NOT_IN_EVENT', path, `"${entity.id}" is neither the actor (${actor.id}) nor the target (${target.id}) of this event`); return undefined; }
    if (t.on !== undefined) {
      if (!matching.includes(t.on as 'actor' | 'target')) { add('ON_MISMATCH', `${tp}.on`, `"${entity.id}" is not the ${String(t.on)} of this event`); return undefined; }
      return { side: t.on as 'actor' | 'target', entity };
    }
    if (matching.length === 2) { add('AMBIGUOUS_ROW', path, `actor and target are both "${entity.id}"; set "on" to "actor" or "target"`); return undefined; }
    return { side: matching[0], entity };
  };

  // "Entity.attribute" -> the attribute, with the entity addressed through the event.
  const fieldRef = (path: string): { side: 'actor' | 'target'; entity: Entity; attr: Attribute } | undefined => {
    const f = t.field;
    if (typeof f !== 'string' || f.split('.').length !== 2) { add('INVALID_FIELD', path, 'field must be "Entity.attribute"'); return undefined; }
    const [entityRef, attrName] = f.split('.');
    const where = address(entityRef, path);
    if (!where) return undefined;
    const attr = where.entity.attributes.find((a) => a.name === attrName);
    if (!attr) { add('UNKNOWN_ATTRIBUTE', path, `entity "${where.entity.id}" has no attribute "${attrName}"`); return undefined; }
    return { ...where, attr };
  };

  // A literal checked against the attribute type, or { from: "actor" | "target" } for a uuid.
  const checkValue = (a: Attribute, v: unknown, path: string): void => {
    if (isObj(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === 'from' && (v.from === 'actor' || v.from === 'target')) {
        if (a.type !== 'uuid') add('FROM_REQUIRES_UUID', path, `{ "from": ... } can only fill a uuid attribute, "${a.name}" is ${a.type}`);
        return;
      }
      if (a.type !== 'json') { add('INVALID_VALUE', path, 'objects are only accepted as { "from": "actor" | "target" } or for json attributes'); return; }
    }
    const problem = valueProblem(a, v);
    if (problem) add('INVALID_VALUE', path, `value for "${a.name}": ${problem}`);
  };

  const text = (key: string, max: number, required: boolean): void => {
    const v = t[key];
    if (v === undefined) { if (required) add('MISSING_FIELD', `${tp}.${key}`, `${action} requires "${key}"`); return; }
    if (typeof v !== 'string' || v.trim() === '' || v.length > max) add('INVALID_FIELD', `${tp}.${key}`, `${key} must be a non-empty string of at most ${max} characters`);
  };

  switch (action) {
    case 'send_notification':
      for (const k of ['channel', 'template']) {
        if (t[k] !== undefined && (typeof t[k] !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(t[k] as string))) add('INVALID_FIELD', `${tp}.${k}`, `${k} must be a lower-case identifier (a-z, 0-9, _)`);
      }
      if (t.to === undefined) add('MISSING_FIELD', `${tp}.to`, 'send_notification requires "to" (the entity that is notified)');
      else address(t.to, `${tp}.to`);
      text('message', 500, false);
      break;
    case 'send_email': {
      if (t.to === undefined) { add('MISSING_FIELD', `${tp}.to`, 'send_email requires "to" (the entity that is emailed)'); }
      else {
        const where = address(t.to, `${tp}.to`);
        if (where) {
          const emails = where.entity.attributes.filter((a) => a.type === 'email');
          if (t.field !== undefined) {
            const f = fieldRef(`${tp}.field`);
            if (f && f.entity.id !== where.entity.id) add('EMAIL_FIELD_MISMATCH', `${tp}.field`, `field must belong to "${where.entity.id}"`);
            else if (f && f.attr.type !== 'email') add('EMAIL_FIELD_TYPE', `${tp}.field`, `"${f.attr.name}" is ${f.attr.type}, not email`);
          } else if (emails.length === 0) add('NO_EMAIL_FIELD', `${tp}.to`, `entity "${where.entity.id}" has no email attribute`);
          else if (emails.length > 1) add('EMAIL_FIELD_REQUIRED', `${tp}.field`, `entity "${where.entity.id}" has several email attributes; set "field"`);
        }
      }
      text('subject', 200, true);
      text('body', 5000, true);
      break;
    }
    case 'increment':
    case 'decrement': {
      const f = fieldRef(`${tp}.field`);
      if (f && !NUMERIC.includes(f.attr.type)) add('FIELD_NOT_NUMERIC', `${tp}.field`, `${action} needs a number or integer attribute, "${f.attr.name}" is ${f.attr.type}`);
      if (t.by !== undefined) {
        if (typeof t.by !== 'number' || !Number.isFinite(t.by) || t.by <= 0) add('INVALID_AMOUNT', `${tp}.by`, 'by must be a positive number');
        else if ((f?.attr.type === 'integer' || f?.attr.type === 'money') && !Number.isInteger(t.by)) add('INVALID_AMOUNT', `${tp}.by`, `"${f.attr.name}" is whole units; by must be an integer`);
      }
      break;
    }
    case 'update_field': {
      const f = fieldRef(`${tp}.field`);
      if (t.value === undefined || t.value === null) add('MISSING_FIELD', `${tp}.value`, 'update_field requires a non-null "value"');
      else if (f) checkValue(f.attr, t.value, `${tp}.value`);
      break;
    }
    case 'create_entity': {
      const entity = resolveEntity(t.entity);
      if (!entity) { add('UNKNOWN_ENTITY', `${tp}.entity`, `"${String(t.entity)}" is not a known (or is an ambiguous) entity`); break; }
      if (!isObj(t.values)) { add('MISSING_FIELD', `${tp}.values`, 'create_entity requires "values" (an object of attribute values)'); break; }
      const values = t.values;
      for (const [k, v] of Object.entries(values)) {
        const a = entity.attributes.find((x) => x.name === k);
        if (!a) add('UNKNOWN_ATTRIBUTE', `${tp}.values.${k}`, `entity "${entity.id}" has no attribute "${k}"`);
        else checkValue(a, v, `${tp}.values.${k}`);
      }
      for (const a of entity.attributes) {
        if (a.required && a.default === undefined && !a.auto && !(a.name in values)) {
          add('MISSING_REQUIRED_VALUE', `${tp}.values`, `"${a.name}" is required on "${entity.id}" and has no default`);
        }
      }
      break;
    }
    case 'delete_entity':
      if (t.entity === undefined) add('MISSING_FIELD', `${tp}.entity`, 'delete_entity requires "entity" (it is archived, never deleted)');
      else address(t.entity, `${tp}.entity`);
      break;
    case 'log':
      if (t.to !== undefined && t.to !== 'audit') add('INVALID_LOG_TARGET', `${tp}.to`, 'log can only write to "audit"');
      if (t.level !== undefined && (typeof t.level !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(t.level))) add('INVALID_FIELD', `${tp}.level`, 'level must be a lower-case identifier (a-z, 0-9, _)');
      break;
    case 'call_webhook': {
      const u = t.url;
      let ok = false;
      if (typeof u === 'string' && u.length <= 2000) {
        try { const parsed = new URL(u); ok = /^https?:$/.test(parsed.protocol) && parsed.username === '' && parsed.password === '' && parsed.hostname !== ''; } catch { ok = false; }
      }
      if (!ok) add('INVALID_URL', `${tp}.url`, 'url must be an absolute http(s) URL without credentials');
      break;
    }
    case 'trigger_workflow': {
      const w = t.workflow;
      if (typeof w !== 'string' || !known.has(w)) { add('UNKNOWN_WORKFLOW_EVENT', `${tp}.workflow`, `"${String(w)}" is not a declared event`); break; }
      if (w === ev.id) { add('CYCLIC_WORKFLOW', `${tp}.workflow`, 'an event cannot trigger itself'); break; }
      const other = known.get(w)!;
      if (actor && target && other.actor && other.target && (other.actor.id !== actor.id || other.target.id !== target.id)) {
        add('WORKFLOW_ENTITY_MISMATCH', `${tp}.workflow`, `"${w}" must have the same actor and target entities as this event (${actor.id}, ${target.id})`);
      }
      if (typeof ev.id === 'string') edges.set(ev.id, [...(edges.get(ev.id) ?? []), w]);
      break;
    }
  }
}
