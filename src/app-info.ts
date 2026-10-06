// Optional `app` block of a definition (section 35: id, name, domain). Read by the Publish Engine only.
import type { Issue } from './validate.ts';

export const APP_ID = /^[a-z][a-z0-9-]*$/;

export function validateApp(app: unknown): Issue[] {
  if (app === undefined) return [];
  const bad = (path: string, message: string): Issue => ({ code: 'INVALID_APP', path: `$.app${path}`, message });
  if (typeof app !== 'object' || app === null || Array.isArray(app)) return [bad('', 'app must be an object { id, name, domain }')];
  const o = app as Record<string, unknown>;
  const issues: Issue[] = [];
  if (o.id !== undefined && (typeof o.id !== 'string' || !APP_ID.test(o.id))) issues.push(bad('.id', 'id must be lower-case letters, digits and "-"'));
  for (const k of ['name', 'domain'] as const) if (o[k] !== undefined && (typeof o[k] !== 'string' || (o[k] as string).trim() === '' || (o[k] as string).length > 100)) issues.push(bad(`.${k}`, `${k} must be a non-empty string (max 100)`));
  return issues;
}

