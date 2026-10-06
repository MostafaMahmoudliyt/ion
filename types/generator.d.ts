import type { SpecSet } from './specs.ts';
import type { Issue } from './validate.ts';
export declare const GENERATOR_KINDS: readonly ["database", "api", "ui", "cloud", "utility"];
export declare const SPEC_NAMES: readonly ["schema", "relationship", "event", "ui"];
export interface GeneratorManifest {
    id: string;
    kind: (typeof GENERATOR_KINDS)[number];
    version: string;
    official: boolean;
    entry: string;
    reads: Array<(typeof SPEC_NAMES)[number]>;
    ion: string;
    description: string;
    target?: string;
}
export type GenerateFn = (specs: SpecSet) => Record<string, string>;
export interface RegistryEntry {
    id: string;
    path: string;
    version: string;
    official: boolean;
}
export declare function validateManifest(m: unknown, entry?: RegistryEntry): Issue[];
export declare function safeRelativePath(p: string): boolean;
export interface GeneratorRun {
    id: string;
    version: string;
    kind: GeneratorManifest['kind'];
    target: string;
    files: Record<string, string>;
}
export declare function runGenerators(specs: SpecSet, extensionsDir: string, ids?: string[]): Promise<GeneratorRun[]>;
