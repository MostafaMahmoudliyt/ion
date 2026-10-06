// Validation of the closed metadata vocabulary (constitution.ts). Runs inside validateDefinition.
//   entity.metadata:        i18n | versioned: true | indexed: [attribute, ...]
//   attribute.metadata:     transitions: { <value>: [<value>, ...] }   (enum attributes only)
//   relationship.metadata:  cascade: none | restrict | archive
//   event.metadata:         i18n | rate: { max, per_seconds }
// Unknown keys are errors, so no metadata is ever accepted and then ignored.

import { ATTRIBUTE_METADATA, CASCADE_MODES, ENTITY_METADATA, EVENT_METADATA, RELATIONSHIP_METADATA } from './constitution.ts';

type Add = (code: string, path: string, message: string) => void;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function keys(meta: unknown, path: string, allowed: readonly string[], add: Add): Obj | null {
  if (meta === undefined) return null;
  if (!isObj(meta)) { add('INVALID_METADATA', `${path}.metadata`, 'metadata must be an object'); return null; }
  for (const k of Object.keys(meta)) if (!allowed.includes(k)) add('UNKNOWN_METADATA', `${path}.metadata.${k}`, `"${k}" is not a metadata key here; allowed: ${allowed.join(', ')}`);
  return meta;
}

export function validateMetadata(def: Obj, add: Add): void {
  (Array.isArray(def.entities) ? def.entities : []).forEach((e: unknown, i: number) => {
    if (!isObj(e)) return;
    const p = `$.entities[${i}]`;
    const attrs = Array.isArray(e.attributes) ? e.attributes.filter(isObj) : [];
    const names = new Set(attrs.map((a) => a.name));
    const m = keys(e.metadata, p, ENTITY_METADATA, add);
    if (m) {
      if (m.versioned !== undefined && m.versioned !== true) add('INVALID_METADATA', `${p}.metadata.versioned`, 'versioned must be true (leave it out to turn it off)');
      if (m.indexed !== undefined) {
        if (!Array.isArray(m.indexed) || m.indexed.length === 0 || new Set(m.indexed).size !== m.indexed.length) add('INVALID_METADATA', `${p}.metadata.indexed`, 'indexed must be a non-empty list of unique attribute names');
        else for (const n of m.indexed) if (!names.has(n)) add('UNKNOWN_ATTRIBUTE', `${p}.metadata.indexed`, `no attribute "${String(n)}" on this entity`);
      }
    }
    attrs.forEach((a, j) => validateAttribute(a, `${p}.attributes[${j}]`, add));
  });
  (Array.isArray(def.relationships) ? def.relationships : []).forEach((r: unknown, i: number) => {
    if (!isObj(r)) return;
    const p = `$.relationships[${i}]`;
    const m = keys(r.metadata, p, RELATIONSHIP_METADATA, add);
    if (m && m.cascade !== undefined && !(CASCADE_MODES as readonly unknown[]).includes(m.cascade)) add('INVALID_METADATA', `${p}.metadata.cascade`, `cascade must be one of: ${CASCADE_MODES.join(', ')}`);
    if (Array.isArray(r.attributes)) r.attributes.filter(isObj).forEach((a, j) => { if (a.metadata !== undefined) add('UNKNOWN_METADATA', `${p}.attributes[${j}].metadata`, 'link attributes take no metadata'); });
  });
  (Array.isArray(def.events) ? def.events : []).forEach((ev: unknown, i: number) => {
    if (!isObj(ev)) return;
    const p = `$.events[${i}]`;
    const m = keys(ev.metadata, p, EVENT_METADATA, add);
    if (m && m.rate !== undefined) {
      const r = m.rate;
      const ok = isObj(r) && Object.keys(r).every((k) => k === 'max' || k === 'per_seconds') && Number.isInteger(r.max) && (r.max as number) >= 1 && (r.max as number) <= 1_000_000 && Number.isInteger(r.per_seconds) && (r.per_seconds as number) >= 1 && (r.per_seconds as number) <= 86400;
      if (!ok) add('INVALID_METADATA', `${p}.metadata.rate`, 'rate must be { max, per_seconds }: whole numbers, max 1..1000000, per_seconds 1..86400');
    }
  });
}

function validateAttribute(a: Obj, p: string, add: Add): void {
  const m = keys(a.metadata, p, ATTRIBUTE_METADATA, add);
  if (!m || m.transitions === undefined) return;
  const t = m.transitions, tp = `${p}.metadata.transitions`;
  if (a.type !== 'enum') { add('INVALID_METADATA', tp, 'transitions are only valid on enum attributes'); return; }
  if (!isObj(t) || Object.keys(t).length === 0) { add('INVALID_METADATA', tp, 'transitions must map each state to the list of states it may move to'); return; }
  const values = Array.isArray(a.values) ? a.values : [];
  for (const [from, to] of Object.entries(t)) {
    if (!values.includes(from)) add('INVALID_METADATA', `${tp}.${from}`, `"${from}" is not a value of this enum`);
    if (!Array.isArray(to) || new Set(to).size !== to.length) { add('INVALID_METADATA', `${tp}.${from}`, 'the next states must be a list of unique values'); continue; }
    for (const n of to) if (!values.includes(n)) add('INVALID_METADATA', `${tp}.${from}`, `"${String(n)}" is not a value of this enum`);
    if (to.includes(from)) add('INVALID_METADATA', `${tp}.${from}`, 'a state cannot list itself as its next state');
  }
}
