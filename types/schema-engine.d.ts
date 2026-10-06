import type { Attribute } from './types.ts';
import type { SchemaSpec, SpecColumn } from './specs.ts';
export declare function columnSpec(a: Attribute, name?: string): SpecColumn;
export declare function generateSchemaSpec(input: unknown): SchemaSpec;
