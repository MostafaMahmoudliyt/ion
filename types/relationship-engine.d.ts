import type { Entity, Relationship } from './types.ts';
import type { RelationshipSpec } from './specs.ts';
export type Placement = {
    kind: 'junction';
    table: string;
    fromCol: string;
    toCol: string;
} | {
    kind: 'fk';
    holder: Entity;
    target: Entity;
    column: string;
};
export declare function placeRelationship(rel: Relationship, from: Entity, to: Entity): Placement;
export declare function generateRelationshipSpec(input: unknown): RelationshipSpec;
