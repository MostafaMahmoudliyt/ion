// Metadata processors (extension, not Core). A processor is DATA: a manifest that says
//   "when an entity carries metadata.<key>, add these entities / relationships / events to the definition".
// Expansion happens BEFORE Core sees the definition, so Core still receives only the three primitives,
// the metadata vocabulary stays closed (the processor key is consumed and removed), and nothing is executed:
// no code, no eval, no network. The result is an ordinary definition that the 5 engines validate as usual.
//
//   expandDefinition(definition, processors) -> { definition, applied }
//   loadProcessors(dir)                      -> Processor[]   (reads <dir>/registry.json)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENTITY_METADATA, IonValidationError } from '../../src/index.ts';
import type { Issue } from '../../src/index.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ParamSpec { enum: string[]; default: string }
export interface Processor {
  id: string;
  key: string; // the entity metadata key it handles
  version: string;
  params: Record<string, ParamSpec>; // allowed fields when the key is an object; the key may also be plain `true`
  expand: { entities?: Obj[]; relationships?: Obj[]; events?: Obj[] };
}
export interface Applied { processor: string; entity: string; added: string[] }

const SINGULAR = { entities: 'entity', relationships: 'relationship', events: 'event' } as const;
const KEY = /^[a-z][a-z0-9_]*$/;
const TOKEN = /\{\{\s*([a-z.]+)\s*\}\}/g;

function fail(code: string, path: string, message: string): never {
  throw new IonValidationError([{ code, path, message }]);
}

export function validateProcessor(p: unknown, path = 'processor'): Processor {
  if (!isObj(p)) return fail('INVALID_PROCESSOR', path, 'a processor must be an object');
  const { id, key, version, params, expand } = p;
  if (typeof id !== 'string' || !KEY.test(id)) fail('INVALID_PROCESSOR', `${path}.id`, 'id must be lower-case letters, digits and "_"');
  if (typeof key !== 'string' || !KEY.test(key)) fail('INVALID_PROCESSOR', `${path}.key`, 'key must be lower-case letters, digits and "_"');
  if ((ENTITY_METADATA as readonly string[]).includes(key as string)) fail('INVALID_PROCESSOR', `${path}.key`, `"${String(key)}" is already a Core metadata key`);
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) fail('INVALID_PROCESSOR', `${path}.version`, 'version must be x.y.z');
  if (p.on !== 'entity') fail('INVALID_PROCESSOR', `${path}.on`, 'only entity metadata can be processed');
  const ps = params === undefined ? {} : params;
  if (!isObj(ps)) return fail('INVALID_PROCESSOR', `${path}.params`, 'params must be an object');
  for (const [name, spec] of Object.entries(ps)) {
    if (!KEY.test(name) || !isObj(spec) || !Array.isArray(spec.enum) || spec.enum.length === 0 || !spec.enum.every((v) => typeof v === 'string') || typeof spec.default !== 'string' || !spec.enum.includes(spec.default)) {
      fail('INVALID_PROCESSOR', `${path}.params.${name}`, 'a param is { enum: [string, ...], default: one of them }');
    }
  }
  if (!isObj(expand)) return fail('INVALID_PROCESSOR', `${path}.expand`, 'expand must hold entities, relationships and/or events');
  for (const k of Object.keys(expand)) if (!['entities', 'relationships', 'events'].includes(k)) fail('INVALID_PROCESSOR', `${path}.expand.${k}`, 'only entities, relationships and events can be added');
  for (const k of ['entities', 'relationships', 'events']) {
    const list = expand[k];
    if (list !== undefined && (!Array.isArray(list) || !list.every(isObj))) fail('INVALID_PROCESSOR', `${path}.expand.${k}`, `${k} must be a list of objects`);
  }
  if (!Array.isArray(expand.entities) || expand.entities.length === 0) fail('INVALID_PROCESSOR', `${path}.expand.entities`, 'a processor adds at least one entity');
  // No recursion: what a processor adds is plain primitives, never another processor key.
  for (const e of expand.entities as Obj[]) if (isObj(e.metadata)) for (const k of Object.keys(e.metadata)) if (k === key) fail('INVALID_PROCESSOR', `${path}.expand.entities`, 'an expansion may not use its own key');
  return { ...p, params: ps } as unknown as Processor;
}

function substitute(value: unknown, vars: Record<string, string>, path: string): unknown {
  if (typeof value === 'string') {
    return value.replace(TOKEN, (_m, name: string) => {
      if (!(name in vars)) fail('INVALID_PROCESSOR', path, `unknown placeholder {{${name}}}`);
      return vars[name];
    });
  }
  if (Array.isArray(value)) return value.map((v, i) => substitute(v, vars, `${path}[${i}]`));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars, `${path}.${k}`)]));
  return value;
}

export function expandDefinition(definition: unknown, processors: Processor[]): { definition: unknown; applied: Applied[] } {
  if (!isObj(definition) || !Array.isArray(definition.entities)) return { definition, applied: [] }; // Core reports the real problem
  const keys = new Set<string>();
  const procs = processors.map((p, i) => validateProcessor(p, `processors[${i}]`));
  for (const p of procs) { if (keys.has(p.key)) fail('INVALID_PROCESSOR', `processors.${p.id}`, `two processors handle "${p.key}"`); keys.add(p.key); }

  const out = structuredClone(definition) as Obj;
  const lists = { entities: out.entities as Obj[], relationships: (out.relationships ??= []) as Obj[], events: (out.events ??= []) as Obj[] };
  const applied: Applied[] = [];
  const taken = (kind: keyof typeof lists, id: unknown): boolean => lists[kind].some((x) => x.id === id);

  const originals = [...lists.entities];
  originals.forEach((entity, i) => {
    if (!isObj(entity) || !isObj(entity.metadata)) return;
    for (const p of procs) {
      const meta = entity.metadata as Obj;
      if (!(p.key in meta)) continue;
      const path = `$.entities[${i}].metadata.${p.key}`;
      const raw = meta[p.key];
      const given: Obj = raw === true ? {} : isObj(raw) ? raw : fail('INVALID_PARAMS', path, `${p.key} must be true or an object of its params`);
      for (const k of Object.keys(given)) if (!(k in p.params)) fail('INVALID_PARAMS', `${path}.${k}`, `"${k}" is not a param of ${p.id}; allowed: ${Object.keys(p.params).join(', ') || 'none (use true)'}`);
      const vars: Record<string, string> = { 'entity.id': String(entity.id), 'entity.name': String(entity.name ?? entity.id) };
      for (const [name, spec] of Object.entries(p.params)) {
        const v = given[name] ?? spec.default;
        if (typeof v !== 'string' || !spec.enum.includes(v)) fail('INVALID_PARAMS', `${path}.${name}`, `${name} must be one of: ${spec.enum.join(', ')}`);
        vars[`param.${name}`] = v;
      }
      const added: string[] = [];
      for (const kind of ['entities', 'relationships', 'events'] as const) {
        for (const tpl of p.expand[kind] ?? []) {
          const item = substitute(tpl, vars, `${p.id}.expand.${kind}`) as Obj;
          if (taken(kind, item.id)) fail('EXPANSION_CONFLICT', path, `${p.id} would add ${SINGULAR[kind]} "${String(item.id)}" but it already exists`);
          lists[kind].push(item);
          added.push(`${SINGULAR[kind]}:${String(item.id)}`);
        }
      }
      delete meta[p.key]; // consumed: Core never sees a key it does not know
      applied.push({ processor: p.id, entity: String(entity.id), added });
    }
    if (Object.keys(entity.metadata as Obj).length === 0) delete entity.metadata;
  });
  return { definition: out, applied };
}

export function loadProcessors(dir: string): Processor[] {
  const registry = join(dir, 'registry.json');
  if (!existsSync(registry)) return [];
  const list = JSON.parse(readFileSync(registry, 'utf8')) as { processors: Array<{ id: string; path: string }> };
  return list.processors.map((r) => {
    const p = validateProcessor(JSON.parse(readFileSync(join(dir, r.path, 'processor.json'), 'utf8')), `${r.id}/processor.json`);
    if (p.id !== r.id) fail('INVALID_PROCESSOR', r.id, `registry id "${r.id}" differs from the manifest id "${p.id}"`);
    return p;
  });
}

export type { Issue };
