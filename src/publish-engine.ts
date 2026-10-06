// Publish Engine (constitution sections 4, 16, 35): the fifth Core engine.
// Input: all four Specs (+ the optional `app` block of the definition). Output: uapp_spec.json.
// Pure data, no code, no timestamps, no randomness (sections 9, 10): same input => same bytes.

import { createHash } from 'node:crypto';
import { ION_VERSION } from './constitution.ts';
import { SPEC_FILES } from './spec-validate.ts';
import type { SpecSet } from './specs.ts';
import { IonValidationError } from './validate.ts';
import type { Issue } from './validate.ts';
import { APP_ID, validateApp } from './app-info.ts';
export { APP_ID, validateApp };

export const UAPP_SPEC_FILE = 'uapp_spec.json';
export interface AppInfo { id: string; name: string; domain: string }

export interface UappSpec {
  uapp_spec: {
    ion_version: string;
    app: AppInfo;
    genome: { locale: string; direction: 'rtl' | 'ltr'; theme: { primary_color: string } };
    specs: Record<'schema' | 'relationship' | 'event' | 'ui', string>;
    manifest_hash: string; // "sha256:<hex>" over the four spec files
    generators_used: string[];
  };
}

export const specJson = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

// The hash covers every spec file by name and content, in constitutional order.
export function manifestHash(files: Record<string, string>): string {
  const h = createHash('sha256');
  for (const file of Object.values(SPEC_FILES)) h.update(`${file}\0${files[file] ?? ''}\n`);
  return 'sha256:' + h.digest('hex');
}

export function specFiles(specs: SpecSet): Record<string, string> {
  return Object.fromEntries(Object.entries(SPEC_FILES).map(([key, file]) => [file, specJson(specs[key as keyof SpecSet])]));
}

export function generateUappSpec(definition: unknown, specs: SpecSet, generatorsUsed: string[] = []): UappSpec {
  const app = ((definition as { app?: Partial<AppInfo> } | null)?.app ?? {}) as Partial<AppInfo>;
  const issues = validateApp((definition as { app?: unknown } | null)?.app);
  for (const id of generatorsUsed) if (typeof id !== 'string' || !APP_ID.test(id)) issues.push({ code: 'INVALID_GENERATOR_ID', path: 'generators_used', message: `"${String(id)}" is not a generator id` });
  if (issues.length) throw new IonValidationError(issues);

  const ui = specs.ui_spec.ui_spec;
  const files = specFiles(specs);
  return {
    uapp_spec: {
      ion_version: ION_VERSION,
      app: { id: app.id ?? 'app', name: app.name ?? 'App', domain: app.domain ?? 'general' },
      genome: {
        locale: ui.default_locale,
        direction: ui.default_locale === 'ar' ? 'rtl' : 'ltr',
        theme: { primary_color: ui.theme.primary_color },
      },
      specs: { schema: SPEC_FILES.schema_spec, relationship: SPEC_FILES.relationship_spec, event: SPEC_FILES.event_spec, ui: SPEC_FILES.ui_spec },
      manifest_hash: manifestHash(files),
      generators_used: [...new Set(generatorsUsed)].sort(),
    },
  };
}

// Cross-check of a uapp_spec against the specs it claims to describe (Spec Validator, section 26).
export function validateUappSpec(uapp: unknown, files: Record<string, string>): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  const u = (uapp as UappSpec | null)?.uapp_spec;
  if (!u || typeof u !== 'object') return [{ code: 'INVALID_SPEC', path: UAPP_SPEC_FILE, message: 'uapp_spec is required' }];
  if (u.ion_version?.split('.')[0] !== ION_VERSION.split('.')[0]) add('INCOMPATIBLE_ION', 'uapp_spec.ion_version', `built for Ion ${String(u.ion_version)}, this is ${ION_VERSION}`);
  if (!u.app || typeof u.app.id !== 'string' || !APP_ID.test(u.app.id)) add('INVALID_APP', 'uapp_spec.app.id', 'app.id must be lower-case letters, digits and "-"');
  const wanted = { schema: SPEC_FILES.schema_spec, relationship: SPEC_FILES.relationship_spec, event: SPEC_FILES.event_spec, ui: SPEC_FILES.ui_spec };
  for (const [k, f] of Object.entries(wanted)) if (u.specs?.[k as keyof typeof wanted] !== f) add('INVALID_SPEC', `uapp_spec.specs.${k}`, `must be "${f}"`);
  if (!Array.isArray(u.generators_used) || u.generators_used.some((g) => typeof g !== 'string' || !APP_ID.test(g))) add('INVALID_GENERATOR_ID', 'uapp_spec.generators_used', 'must be a list of generator ids');
  if (u.manifest_hash !== manifestHash(files)) add('MANIFEST_MISMATCH', 'uapp_spec.manifest_hash', 'the specs were changed after this uapp_spec was produced');
  return issues;
}
