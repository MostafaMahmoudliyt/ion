import type { UappSpec } from './publish-engine.ts';
import type { SpecSet } from './specs.ts';
export interface BuildOutput {
    specs: SpecSet;
    files: Record<string, string>;
    sha256: Record<string, string>;
}
export declare function buildSpecs(definition: unknown): BuildOutput;
export interface AppBuild extends BuildOutput {
    uapp_spec: UappSpec;
}
export declare function buildApp(definition: unknown, generatorsUsed?: string[]): AppBuild;
