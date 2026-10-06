import type { Issue } from './validate.ts';
import type { SpecSet } from './specs.ts';
export declare const SPEC_FILES: {
    readonly schema_spec: "schema_spec.json";
    readonly relationship_spec: "relationship_spec.json";
    readonly event_spec: "event_spec.json";
    readonly ui_spec: "ui_spec.json";
};
export declare function loadSpecs(files: Record<string, string>): {
    specs?: SpecSet;
    issues: Issue[];
};
export declare function validateSpecs(set: SpecSet): Issue[];
