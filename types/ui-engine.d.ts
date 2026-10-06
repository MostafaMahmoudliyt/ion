import type { EventSpec, RelationshipSpec, SchemaSpec, UiSpec } from './specs.ts';
export declare function generateUiSpec(input: unknown, schema: SchemaSpec, relationships: RelationshipSpec, events: EventSpec): UiSpec;
