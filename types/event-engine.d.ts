import type { EventSpec, RelationshipSpec, SchemaSpec } from './specs.ts';
export declare const SYSTEM_RECORDS: {
    readonly ledger: {
        readonly fields: readonly [{
            readonly name: "event_id";
            readonly type: "string";
            readonly nullable: false;
        }, {
            readonly name: "actor_id";
            readonly type: "uuid";
            readonly nullable: false;
        }, {
            readonly name: "target_id";
            readonly type: "uuid";
            readonly nullable: false;
        }, {
            readonly name: "created_at";
            readonly type: "timestamp";
            readonly nullable: false;
        }];
        readonly append_only: true;
    };
    readonly audit: {
        readonly fields: readonly [{
            readonly name: "event_id";
            readonly type: "string";
            readonly nullable: false;
        }, {
            readonly name: "actor_id";
            readonly type: "uuid";
            readonly nullable: false;
        }, {
            readonly name: "target_id";
            readonly type: "uuid";
            readonly nullable: false;
        }, {
            readonly name: "created_at";
            readonly type: "timestamp";
            readonly nullable: false;
        }];
        readonly append_only: true;
    };
    readonly notifications: {
        readonly fields: readonly [{
            readonly name: "event_id";
            readonly type: "string";
            readonly nullable: false;
        }, {
            readonly name: "recipient_entity";
            readonly type: "string";
            readonly nullable: false;
        }, {
            readonly name: "recipient_id";
            readonly type: "uuid";
            readonly nullable: false;
        }, {
            readonly name: "message";
            readonly type: "string";
            readonly nullable: false;
        }, {
            readonly name: "read_at";
            readonly type: "timestamp";
            readonly nullable: true;
        }, {
            readonly name: "created_at";
            readonly type: "timestamp";
            readonly nullable: false;
        }, {
            readonly name: "archived_at";
            readonly type: "timestamp";
            readonly nullable: true;
        }];
        readonly append_only: false;
    };
};
export declare function generateEventSpec(input: unknown, schema: SchemaSpec, relationships: RelationshipSpec): EventSpec;
