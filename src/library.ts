// Library API (constitution section 24): three methods, one object.
//   const ion = new Ion();
//   ion.define('entity', 'Student', {...});  ion.define('relationship', 'enrollment', {...});  ion.define('event', 'student.enrolled', {...});
//   const uapp_spec = await ion.build();     await ion.publish(uapp_spec);
// Pure data in, pure data out: publish() returns the .ion file (name + text); writing it is the caller's job.

import { buildApp } from './build.ts';
import type { AppBuild } from './build.ts';
import { bundleFileName, bundleText, createBundle } from './bundle.ts';
import { snake } from './naming.ts';
import type { UappSpec } from './publish-engine.ts';
import type { AppInfo } from './publish-engine.ts';
import { IonValidationError } from './validate.ts';

export type DefineKind = 'entity' | 'relationship' | 'event';
export interface IonOptions { app?: Partial<AppInfo>; generators?: string[] }

export class Ion {
  #app: Partial<AppInfo> | undefined;
  #generators: string[];
  #lists: Record<'entities' | 'relationships' | 'events', Record<string, unknown>[]> = { entities: [], relationships: [], events: [] };
  #last: AppBuild | undefined;

  constructor(options: IonOptions = {}) {
    this.#app = options.app;
    this.#generators = options.generators ?? [];
  }

  // Method 1: declare an entity, a relationship or an event. Same id twice = error (nothing is silently replaced).
  define(kind: DefineKind, name: string, def: Record<string, unknown>): this {
    const bad = (message: string): never => { throw new IonValidationError([{ code: 'INVALID_DEFINE', path: `define(${String(kind)}, ${String(name)})`, message }]); };
    if (typeof name !== 'string' || name.trim() === '') bad('name must be a non-empty string');
    if (typeof def !== 'object' || def === null || Array.isArray(def)) bad('the definition must be an object');
    const list = kind === 'entity' ? this.#lists.entities : kind === 'relationship' ? this.#lists.relationships : kind === 'event' ? this.#lists.events : bad('kind must be entity, relationship or event');
    const item: Record<string, unknown> =
      kind === 'entity' ? { id: snake(name), name, type: 'custom', ...def }
      : kind === 'event' ? { id: name, name, ...def }
      : { id: name, ...def };
    if (list.some((x) => x.id === item.id)) bad(`${kind} "${String(item.id)}" is already defined`);
    list.push(item);
    this.#last = undefined; // anything built before is stale now
    return this;
  }

  // Method 2: run the five engines; returns uapp_spec (section 35). Throws IonValidationError on any problem.
  async build(): Promise<UappSpec> {
    this.#last = buildApp({ app: this.#app, ...structuredClone(this.#lists) }, this.#generators);
    return structuredClone(this.#last.uapp_spec);
  }

  // Method 3: package what build() produced as a .ion Spec Bundle. The uapp_spec you pass must be the one build() returned.
  async publish(uapp_spec: UappSpec): Promise<{ file: string; content: string }> {
    if (!this.#last || this.#last.uapp_spec.uapp_spec.manifest_hash !== uapp_spec?.uapp_spec?.manifest_hash) {
      throw new IonValidationError([{ code: 'STALE_BUILD', path: 'publish', message: 'call build() after the last define() and publish the uapp_spec it returned' }]);
    }
    const bundle = createBundle(this.#last);
    return { file: bundleFileName(bundle), content: bundleText(bundle) };
  }
}
