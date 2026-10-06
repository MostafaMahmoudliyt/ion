import type { AttributeType, EventAction, EventType } from './constitution.ts';

export interface Attribute {
  name: string;
  type: AttributeType;
  required?: boolean;
  unique?: boolean;
  default?: string | number | boolean;
  auto?: boolean;
  values?: string[]; // enum only
  scale?: number; // money only: decimal places of the major unit (0-4, default 2); the stored value is whole minor units
  metadata?: { transitions?: Record<string, string[]> }; // enum only: allowed state changes
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
  from: string; // entity id (or unique entity name)
  to: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many' | 'self';
  attributes?: Attribute[];
  metadata?: Record<string, unknown>;
}

// A trigger is pure data (law 15). Which fields apply depends on `action`.
export interface Trigger {
  action: EventAction;
  to?: string; // send_notification / send_email: entity that receives it; log: "audit"
  on?: 'actor' | 'target'; // which side of the event addresses the row, when the entity alone is ambiguous
  field?: string; // increment / decrement / update_field: "Entity.attribute" (send_email: optional email attribute)
  by?: number; // increment / decrement amount (default 1)
  value?: unknown; // update_field
  entity?: string; // create_entity / delete_entity
  values?: Record<string, unknown>; // create_entity
  message?: string; // send_notification
  channel?: string; // send_notification (section 33 example), free identifier
  template?: string; // send_notification (section 33 example), free identifier
  level?: string; // log (section 33 example), free identifier
  subject?: string; // send_email
  body?: string; // send_email
  url?: string; // call_webhook
  workflow?: string; // trigger_workflow: id of another declared event
}

export interface IonEvent {
  id: string; // dotted, e.g. "student.enrolled"
  name: string;
  actor: string; // entity id (or unique entity name)
  target: string;
  triggers: Trigger[];
  type?: EventType; // law 6, default "custom"
  relationship?: string; // relationship whose create/update/delete emits this event (section 25)
  metadata?: Record<string, unknown>;
}

export interface IonDefinition {
  app?: { id?: string; name?: string; domain?: string }; // read by the Publish Engine only
  entities: Entity[];
  relationships?: Relationship[];
  events?: IonEvent[];
}
