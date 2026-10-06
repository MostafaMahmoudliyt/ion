// Database Generator: PostgreSQL (constitution section 48). An Extension, not Core.
// Deterministic: the same specs always produce the same SQL (section 54).
import { createHash } from 'node:crypto';

type Obj = Record<string, any>; // validated spec JSON

const SQL_TYPES: Record<string, string> = {
  string: 'TEXT', number: 'NUMERIC', integer: 'INTEGER', money: 'BIGINT', boolean: 'BOOLEAN', date: 'DATE', timestamp: 'TIMESTAMP',
  uuid: 'UUID', email: 'TEXT', url: 'TEXT', phone: 'TEXT', json: 'JSONB', array: 'JSONB', enum: 'TEXT',
};

const quote = (s: string): string => "'" + s.replace(/'/g, "''") + "'";

// PostgreSQL truncates identifiers at 63 bytes; keep long names unique and stable.
export function limitIdent(name: string): string {
  if (name.length <= 63) return name;
  return name.slice(0, 54) + '_' + createHash('sha1').update(name).digest('hex').slice(0, 8);
}

function defaultSql(c: Obj): string | undefined {
  if (c.auto) {
    if (c.type === 'timestamp') return 'NOW()';
    if (c.type === 'date') return 'CURRENT_DATE';
    if (c.type === 'uuid') return 'gen_random_uuid()';
  }
  if (c.default === undefined) return undefined;
  if (typeof c.default === 'number') return String(c.default);
  if (typeof c.default === 'boolean') return c.default ? 'TRUE' : 'FALSE';
  return quote(String(c.default));
}

function checkSql(c: Obj, name: string): string | undefined {
  switch (c.type) {
    case 'email': return `CHECK (${name} ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')`;
    case 'url': return `CHECK (${name} ~* '^https?://')`;
    case 'enum': return `CHECK (${name} IN (${(c.values ?? []).map(quote).join(', ')}))`;
    default: return undefined;
  }
}

// One column definition from a spec column.
export function columnSql(c: Obj, name: string = c.name): string {
  const parts = [name, SQL_TYPES[c.type]];
  if (c.primary) parts.push('PRIMARY KEY');
  else if (!c.nullable) parts.push('NOT NULL');
  if (c.unique) parts.push('UNIQUE');
  const d = defaultSql(c);
  if (d !== undefined) parts.push('DEFAULT ' + d);
  const check = checkSql(c, name);
  if (check) parts.push(check);
  return parts.join(' ');
}

function schemaSql(schema: Obj): string {
  const blocks = schema.schema_spec.tables.map((t: Obj) => {
    const lines = t.columns.map((c: Obj) => '  ' + columnSql(c));
    return `CREATE TABLE ${t.table} (\n${lines.join(',\n')}\n);` + (t.security?.row_level ? `\nALTER TABLE ${t.table} ENABLE ROW LEVEL SECURITY;` : '');
  });
  return '-- Ion sql-postgres. Deterministic: same specs => same output.\n\n' + blocks.join('\n\n') + '\n';
}

function relationshipsSql(rel: Obj): string {
  const blocks = rel.relationship_spec.relationships.map((r: Obj) => {
    const lines: string[] = [`-- relationship: ${r.id} (${r.type}) ${r.from} -> ${r.to}`];
    if (r.junction) {
      const j = r.junction;
      const cols = [
        'id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
        ...j.columns.map((c: Obj) => { const [t, col] = c.references.split('.'); return `${c.name} UUID NOT NULL REFERENCES ${t} (${col})`; }),
        ...j.attributes.map((a: Obj) => columnSql(a)),
        'created_at TIMESTAMP NOT NULL DEFAULT NOW()',
        'archived_at TIMESTAMP',
      ];
      lines.push(`CREATE TABLE ${j.table} (\n${cols.map((c) => '  ' + c).join(',\n')}\n);`);
      for (const u of j.unique) lines.push(`CREATE UNIQUE INDEX ${limitIdent(`uq_${j.table}_${u.join('_')}`)} ON ${j.table} (${u.join(', ')})${j.active_only ? ' WHERE archived_at IS NULL' : ''};`);
      for (const i of j.indexes) lines.push(`CREATE INDEX ${limitIdent(`idx_${j.table}_${i.join('_')}`)} ON ${j.table} (${i.join(', ')});`);
      lines.push(`ALTER TABLE ${j.table} ENABLE ROW LEVEL SECURITY;`);
    } else {
      const fk = r.foreign_key;
      const [target, targetCol] = fk.references.split('.');
      if (fk.create_column) lines.push(`ALTER TABLE ${fk.table} ADD COLUMN ${fk.column} UUID;`);
      lines.push(`ALTER TABLE ${fk.table} ADD CONSTRAINT ${limitIdent(`fk_${fk.table}_${fk.column}`)} FOREIGN KEY (${fk.column}) REFERENCES ${target} (${targetCol});`);
      if (fk.unique) lines.push(`CREATE UNIQUE INDEX ${limitIdent(`uq_${fk.table}_${fk.column}`)} ON ${fk.table} (${fk.column}) WHERE archived_at IS NULL;`);
      else if (fk.index) lines.push(`CREATE INDEX ${limitIdent(`idx_${fk.table}_${fk.column}`)} ON ${fk.table} (${fk.column});`);
      for (const a of fk.attributes) lines.push(`ALTER TABLE ${fk.table} ADD COLUMN ${columnSql(a.attribute, a.column)};`);
    }
    return lines.join('\n');
  });
  return '-- Ion sql-postgres. Deterministic: same specs => same output.\n-- Run after 0001_schema.sql.\n\n' + blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

// System records of the event_spec. Names are shared with events-node-postgres (documented in its README).
const RECORD_TABLES: Record<string, string> = { ledger: 'ion_event_log', audit: 'ion_audit_log', notifications: 'ion_notifications' };
const RECORD_INDEXES: Record<string, string[]> = {
  ledger: ['CREATE INDEX idx_ion_event_log_actor ON ion_event_log (actor_id);', 'CREATE INDEX idx_ion_event_log_target ON ion_event_log (target_id);', 'CREATE INDEX idx_ion_event_log_event ON ion_event_log (event_id);'],
  audit: ['CREATE INDEX idx_ion_audit_log_event ON ion_audit_log (event_id);'],
  notifications: ['CREATE INDEX idx_ion_notifications_recipient ON ion_notifications (recipient_entity, recipient_id) WHERE archived_at IS NULL;'],
};

function eventsSql(ev: Obj): string {
  const records = ev.event_spec.system_records;
  const out = [
    '-- Ion sql-postgres. Deterministic: same specs => same output.',
    '-- Run after 0002_relationships.sql.',
    '',
    'CREATE FUNCTION ion_forbid_mutation() RETURNS trigger AS $$',
    'BEGIN',
    "  RAISE EXCEPTION 'ion: % is append-only (nothing is deleted)', TG_TABLE_NAME;",
    'END;',
    '$$ LANGUAGE plpgsql;',
  ];
  for (const key of ['ledger', 'audit', 'notifications']) {
    const rec = records[key];
    const table = RECORD_TABLES[key];
    const cols = ['id UUID PRIMARY KEY DEFAULT gen_random_uuid()', ...rec.fields.map((f: Obj) => columnSql({ ...f, auto: f.name === 'created_at' ? true : undefined }))];
    out.push('', `CREATE TABLE ${table} (\n${cols.map((c: string) => '  ' + c).join(',\n')}\n);`, ...RECORD_INDEXES[key], `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    if (rec.append_only) out.push(`CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ion_forbid_mutation();`);
  }
  return out.join('\n') + '\n';
}

export function generate(specs: Obj): Record<string, string> {
  const files: Record<string, string> = {
    '0001_schema.sql': schemaSql(specs.schema_spec),
    '0002_relationships.sql': relationshipsSql(specs.relationship_spec),
  };
  if (specs.event_spec.event_spec.events.length) files['0003_events.sql'] = eventsSql(specs.event_spec);
  return files;
}
