// Ion Core build: the four Spec engines in constitutional order (section 87).
// The fifth file, uapp_spec.json, belongs to the Publish Engine (not part of this delivery).
// No timestamps, no randomness (section 9): the same definition always yields the same bytes.

import { createHash } from 'node:crypto';
import { generateEventSpec } from './event-engine.ts';
import { generateRelationshipSpec } from './relationship-engine.ts';
import { generateSchemaSpec } from './schema-engine.ts';
import { generateUiSpec } from './ui-engine.ts';
import { UAPP_SPEC_FILE, generateUappSpec } from './publish-engine.ts';
import type { UappSpec } from './publish-engine.ts';
import { SPEC_FILES, validateSpecs } from './spec-validate.ts';
import { IonValidationError } from './validate.ts';
import type { SpecSet } from './specs.ts';

export interface BuildOutput {
  specs: SpecSet;
  files: Record<string, string>; // specs/<name>.json -> content, in engine order
  sha256: Record<string, string>;
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

export function buildSpecs(definition: unknown): BuildOutput {
  // Each engine receives the output of the engines before it (section 88).
  const schema_spec = generateSchemaSpec(definition);
  const relationship_spec = generateRelationshipSpec(definition);
  const event_spec = generateEventSpec(definition, schema_spec, relationship_spec);
  const ui_spec = generateUiSpec(definition, schema_spec, relationship_spec, event_spec);
  const specs: SpecSet = { schema_spec, relationship_spec, event_spec, ui_spec };

  // The engines' own output must pass the same validator generators run (laws: validate everything).
  const issues = validateSpecs(specs);
  if (issues.length) throw new IonValidationError(issues);

  const files: Record<string, string> = {};
  for (const [key, file] of Object.entries(SPEC_FILES)) files[file] = json(specs[key as keyof SpecSet]);
  const sha256 = Object.fromEntries(Object.entries(files).map(([n, c]) => [n, createHash('sha256').update(c).digest('hex')]));
  return { specs, files, sha256 };
}

// ---- Publish Engine step (the fifth Spec, section 35) ----
export interface AppBuild extends BuildOutput { uapp_spec: UappSpec }

export function buildApp(definition: unknown, generatorsUsed: string[] = []): AppBuild {
  const built = buildSpecs(definition);
  const uapp_spec = generateUappSpec(definition, built.specs, generatorsUsed);
  const files = { ...built.files, [UAPP_SPEC_FILE]: json(uapp_spec) };
  const sha256 = Object.fromEntries(Object.entries(files).map(([n, c]) => [n, createHash('sha256').update(c).digest('hex')]));
  return { specs: built.specs, files, sha256, uapp_spec };
}
