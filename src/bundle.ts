// The .ion file = Spec Bundle (decision on the uapp conflict): the 5 Specs + metadata + manifest hash.
// One JSON file, no code, no timestamps: the same definition always yields the same bytes (section 9).
//   .ion --(Generators)--> .uapp   (see uapp.ts)

import { createHash } from 'node:crypto';
import { ION_VERSION } from './constitution.ts';
import { buildApp } from './build.ts';
import type { AppBuild } from './build.ts';
import { SPEC_FILES, loadSpecs } from './spec-validate.ts';
import { UAPP_SPEC_FILE, manifestHash, specJson, validateUappSpec } from './publish-engine.ts';
import type { UappSpec } from './publish-engine.ts';
import type { SpecSet } from './specs.ts';
import { IonValidationError } from './validate.ts';

export interface IonBundle {
  ion_bundle: {
    ion_version: string;
    app: UappSpec['uapp_spec']['app'];
    manifest_hash: string;
    specs: Record<string, unknown>; // file name -> spec, the four Specs plus uapp_spec.json
  };
}

export function createBundle(built: AppBuild): IonBundle {
  const u = built.uapp_spec.uapp_spec;
  const specs: Record<string, unknown> = {};
  for (const [key, file] of Object.entries(SPEC_FILES)) specs[file] = built.specs[key as keyof SpecSet];
  specs[UAPP_SPEC_FILE] = built.uapp_spec;
  return { ion_bundle: { ion_version: u.ion_version, app: u.app, manifest_hash: u.manifest_hash, specs } };
}

export const bundleText = (b: IonBundle): string => specJson(b);
export const bundleFileName = (b: IonBundle): string => `${b.ion_bundle.app.id}.ion`;

// Reads a .ion file and refuses anything that does not validate or was edited after publishing.
export function openBundle(text: string): { bundle: IonBundle; specs: SpecSet; uapp_spec: UappSpec } {
  let parsed: any;
  try { parsed = JSON.parse(text); } catch (e) { throw new IonValidationError([{ code: 'INVALID_JSON', path: '.ion', message: (e as Error).message }]); }
  const b = parsed?.ion_bundle;
  if (!b || typeof b !== 'object' || typeof b.specs !== 'object' || b.specs === null) throw new IonValidationError([{ code: 'INVALID_BUNDLE', path: '.ion', message: 'not a Ion bundle (ion_bundle.specs is missing)' }]);
  if (typeof b.ion_version !== 'string' || b.ion_version.split('.')[0] !== ION_VERSION.split('.')[0]) throw new IonValidationError([{ code: 'INCOMPATIBLE_ION', path: 'ion_bundle.ion_version', message: `bundle is for Ion ${String(b.ion_version)}, this is ${ION_VERSION}` }]);

  const files: Record<string, string> = {};
  for (const file of Object.values(SPEC_FILES)) if (b.specs[file] !== undefined) files[file] = specJson(b.specs[file]);
  const loaded = loadSpecs(files);
  if (!loaded.specs) throw new IonValidationError(loaded.issues);

  const uapp = b.specs[UAPP_SPEC_FILE];
  const issues = validateUappSpec(uapp, files);
  if (b.manifest_hash !== manifestHash(files)) issues.push({ code: 'MANIFEST_MISMATCH', path: 'ion_bundle.manifest_hash', message: 'the bundle was changed after it was published' });
  if (issues.length) throw new IonValidationError(issues);
  return { bundle: parsed as IonBundle, specs: loaded.specs, uapp_spec: uapp as UappSpec };
}

export { buildApp };
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
