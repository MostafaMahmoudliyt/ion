// Constitutional constants (Ion Sovereign Constitution v3.0.0, sections 18-22, 114).
// These lists are closed: changing them requires an amendment approved by the vision owner (section 112).

export const ION_VERSION = '3.1.0'; // 3.1.0: metadata (additive, section 123). Major stays 3.

export const ENTITY_TYPES = [
  'person', 'organization', 'place', 'thing', 'event', 'document', 'transaction',
  'resource', 'group', 'role', 'process', 'product', 'service', 'course',
  'message', 'notification', 'review', 'category', 'tag', 'custom',
] as const; // section 18: 20 types

export const RELATIONSHIP_TYPES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many', 'self'] as const; // section 19

export const EVENT_TYPES = ['create', 'update', 'delete', 'custom'] as const; // section 20

export const EVENT_ACTIONS = [
  'send_notification', 'increment', 'decrement', 'log', 'update_field',
  'create_entity', 'delete_entity', 'trigger_workflow', 'send_email', 'call_webhook',
] as const; // section 21: 10 actions

export const ATTRIBUTE_TYPES = [
  'string', 'number', 'integer', 'boolean', 'date', 'timestamp', 'uuid',
  'email', 'url', 'phone', 'json', 'array', 'enum', 'money',
] as const; // section 22: 14 attribute types (money added by amendment: whole minor units, never a float)

export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];
export type EventAction = (typeof EVENT_ACTIONS)[number];
export type EventType = (typeof EVENT_TYPES)[number];

// Every table/collection the Schema Engine describes owns these columns (archive, never delete).
export const RESERVED_COLUMNS = ['id', 'created_at', 'archived_at'] as const;

// Locales every ui_spec declares (UI Engine rule: ar/en by default).
export const LOCALES = ['ar', 'en'] as const;

// Ids starting with this prefix belong to the system records the Event Engine declares.
export const RESERVED_PREFIX = 'ion_';

// Default theme (section 34 example). The only values the UI Engine invents.
export const DEFAULT_THEME = { primary_color: '#1E3A8A', density: 'medium' } as const;

// Attribute type -> UI widget (UI rule U3). Closed list, one entry per attribute type.
export const WIDGETS: Record<string, string> = {
  string: 'text', number: 'number', integer: 'integer', boolean: 'checkbox', date: 'date', timestamp: 'datetime',
  uuid: 'text', email: 'email', url: 'url', phone: 'tel', json: 'json', array: 'json', enum: 'select', money: 'money',
};

// Section 17: 45 rules, split 10 / 5 / 10 / 20 / 0. The rules themselves live in rules.ts; a test pins these counts.
export const RULE_COUNTS = { schema: 10, relationship: 5, event: 10, ui: 20, publish: 0 } as const;
export const RULE_TOTAL = 45;

// Metadata (additive, 3.1.0): properties on the three primitives, never a fourth primitive and never a sixth engine.
// The vocabulary is CLOSED: every key listed here is understood by the engines and executed by the server runtime;
// anything else is rejected (UNKNOWN_METADATA) instead of being silently ignored.
export const ENTITY_METADATA = ['i18n', 'versioned', 'indexed'] as const; // versioned: optimistic locking; indexed: attribute names
export const ATTRIBUTE_METADATA = ['transitions'] as const; // enum attributes only: { from: [allowed next values] }
export const RELATIONSHIP_METADATA = ['cascade'] as const;
export const EVENT_METADATA = ['i18n', 'rate'] as const; // rate: { max, per_seconds }
export const CASCADE_MODES = ['none', 'restrict', 'archive'] as const;
