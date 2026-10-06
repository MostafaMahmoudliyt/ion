import type { AttributeType } from './constitution.ts';
export interface SpecColumn {
    name: string;
    type: AttributeType;
    nullable: boolean;
    primary?: true;
    auto?: true;
    unique?: true;
    default?: string | number | boolean;
    values?: string[];
    scale?: number;
    system?: true;
    transitions?: Record<string, string[]>;
}
export interface SchemaTable {
    entity: string;
    name: string;
    type: string;
    table: string;
    columns: SpecColumn[];
    indexes: Array<{
        columns: string[];
        unique?: true;
    }>;
    constraints: unknown[];
    security: {
        row_level: true;
    };
    archivable: true;
    versioned?: true;
}
export interface SchemaSpec {
    schema_spec: {
        tables: SchemaTable[];
    };
}
export interface SpecApi {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    operation: 'create' | 'read' | 'update' | 'delete';
    summary: string;
}
export interface RelationshipItem {
    id: string;
    from: string;
    to: string;
    type: string;
    cascade?: 'restrict' | 'archive';
    storage: {
        table: string;
        columns: string[];
    };
    junction?: {
        table: string;
        columns: Array<{
            name: string;
            references: string;
        }>;
        attributes: SpecColumn[];
        unique: string[][];
        indexes: string[][];
        active_only: true;
    };
    foreign_key?: {
        table: string;
        column: string;
        references: string;
        create_column: boolean;
        unique: boolean;
        index: boolean;
        attributes: Array<{
            column: string;
            attribute: SpecColumn;
        }>;
    };
    apis: SpecApi[];
}
export interface RelationshipSpec {
    relationship_spec: {
        relationships: RelationshipItem[];
    };
}
export type Row = 'actor' | 'target';
export type SpecValue = string | number | boolean | null | unknown[] | {
    [k: string]: unknown;
} | {
    from: Row;
};
export type SpecTrigger = {
    action: 'send_notification';
    to: string;
    row: Row;
    message: string;
    channel?: string;
    template?: string;
} | {
    action: 'send_email';
    to: string;
    row: Row;
    attribute: string;
    subject: string;
    body: string;
} | {
    action: 'increment' | 'decrement';
    entity: string;
    attribute: string;
    field: string;
    row: Row;
    by: number;
} | {
    action: 'update_field';
    entity: string;
    attribute: string;
    field: string;
    row: Row;
    value: SpecValue;
} | {
    action: 'create_entity';
    entity: string;
    values: Record<string, SpecValue>;
} | {
    action: 'delete_entity';
    entity: string;
    row: Row;
} | {
    action: 'log';
    to: 'audit';
    level?: string;
} | {
    action: 'call_webhook';
    url: string;
} | {
    action: 'trigger_workflow';
    workflow: string;
};
export interface EventItem {
    id: string;
    name: string;
    type: string;
    actor: string;
    target: string;
    relationship?: string;
    triggers: SpecTrigger[];
    rate?: {
        max: number;
        per_seconds: number;
    };
    compensations: unknown[];
}
export interface SystemRecord {
    fields: Array<{
        name: string;
        type: AttributeType;
        nullable: boolean;
    }>;
    append_only: boolean;
}
export interface EventSpec {
    event_spec: {
        events: EventItem[];
        system_records?: {
            ledger: SystemRecord;
            audit: SystemRecord;
            notifications: SystemRecord;
        };
    };
}
export interface UiField {
    name: string;
    type: AttributeType;
    widget: string;
    required: boolean;
    auto: boolean;
    labels: {
        en: string;
        ar?: string;
    };
    values?: string[];
    scale?: number;
    target?: string;
    relationship?: string;
    label_entity?: string;
    system?: true;
}
export interface UiRelation {
    relationship: string;
    side: 'from' | 'to';
    other: string;
    type: string;
    many: boolean;
    title: {
        entity?: string;
        text?: string;
        reverse?: boolean;
        suffix?: string;
    };
    attributes: UiField[];
    paths: {
        list: string;
        create: string;
        update: string;
        delete: string;
    };
}
export interface UiDataSource {
    id: string;
    entity: string;
    labels: {
        en: {
            singular: string;
            plural: string;
        };
        ar?: {
            singular: string;
            plural: string;
        };
    };
    display: string | null;
    fields: UiField[];
    relations: UiRelation[];
    filters: Array<{
        field: string;
        kind: 'select' | 'boolean' | 'range';
        type?: string;
        values?: string[];
    }>;
    search_fields: string[];
    surfaces: {
        notifications: boolean;
        activity: boolean;
    };
    api: Record<'list' | 'create' | 'read' | 'update' | 'archive' | 'notifications' | 'activity', {
        method: string;
        path: string;
    } | undefined>;
}
export interface UiPage {
    id: string;
    title: string;
    labels: {
        en: string;
        ar?: string;
    };
    type: 'list' | 'detail' | 'form';
    mode?: 'create' | 'edit';
    data_source: string;
    path: string;
    columns?: string[];
    layout?: 'table';
    actions?: string[];
    pagination?: {
        size: number;
    };
    search?: boolean;
    filters?: string[];
    fields?: string[];
    submit_action?: string;
    permission: string;
    sort?: {
        field: string;
        direction: 'asc' | 'desc';
    };
    page_sizes?: number[];
    confirm?: string[];
    states?: Record<'empty' | 'loading' | 'error', {
        labels: {
            en: string;
            ar?: string;
        };
    }>;
    responsive?: {
        compact: 'cards' | 'table';
        regular: 'cards' | 'table';
    };
    breadcrumb?: string[];
}
export interface UiSpec {
    ui_spec: {
        locales: string[];
        default_locale: string;
        pages: UiPage[];
        data_sources: UiDataSource[];
        events: Array<{
            id: string;
            labels: {
                en: string;
                ar?: string;
            };
            type: string;
        }>;
        navigation: {
            type: 'sidebar';
            items: string[];
        };
        dashboard: {
            path: string;
            widgets: Array<{
                kind: 'count';
                data_source: string;
                permission: string;
                labels: {
                    en: string;
                    ar?: string;
                };
            }>;
        };
        directions: Record<string, 'rtl' | 'ltr'>;
        theme: {
            primary_color: string;
            density: string;
        };
        permissions: string[];
    };
}
export interface SpecSet {
    schema_spec: SchemaSpec;
    relationship_spec: RelationshipSpec;
    event_spec: EventSpec;
    ui_spec: UiSpec;
}
