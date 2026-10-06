// The .uapp = a deployed app (decision on the uapp conflict). NOT one file: a folder with one sub-folder
// per extension target (web/, backend/..., later ios/ android/ desktop/) and manifest.json as its index.
//   <app-id>.uapp/
//     manifest.json
//     web/ ...            <- ui-web
//     backend/database/   <- sql-postgres, backend/events/, backend/api/ ...
// Produced from a .ion by running Generators. Deterministic: no timestamps, files sorted.

import { sha256, openBundle } from './bundle.ts';
import { runGenerators } from './generator.ts';
import type { GeneratorRun } from './generator.ts';
import { specJson } from './publish-engine.ts';

export interface UappManifest {
  uapp: {
    ion_version: string;
    app: { id: string; name: string; domain: string };
    source_manifest_hash: string; // the .ion this app was generated from
    entries: Array<{
      generator: string;
      version: string;
      kind: string;
      path: string; // folder inside the .uapp
      files: Array<{ path: string; sha256: string; bytes: number }>;
    }>;
  };
}

export const MANIFEST_FILE = 'manifest.json';

export interface UappResult { dir: string; files: Record<string, string>; manifest: UappManifest }

// bundleText -> the files of the .uapp (paths relative to the .uapp folder).
export async function buildUapp(bundleText: string, extensionsDir: string, generatorIds?: string[]): Promise<UappResult> {
  const { specs, uapp_spec } = openBundle(bundleText);
  const u = uapp_spec.uapp_spec;
  const ids = generatorIds ?? (u.generators_used.length ? u.generators_used : undefined);
  const runs: GeneratorRun[] = await runGenerators(specs, extensionsDir, ids);

  const files: Record<string, string> = {};
  const entries: UappManifest['uapp']['entries'] = [];
  for (const run of [...runs].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))) {
    const listed: UappManifest['uapp']['entries'][number]['files'] = [];
    for (const name of Object.keys(run.files).sort()) {
      const path = `${run.target}/${name}`;
      if (files[path] !== undefined) throw new Error(`two extensions write ${path}; give each a distinct "target" in its manifest`);
      files[path] = run.files[name];
      listed.push({ path: name, sha256: sha256(run.files[name]), bytes: Buffer.byteLength(run.files[name]) });
    }
    entries.push({ generator: run.id, version: run.version, kind: run.kind, path: run.target, files: listed });
  }
  const manifest: UappManifest = { uapp: { ion_version: u.ion_version, app: u.app, source_manifest_hash: u.manifest_hash, entries } };
  files[MANIFEST_FILE] = specJson(manifest);
  return { dir: `${u.app.id}.uapp`, files, manifest };
}
