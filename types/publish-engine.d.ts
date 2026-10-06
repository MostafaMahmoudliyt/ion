import type { SpecSet } from './specs.ts';
import type { Issue } from './validate.ts';
import { APP_ID, validateApp } from './app-info.ts';
export { APP_ID, validateApp };
export declare const UAPP_SPEC_FILE = "uapp_spec.json";
export interface AppInfo {
    id: string;
    name: string;
    domain: string;
}
export interface UappSpec {
    uapp_spec: {
        ion_version: string;
        app: AppInfo;
        genome: {
            locale: string;
            direction: 'rtl' | 'ltr';
            theme: {
                primary_color: string;
            };
        };
        specs: Record<'schema' | 'relationship' | 'event' | 'ui', string>;
        manifest_hash: string;
        generators_used: string[];
    };
}
export declare const specJson: (v: unknown) => string;
export declare function manifestHash(files: Record<string, string>): string;
export declare function specFiles(specs: SpecSet): Record<string, string>;
export declare function generateUappSpec(definition: unknown, specs: SpecSet, generatorsUsed?: string[]): UappSpec;
export declare function validateUappSpec(uapp: unknown, files: Record<string, string>): Issue[];
