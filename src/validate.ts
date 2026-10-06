import {
  ATTRIBUTE_TYPES, ENTITY_TYPES, RELATIONSHIP_TYPES, RESERVED_COLUMNS, RESERVED_PREFIX,
} from './constitution.ts';
import { snake, tableName } from './naming.ts';
import { makeResolver } from './resolve.ts';
import { validateEvents } from './validate-events.ts';
import { validateI18n } from './validate-ui.ts';
import { validateMetadata } from './validate-metadata.ts';
import { validateApp } from './app-info.ts';

export { makeResolver };

export interface Issue {
  code: string;
  path: string;
  message: string;
}

export class IonValidationError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]) {
    super(
      `Invalid Ion definition (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((i) => `  [${i.code}] ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'IonValidationError';
    this.issues = issues;
  }
}

// Identifiers end up inside SQL and URLs: letters/digits/underscore only (law 15, no injection).
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const COLUMN = /^[a-z][a-z0-9_]*$/;

type Add = (code: string, path: string, message: string) => void;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const has = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

function checkDefault(a: Record<string, unknown>, type: string, p: string, add: Add): void {
  const d = a.default;
  switch (type) {
    case 'number':
      if (typeof d !== 'number' || !Number.isFinite(d)) add('INVALID_DEFAULT', `${p}.default`, 'default must be a finite number');
      break;
    case 'integer':
      if (typeof d !== 'number' || !Number.isInteger(d)) add('INVALID_DEFAULT', `${p}.default`, 'default must be an integer');
      break;
    case 'money':
      if (typeof d !== 'number' || !Number.isSafeInteger(d)) add('INVALID_DEFAULT', `${p}.default`, 'a money default is whole minor units (12050 = 120.50), an integer');
      break;
    case 'boolean':
      if (typeof d !== 'boolean') add('INVALID_DEFAULT', `${p}.default`, 'default must be a boolean');
      break;
    case 'enum':
      if (typeof d !== 'string' || !Array.isArray(a.values) || !a.values.includes(d)) {
        add('INVALID_DEFAULT', `${p}.default`, 'default must be one of the enum values');
      }
      break;
    case 'json':
    case 'array':
      add('DEFAULT_NOT_SUPPORTED', `${p}.default`, `defaults are not supported for type "${type}"`);
      break;
    default:
      if (typeof d !== 'string') add('INVALID_DEFAULT', `${p}.default`, `default for type "${type}" must be a string`);
  }
}

function validateAttributeList(list: unknown, path: string, add: Add, fkOnly: boolean): void {
  if (!Array.isArray(list)) {
    add('MISSING_ATTRIBUTES', path, 'attributes must be an array');
    return;
  }
  const seen = new Set<string>();
  list.forEach((a: unknown, i: number) => {
    const p = `${path}[${i}]`;
    if (!isObj(a)) {
      add('INVALID_ATTRIBUTE', p, 'attribute must be an object');
      return;
    }
    const name = a.name;
    if (typeof name !== 'string' || !COLUMN.test(name)) {
      add('INVALID_NAME', `${p}.name`, 'attribute name must be lower snake_case (a-z, 0-9, _), starting with a letter');
    } else {
      if ((RESERVED_COLUMNS as readonly string[]).includes(name)) {
        add('RESERVED_COLUMN', `${p}.name`, `"${name}" is generated automatically on every table`);
      }
      if (seen.has(name)) add('DUPLICATE_ATTRIBUTE', `${p}.name`, `duplicate attribute "${name}"`);
      seen.add(name);
    }
    const type = a.type;
    if (!has(ATTRIBUTE_TYPES, type)) {
      add('INVALID_ATTRIBUTE_TYPE', `${p}.type`, `type must be one of: ${ATTRIBUTE_TYPES.join(', ')}`);
      return;
    }
    for (const flag of ['required', 'unique', 'auto']) {
      if (a[flag] !== undefined && typeof a[flag] !== 'boolean') add('INVALID_FLAG', `${p}.${flag}`, `${flag} must be a boolean`);
    }
    if (fkOnly && (a.required === true || a.unique === true)) {
      add('UNSUPPORTED_ON_FK_RELATIONSHIP', p, 'required/unique are only allowed on many-to-many relationship attributes');
    }
    if (a.auto === true) {
      if (!['date', 'timestamp', 'uuid'].includes(type as string)) add('INVALID_AUTO', `${p}.auto`, 'auto is only valid for date, timestamp, uuid');
      if (a.default !== undefined) add('AUTO_WITH_DEFAULT', p, 'an attribute cannot have both auto and default');
    }
    if (type === 'enum') {
      const v = a.values;
      if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string' || x === '') || new Set(v).size !== v.length) {
        add('INVALID_ENUM_VALUES', `${p}.values`, 'enum requires a non-empty array of unique, non-empty strings');
      }
    } else if (a.values !== undefined) {
      add('VALUES_ON_NON_ENUM', `${p}.values`, 'values is only valid for enum attributes');
    }
    if (type === 'money') {
      if (a.scale !== undefined && (typeof a.scale !== 'number' || !Number.isInteger(a.scale) || a.scale < 0 || a.scale > 4)) add('INVALID_SCALE', `${p}.scale`, 'scale must be an integer from 0 to 4');
    } else if (a.scale !== undefined) {
      add('SCALE_ON_NON_MONEY', `${p}.scale`, 'scale is only valid for money attributes');
    }
    if (a.default !== undefined && a.auto !== true) checkDefault(a, type as string, p, add);
  });
}

export function validateDefinition(def: unknown): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (code, path, message) => { issues.push({ code, path, message }); };

  if (!isObj(def)) {
    add('INVALID_DEFINITION', '$', 'definition must be an object');
    return issues;
  }
  issues.push(...validateApp(def.app));
  if (!Array.isArray(def.entities)) {
    add('MISSING_ENTITIES', '$.entities', 'entities must be an array');
    return issues;
  }
  const relationships = def.relationships === undefined ? [] : def.relationships;
  if (!Array.isArray(relationships)) {
    add('INVALID_RELATIONSHIPS', '$.relationships', 'relationships must be an array');
    return issues;
  }

  // ---- entities (laws 1, 4, 9) ----
  const ids = new Set<string>();
  const tables = new Set<string>();
  const usable: Array<{ id: string; name: string }> = [];
  def.entities.forEach((e: unknown, i: number) => {
    const p = `$.entities[${i}]`;
    if (!isObj(e)) {
      add('INVALID_ENTITY', p, 'entity must be an object');
      return;
    }
    if (typeof e.id !== 'string' || !IDENT.test(e.id)) {
      add('INVALID_ID', `${p}.id`, 'entity id is required and may contain only letters, digits and underscore');
    } else {
      if (snake(e.id).startsWith(RESERVED_PREFIX)) add('RESERVED_NAMESPACE', `${p}.id`, `ids starting with "${RESERVED_PREFIX}" are reserved for system records`);
      const key = snake(e.id);
      if (ids.has(key)) add('DUPLICATE_ID', `${p}.id`, `duplicate entity id "${e.id}"`);
      ids.add(key);
      if (tables.has(tableName(e.id))) add('TABLE_NAME_CONFLICT', `${p}.id`, `entity "${e.id}" maps to table "${tableName(e.id)}", which another entity already uses`);
      tables.add(tableName(e.id));
    }
    if (typeof e.name !== 'string' || e.name.trim() === '') add('MISSING_NAME', `${p}.name`, 'entity name is required');
    if (!has(ENTITY_TYPES, e.type)) add('INVALID_ENTITY_TYPE', `${p}.type`, `type must be one of: ${ENTITY_TYPES.join(', ')}`);
    validateAttributeList(e.attributes, `${p}.attributes`, add, false);
    if (typeof e.id === 'string' && typeof e.name === 'string') usable.push({ id: e.id, name: e.name });
  });

  // ---- relationships (laws 2, 5, 9) ----
  const resolve = makeResolver(usable);
  const relIds = new Set<string>();
  const junctions = new Set<string>();
  relationships.forEach((r: unknown, i: number) => {
    const p = `$.relationships[${i}]`;
    if (!isObj(r)) {
      add('INVALID_RELATIONSHIP', p, 'relationship must be an object');
      return;
    }
    if (typeof r.id !== 'string' || !IDENT.test(r.id)) {
      add('INVALID_ID', `${p}.id`, 'relationship id is required and may contain only letters, digits and underscore');
    } else {
      if (snake(r.id).startsWith(RESERVED_PREFIX)) add('RESERVED_NAMESPACE', `${p}.id`, `ids starting with "${RESERVED_PREFIX}" are reserved for system records`);
      const key = snake(r.id);
      if (relIds.has(key)) add('DUPLICATE_ID', `${p}.id`, `duplicate relationship id "${r.id}"`);
      relIds.add(key);
    }
    const typeOk = has(RELATIONSHIP_TYPES, r.type);
    if (!typeOk) add('INVALID_RELATIONSHIP_TYPE', `${p}.type`, `type must be one of: ${RELATIONSHIP_TYPES.join(', ')}`);
    const from = resolve(r.from);
    const to = resolve(r.to);
    if (!from) add('UNKNOWN_ENTITY', `${p}.from`, `"${String(r.from)}" is not a known (or is an ambiguous) entity`);
    if (!to) add('UNKNOWN_ENTITY', `${p}.to`, `"${String(r.to)}" is not a known (or is an ambiguous) entity`);
    if (from && to && typeOk) {
      if (r.type === 'self' && from.id !== to.id) add('SELF_MISMATCH', p, 'a self relationship must have the same entity in from and to');
      if (r.type !== 'self' && from.id === to.id) add('NON_SELF_SAME_ENTITY', p, 'use type "self" when from and to are the same entity');
    }
    if (r.attributes !== undefined) validateAttributeList(r.attributes, `${p}.attributes`, add, r.type !== 'many-to-many');
    if (r.type === 'many-to-many' && typeof r.id === 'string' && IDENT.test(r.id)) {
      const jt = tableName(r.id);
      if (tables.has(jt) || junctions.has(jt)) add('TABLE_NAME_CONFLICT', `${p}.id`, `junction table "${jt}" collides with another table`);
      junctions.add(jt);
    }
  });

  // ---- events (laws 3, 6, 7, 9, 18, 32) ----
  validateEvents(def, add);

  // ---- display metadata read by the UI Engine ----
  validateI18n(def, add);

  // ---- behaviour metadata (closed vocabulary) ----
  validateMetadata(def, add);

  return issues;
}
