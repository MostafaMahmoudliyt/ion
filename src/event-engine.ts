// Engine 3 — Event Engine: event -> event_spec.json (constitution sections 4, 33).
// Receives events plus the schema_spec and relationship_spec they act on (section 88: no skipping).
// Output is a fully resolved description of every trigger: which entity, which attribute, which row
// (the event's actor or target). No handlers, no SQL (section 96). Knows nothing about UI.

import { makeResolver } from './resolve.ts';
import type { Entity, Trigger, IonDefinition } from './types.ts';
import type { EventItem, EventSpec, RelationshipSpec, Row, SchemaSpec, SpecTrigger, SpecValue } from './specs.ts';
import { IonValidationError, validateDefinition } from './validate.ts';

const RECORD_FIELDS = [
  { name: 'event_id', type: 'string', nullable: false },
  { name: 'actor_id', type: 'uuid', nullable: false },
  { name: 'target_id', type: 'uuid', nullable: false },
  { name: 'created_at', type: 'timestamp', nullable: false },
] as const;

export const SYSTEM_RECORDS = {
  ledger: { fields: [...RECORD_FIELDS], append_only: true },
  audit: { fields: [...RECORD_FIELDS], append_only: true },
  notifications: {
    fields: [
      { name: 'event_id', type: 'string', nullable: false },
      { name: 'recipient_entity', type: 'string', nullable: false },
      { name: 'recipient_id', type: 'uuid', nullable: false },
      { name: 'message', type: 'string', nullable: false },
      { name: 'read_at', type: 'timestamp', nullable: true },
      { name: 'created_at', type: 'timestamp', nullable: false },
      { name: 'archived_at', type: 'timestamp', nullable: true },
    ],
    append_only: false,
  },
} as const;

export function generateEventSpec(input: unknown, schema: SchemaSpec, relationships: RelationshipSpec): EventSpec {
  const issues = validateDefinition(input);
  if (issues.length) throw new IonValidationError(issues);
  const def = input as IonDefinition;
  const resolve = makeResolver(def.entities);
  const events: EventItem[] = [];

  // Cross-check against the earlier engines' output: the tables and relationships must exist.
  const tables = new Map(schema.schema_spec.tables.map((t) => [t.entity, t]));
  const relIds = new Set(relationships.relationship_spec.relationships.map((r) => r.id));

  for (const ev of def.events ?? []) {
    const actor = resolve(ev.actor)!;
    const target = resolve(ev.target)!;
    const sideOf = (e: Entity, on?: Row): Row => on ?? (actor.id === e.id ? 'actor' : 'target');
    if (!tables.has(actor.id) || !tables.has(target.id)) throw new IonValidationError([{ code: 'SPEC_MISMATCH', path: `event "${ev.id}"`, message: 'actor/target entity is missing from schema_spec' }]);
    if (ev.relationship !== undefined && !relIds.has(ev.relationship)) throw new IonValidationError([{ code: 'SPEC_MISMATCH', path: `event "${ev.id}"`, message: `relationship "${ev.relationship}" is missing from relationship_spec` }]);

    const field = (t: Trigger): { entity: Entity; attribute: string; row: Row } => {
      const [entityRef, attribute] = String(t.field).split('.');
      const entity = resolve(entityRef)!;
      return { entity, attribute, row: sideOf(entity, t.on) };
    };

    const triggers: SpecTrigger[] = ev.triggers.map((t): SpecTrigger => {
      switch (t.action) {
        case 'send_notification': {
          const to = resolve(t.to)!;
          return { action: t.action, to: to.id, row: sideOf(to, t.on), message: t.message ?? ev.name, ...(t.channel ? { channel: t.channel } : {}), ...(t.template ? { template: t.template } : {}) };
        }
        case 'send_email': {
          const to = resolve(t.to)!;
          const attr = t.field ? String(t.field).split('.')[1] : to.attributes.find((a) => a.type === 'email')!.name;
          return { action: t.action, to: to.id, row: sideOf(to, t.on), attribute: attr, subject: t.subject!, body: t.body! };
        }
        case 'increment':
        case 'decrement': {
          const f = field(t);
          return { action: t.action, entity: f.entity.id, attribute: f.attribute, field: `${f.entity.id}.${f.attribute}`, row: f.row, by: t.by ?? 1 };
        }
        case 'update_field': {
          const f = field(t);
          return { action: t.action, entity: f.entity.id, attribute: f.attribute, field: `${f.entity.id}.${f.attribute}`, row: f.row, value: t.value as SpecValue };
        }
        case 'create_entity': {
          const entity = resolve(t.entity)!;
          // Keys follow the entity's declaration order, not the author's key order (determinism).
          const values: Record<string, SpecValue> = {};
          for (const a of entity.attributes) if (t.values && a.name in t.values) values[a.name] = t.values[a.name] as SpecValue;
          return { action: t.action, entity: entity.id, values };
        }
        case 'delete_entity': {
          const entity = resolve(t.entity)!;
          return { action: t.action, entity: entity.id, row: sideOf(entity, t.on) };
        }
        case 'log':
          return { action: t.action, to: 'audit', ...(t.level ? { level: t.level } : {}) };
        case 'call_webhook':
          return { action: t.action, url: t.url! };
        default:
          return { action: 'trigger_workflow', workflow: t.workflow! };
      }
    });

    events.push({
      id: ev.id,
      name: ev.name,
      type: ev.type ?? 'custom',
      actor: actor.id,
      target: target.id,
      ...(ev.relationship !== undefined ? { relationship: ev.relationship } : {}),
      triggers,
      ...(ev.metadata?.rate ? { rate: { ...(ev.metadata.rate as { max: number; per_seconds: number }) } } : {}),
      compensations: [],
    });
  }

  return { event_spec: { events, ...(events.length ? { system_records: structuredClone(SYSTEM_RECORDS) as never } : {}) } };
}
