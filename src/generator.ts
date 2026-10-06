// Generator / Renderer contract (constitution sections 38-41, 46, 53-55, 70).
// Core does not know any platform: it loads extensions listed in registry.json, hands them the
// validated specs, and writes what they return. An extension may not reach outside its own folder.

import { readFileSync } from 'node:fs';
import { join, posix, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ION_VERSION } from './constitution.ts';
import { validateSpecs } from './spec-validate.ts';
import type { SpecSet } from './specs.ts';
import { IonValidationError } from './validate.ts';
import type { Issue } from './validate.ts';

export const GENERATOR_KINDS = ['database', 'api', 'ui', 'cloud', 'utility'] as const; // section 47: 5 kinds
export const SPEC_NAMES = ['schema', 'relationship', 'event', 'ui'] as const;

export interface GeneratorManifest {
  id: string;
  kind: (typeof GENERATOR_KINDS)[number];
  version: string;
  official: boolean;
  entry: string; // module exporting generate(specs)
  reads: Array<(typeof SPEC_NAMES)[number]>;
  ion: string; // the Ion major version this extension targets
  description: string;
  target?: string; // folder inside the .uapp this extension's files go to (additive; default: the extension id)
}

export type GenerateFn = (specs: SpecSet) => Record<string, string>;

export interface RegistryEntry { id: string; path: string; version: string; official: boolean }

const ID = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function validateManifest(m: unknown, entry?: RegistryEntry): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  if (typeof m !== 'object' || m === null) return [{ code: 'INVALID_MANIFEST', path: '$', message: 'manifest must be an object' }];
  const o = m as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID.test(o.id)) add('INVALID_MANIFEST', 'id', 'id must be lower-case letters, digits and "-"');
  if (!(GENERATOR_KINDS as readonly string[]).includes(o.kind as string)) add('INVALID_MANIFEST', 'kind', `kind must be one of: ${GENERATOR_KINDS.join(', ')}`);
  if (typeof o.version !== 'string' || !SEMVER.test(o.version)) add('INVALID_MANIFEST', 'version', 'version must be semantic (x.y.z)');
  if (typeof o.official !== 'boolean') add('INVALID_MANIFEST', 'official', 'official must be a boolean');
  if (typeof o.entry !== 'string' || o.entry.includes('..') || o.entry.startsWith('/')) add('INVALID_MANIFEST', 'entry', 'entry must be a relative path inside the extension folder');
  if (!Array.isArray(o.reads) || o.reads.length === 0 || o.reads.some((r) => !(SPEC_NAMES as readonly string[]).includes(r as string))) add('INVALID_MANIFEST', 'reads', `reads must list specs from: ${SPEC_NAMES.join(', ')}`);
  if (typeof o.ion !== 'string' || o.ion.split('.')[0] !== ION_VERSION.split('.')[0]) add('INCOMPATIBLE_ION', 'ion', `extension targets Ion ${String(o.ion)}, this is ${ION_VERSION}`);
  if (typeof o.description !== 'string' || o.description.trim() === '') add('INVALID_MANIFEST', 'description', 'description is required');
  if (o.target !== undefined && (typeof o.target !== 'string' || !safeRelativePath(o.target))) add('INVALID_MANIFEST', 'target', 'target must be a plain relative folder path');
  if (entry && (o.id !== entry.id || o.version !== entry.version || o.official !== entry.official)) add('REGISTRY_MISMATCH', 'registry', `registry entry "${entry.id}" disagrees with its manifest (the registry is the source of truth, section 41)`);
  return issues;
}

// Only plain relative file paths, no traversal, no empty names (law: no code escapes its sandbox).
export function safeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p === '' || p.length > 200 || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  const n = posix.normalize(p);
  return n === p && !n.split('/').some((seg) => seg === '..' || seg === '.' || seg === '');
}

export interface GeneratorRun { id: string; version: string; kind: GeneratorManifest['kind']; target: string; files: Record<string, string> }

// Loads registry.json, runs the requested generators (default: every official one) over validated specs.
export async function runGenerators(specs: SpecSet, extensionsDir: string, ids?: string[]): Promise<GeneratorRun[]> {
  const specIssues = validateSpecs(specs);
  if (specIssues.length) throw new IonValidationError(specIssues);

  const registry = JSON.parse(readFileSync(join(extensionsDir, 'registry.json'), 'utf8')) as { generators: RegistryEntry[] };
  const wanted = registry.generators.filter((g) => (ids ? ids.includes(g.id) : g.official));
  const missing = (ids ?? []).filter((id) => !registry.generators.some((g) => g.id === id));
  if (missing.length) throw new IonValidationError(missing.map((id) => ({ code: 'UNKNOWN_GENERATOR', path: id, message: `"${id}" is not in registry.json` })));

  const runs: GeneratorRun[] = [];
  for (const entry of wanted) {
    const dir = resolvePath(extensionsDir, entry.path);
    if (!dir.startsWith(resolvePath(extensionsDir) + '/')) throw new IonValidationError([{ code: 'UNSAFE_PATH', path: entry.id, message: 'registry path leaves the extensions folder' }]);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as GeneratorManifest;
    const problems = validateManifest(manifest, entry);
    if (problems.length) throw new IonValidationError(problems.map((i) => ({ ...i, path: `${entry.id}.${i.path}` })));

    const mod = (await import(pathToFileURL(join(dir, manifest.entry)).href)) as { generate?: GenerateFn };
    if (typeof mod.generate !== 'function') throw new IonValidationError([{ code: 'INVALID_GENERATOR', path: entry.id, message: `${manifest.entry} must export generate(specs)` }]);
    const files = mod.generate(structuredClone(specs)); // a generator can never mutate the shared specs
    for (const [name, content] of Object.entries(files)) {
      if (!safeRelativePath(name)) throw new IonValidationError([{ code: 'UNSAFE_PATH', path: `${entry.id}:${name}`, message: 'generators may only write plain relative paths' }]);
      if (typeof content !== 'string') throw new IonValidationError([{ code: 'INVALID_GENERATOR', path: `${entry.id}:${name}`, message: 'file content must be a string' }]);
    }
    runs.push({ id: entry.id, version: entry.version, kind: manifest.kind, target: manifest.target ?? entry.id, files });
  }
  return runs;
}
