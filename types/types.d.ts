import type { AttributeType, EventAction, EventType } from './constitution.ts';
export interface Attribute {
    name: string;
    type: AttributeType;
    required?: boolean;
    unique?: boolean;
    default?: string | number | boolean;
    auto?: boolean;
    values?: string[];
    scale?: number;
    metadata?: {
        transitions?: Record<string, string[]>;
    };
}
export interface Entity {
    id: string;
    name: string;
    type: string;
    attributes: Attribute[];
    metadata?: Record<string, unknown>;
}
export interface Relationship {
    id: string;
    from: string;
    to: string;
    type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many' | 'self';
    attributes?: Attribute[];
    metadata?: Record<string, unknown>;
}
export interface Trigger {
    action: EventAction;
    to?: string;
    on?: 'actor' | 'target';
    field?: string;
    by?: number;
    value?: unknown;
    entity?: string;
    values?: Record<string, unknown>;
    message?: string;
    channel?: string;
    template?: string;
    level?: string;
    subject?: string;
    body?: string;
    url?: string;
    workflow?: string;
}
export interface IonEvent {
    id: string;
    name: string;
    actor: string;
    target: string;
    triggers: Trigger[];
    type?: EventType;
    relationship?: string;
    metadata?: Record<string, unknown>;
}
export interface IonDefinition {
    app?: {
        id?: string;
        name?: string;
        domain?: string;
    };
    entities: Entity[];
    relationships?: Relationship[];
    events?: IonEvent[];
}
