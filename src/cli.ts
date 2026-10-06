// Usage (constitution section 23):
//   ion init <name>                                   -> ./<name>/ion.json (an empty definition)
//   ion add entity|relation|event <def.json> --id <id> [--to <project.json>]   -> adds it to the project (default ./ion.json)
//   ion build   <definition.json> [--out <path>]      -> <out>/specs/*.json (the 5 Specs)
//   ion preview <definition.json> [--out <path>]      -> specs + <out>/generated/<extension>/ for every official extension
//   ion publish <definition.json> [--out <path>]      -> <out>/<app-id>.ion (Spec Bundle)
//   ion deploy  <file.ion> <target-dir> [--force] -> <target-dir>/<app-id>.uapp/ (generated app + manifest.json)
// Optional on preview/publish/deploy: --generators a,b,c  (section 42: the user chooses; default = every official extension;
// on deploy it overrides the choice recorded in the .ion)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildApp } from './build.ts';
import { bundleFileName, bundleText, createBundle } from './bundle.ts';
import { runGenerators } from './generator.ts';
import { humanize } from './naming.ts';
import { APP_ID } from './app-info.ts';
import { MANIFEST_FILE, buildUapp } from './uapp.ts';
import { IonValidationError, validateDefinition } from './validate.ts';

const EXTENSIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '02-extensions');
// Metadata processors (extension): keys such as `commentable` or `payable` expand into plain entities / relationships
// before Core runs. Unknown keys are untouched, so Core still rejects them (UNKNOWN_METADATA).
const expand = async (def: unknown, quiet = false): Promise<unknown> => {
  const dir = join(EXTENSIONS, 'processors');
  const { expandDefinition, loadProcessors } = await import(pathToFileURL(join(dir, 'expand.ts')).href); // loaded like a generator: Core never imports an extension
  const { definition, applied } = expandDefinition(def, loadProcessors(dir));
  if (!quiet) for (const a of applied) console.log(`processor ${a.processor} on ${a.entity}: +${a.added.join(', +')}`);
  return definition;
};
const COMMANDS = ['init', 'add', 'build', 'preview', 'publish', 'deploy'];
const KINDS: Record<string, 'entities' | 'relationships' | 'events'> = { entity: 'entities', relation: 'relationships', relationship: 'relationships', event: 'events' };

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--force') continue; if (argv[i].startsWith('--')) { i++; continue; } positional.push(argv[i]); }
const [command, ...args] = positional;
const outDir = flag('--out') ?? 'out';
const chosen = flag('--generators')?.split(',').map((x) => x.trim()).filter(Boolean);

function write(root: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
const readJson = (path: string): any => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new IonValidationError([{ code: 'INVALID_JSON', path, message: (e as Error).message }]); }
};
const fail = (msg: string, code = 2): never => { console.error(msg); process.exit(code); };

// A build lists every official extension in uapp_spec.generators_used (what deploy will run by default).
function officialIds(): string[] {
  const registry = readJson(join(EXTENSIONS, 'registry.json')) as { generators: Array<{ id: string; official: boolean }> };
  return registry.generators.filter((g) => g.official).map((g) => g.id);
}

async function main(): Promise<void> {
  if (!command || !COMMANDS.includes(command)) fail('Usage: ion <init|add|build|preview|publish|deploy> ...');

  if (command === 'init') {
    const name = args[0];
    if (!name || !APP_ID.test(name)) fail('Usage: ion init <name>   (name: lower-case letters, digits and "-")');
    const file = join(name, 'ion.json');
    if (existsSync(file)) fail(`${file} already exists`, 1);
    mkdirSync(name, { recursive: true });
    writeFileSync(file, JSON.stringify({ app: { id: name, name: humanize(name.replace(/-/g, '_')), domain: 'general' }, entities: [], relationships: [], events: [] }, null, 2) + '\n');
    console.log(`created ${file}`);
    return;
  }

  if (command === 'add') {
    const [kind, defFile] = args;
    const id = flag('--id');
    const list = KINDS[kind ?? ''];
    if (!list || !defFile || !id) fail('Usage: ion add <entity|relation|event> <def.json> --id <id> [--to <project.json>]');
    const projectFile = flag('--to') ?? 'ion.json';
    if (!existsSync(projectFile)) fail(`${projectFile} not found (run "ion init <name>" or pass --to)`, 1);
    const project = readJson(projectFile);
    const item = readJson(defFile);
    if (typeof item !== 'object' || item === null || Array.isArray(item)) fail(`${defFile} must hold one JSON object`, 1);
    item.id = id;
    if (kind === 'event' && item.name === undefined) item.name = id;
    project[list] = [...(project[list] ?? [])];
    if (project[list].some((x: any) => x.id === id)) fail(`${kind} "${id}" already exists in ${projectFile} (nothing is replaced)`, 1);
    project[list].push(item);
    const issues = validateDefinition(await expand(project, true));
    if (issues.length) throw new IonValidationError(issues);
    writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n');
    console.log(`added ${kind} "${id}" to ${projectFile}`);
    return;
  }

  if (command === 'deploy') {
    const [bundleFile, target] = args;
    if (!bundleFile || !target) fail('Usage: ion deploy <file.ion> <target-dir> [--force]');
    const uapp = await buildUapp(readFileSync(bundleFile, 'utf8'), EXTENSIONS, chosen);
    const dir = join(target, uapp.dir);
    if (existsSync(dir) && readdirSync(dir).length) {
      if (!argv.includes('--force')) fail(`${dir} already exists (use --force to replace it)`, 1);
      if (!existsSync(join(dir, MANIFEST_FILE))) fail(`${dir} does not look like a .uapp (no ${MANIFEST_FILE}); refusing to delete it`, 1);
      rmSync(dir, { recursive: true });
    }
    write(dir, uapp.files);
    console.log(`${uapp.dir}: ${Object.keys(uapp.files).length} files -> ${dir}/`);
    for (const e of uapp.manifest.uapp.entries) console.log(`  ${e.path}/  (${e.generator} ${e.version}, ${e.files.length} files)`);
    return;
  }

  // build / preview / publish
  const input = args[0];
  if (!input) fail(`Usage: ion ${command} <definition.json> [--out <path>]`);
  const built = buildApp(await expand(readJson(input)), chosen ?? officialIds());

  if (command === 'publish') {
    const bundle = createBundle(built);
    write(outDir, { [bundleFileName(bundle)]: bundleText(bundle) });
    console.log(`${bundleFileName(bundle)} (${bundle.ion_bundle.manifest_hash}) -> ${outDir}/`);
    return;
  }

  write(join(outDir, 'specs'), built.files);
  console.log(`specs: ${Object.keys(built.files).join(', ')} -> ${join(outDir, 'specs')}/`);
  if (command === 'preview') {
    for (const run of await runGenerators(built.specs, EXTENSIONS, chosen)) {
      write(join(outDir, 'generated', run.id), run.files);
      console.log(`generated/${run.id} (${run.version}): ${Object.keys(run.files).length} files`);
    }
  }
}

main().catch((err) => {
  if (err instanceof IonValidationError) { console.error(err.message); process.exit(1); }
  throw err;
});
