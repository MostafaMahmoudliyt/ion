// Ion server: a Spec interpreter (constitution section 26). Fixed runtime, identical in every build.
// Zero dependencies: node:http, node:sqlite, node:crypto. All app-specific content is in spec.json (plain data).
// No eval, no Function, no dynamic import. One owner (or a few scoped tokens); SQLite file on disk.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1_000_000;
const MAX_DEPTH = 16;
const SQL_TYPE = { uuid: 'TEXT', string: 'TEXT', email: 'TEXT', url: 'TEXT', phone: 'TEXT', enum: 'TEXT', date: 'TEXT', timestamp: 'TEXT', json: 'TEXT', array: 'TEXT', number: 'REAL', integer: 'INTEGER', money: 'INTEGER', boolean: 'INTEGER' };
const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const bad = (m, f) => new HttpError(400, m, f);

// ---------------------------------------------------------------- model (from the specs)
export function buildModel(spec) {
  const schema = spec.schema.schema_spec, relationships = spec.relationship.relationship_spec.relationships;
  const events = spec.event.event_spec.events, ui = spec.ui.ui_spec;
  const byEntity = new Map(), byTable = new Map();
  for (const t of schema.tables) {
    const columns = t.columns.map((c) => ({ ...c }));
    const m = { entity: t.entity, table: t.table, columns, indexes: t.indexes || [], versioned: t.versioned === true, byName: null, ds: ui.data_sources.find((d) => d.id === t.table) };
    byEntity.set(t.entity, m); byTable.set(t.table, m);
  }
  const rels = new Map();
  for (const r of relationships) {
    const rel = { ...r, fromM: byEntity.get(r.from), toM: byEntity.get(r.to) };
    if (r.foreign_key) {
      const fk = r.foreign_key, holder = byTable.get(fk.table), target = fk.references.split('.')[0];
      if (fk.create_column) holder.columns.push({ name: fk.column, type: 'uuid', nullable: true });
      const c = holder.columns.find((x) => x.name === fk.column);
      c.fk = target; c.relationship = r.id;
      rel.holder = holder; rel.fkColumn = fk.column;
      rel.holderIsTo = r.type === 'one-to-many'; // R2: one-to-many keeps the key in "to"; every other type in "from"
    }
    rels.set(r.id, rel);
  }
  for (const m of byEntity.values()) m.byName = new Map(m.columns.map((c) => [c.name, c]));
  const evs = new Map(events.map((e) => [e.id, e]));
  return { schema, ui, byEntity, byTable, rels, events: evs };
}

// ---------------------------------------------------------------- values
const isoNow = () => new Date().toISOString();
function coerce(col, v) {
  if (v === null || v === undefined) {
    if (col.nullable === false) throw bad(col.name + ' is required', col.name);
    return null;
  }
  const fail = (what) => bad(col.name + ': ' + what, col.name);
  switch (col.type) {
    case 'string': if (typeof v !== 'string') throw fail('must be text'); return v;
    case 'email': if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 254) throw fail('must be an email address'); return v;
    case 'url': { let u; try { u = new URL(String(v)); } catch { throw fail('must be a URL'); } if (!/^https?:$/.test(u.protocol)) throw fail('must be an http(s) URL'); return String(v); }
    case 'phone': if (typeof v !== 'string' || !/^\+?[0-9 ()-]{5,24}$/.test(v)) throw fail('must be a phone number'); return v;
    case 'uuid': if (typeof v !== 'string' || !UUID.test(v)) throw fail('must be a UUID'); return v.toLowerCase();
    case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) throw fail('must be a number'); return v;
    case 'integer': if (!Number.isInteger(v)) throw fail('must be a whole number'); return v;
    case 'money': if (!Number.isSafeInteger(v)) throw fail('must be whole minor units (an integer: 12050 means 120.50), not a decimal'); return v;
    case 'boolean': if (typeof v !== 'boolean') throw fail('must be true or false'); return v ? 1 : 0;
    case 'date': { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw fail('must be a date (YYYY-MM-DD)'); return v; }
    case 'timestamp': { if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw fail('must be a timestamp'); return new Date(v).toISOString(); }
    case 'json': return JSON.stringify(v);
    case 'array': if (!Array.isArray(v)) throw fail('must be an array'); return JSON.stringify(v);
    case 'enum': if (typeof v !== 'string' || !(col.values || []).includes(v)) throw fail('must be one of ' + (col.values || []).join(', ')); return v;
    default: throw fail('unsupported type ' + col.type);
  }
}
function outRow(m, r) {
  if (!r) return null;
  const o = {};
  for (const c of m.columns) {
    let v = r[c.name];
    if (v === undefined) continue;
    if (v !== null) { if (c.type === 'boolean') v = !!v; else if (c.type === 'json' || c.type === 'array') v = JSON.parse(v); }
    o[c.name] = v;
  }
  return o;
}
const autoValue = (c, now) => (c.type === 'date' ? now.slice(0, 10) : now);
// metadata: enum transitions. `from` is the stored value, `to` the requested one.
function assertTransition(c, from, to) {
  if (!c.transitions || from === to) return;
  const next = c.transitions[from] || [];
  if (!next.includes(to)) throw new HttpError(409, c.name + ': cannot move from ' + from + ' to ' + to + (next.length ? ' (allowed: ' + next.join(', ') + ')' : ' (no further changes allowed)'), c.name);
}
const bump = (m) => (m.versioned ? ', version = version + 1' : '');

// ---------------------------------------------------------------- database
// Schema evolution. The database itself is the source of truth: the desired tables and indexes (from the specs) are
// compared with what PRAGMA / sqlite_master report, and the difference is a plan. Nothing is ever dropped: tables and
// columns missing from the specs are kept and reported. Additive changes (new table, new optional column, a required
// column that has a default, indexes) apply automatically in one transaction; a change that needs the table rebuilt
// (NOT NULL added or removed) needs ION_MIGRATE=apply and is preceded by a backup file; anything that could lose or
// misread data (type change, required column without a default, foreign key change) is refused with the reason.
const sqlOf = (t) => String(t).replace(/\s+/g, ' ').replace(/ IF NOT EXISTS/i, '').trim();
const colSql = (c) => q(c.name) + ' ' + c.type + (c.primary ? ' PRIMARY KEY' : '') + (c.notNull && !c.primary ? ' NOT NULL' : '') + (c.fk ? ' REFERENCES ' + q(c.fk) + '(' + q('id') + ')' : '');
const createTableSql = (t, name = t.name) => 'CREATE TABLE ' + q(name) + ' (' + t.columns.map(colSql).join(', ') + ')';
const literal = (v) => (typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : "'" + String(v).replace(/'/g, "''") + "'");

export function desiredSchema(model) {
  const tables = [], indexes = [];
  const idx = (name, table, unique, cols, where) => indexes.push({ name, table, sql: 'CREATE ' + (unique ? 'UNIQUE ' : '') + 'INDEX ' + q(name) + ' ON ' + q(table) + '(' + cols.map(q).join(', ') + ')' + (where ? ' WHERE ' + where : '') });
  for (const m of model.byEntity.values()) {
    tables.push({ name: m.table, columns: m.columns.map((c) => ({ name: c.name, type: SQL_TYPE[c.type], notNull: c.nullable === false && !c.primary, primary: !!c.primary, fk: c.fk || null, dflt: c.default })) });
    for (const c of m.columns) if (c.unique) idx('uq_' + m.table + '_' + c.name, m.table, true, [c.name], 'archived_at IS NULL');
    m.indexes.forEach((ix, i) => { if (Array.isArray(ix.columns)) idx('ix_' + m.table + '_' + i, m.table, !!ix.unique, ix.columns, ix.unique ? 'archived_at IS NULL' : null); });
  }
  for (const rel of model.rels.values()) {
    if (rel.foreign_key) {
      const fk = rel.foreign_key;
      if (fk.index) idx('fk_' + fk.table + '_' + fk.column, fk.table, false, [fk.column]);
      if (fk.unique) idx('uq_' + fk.table + '_' + fk.column, fk.table, true, [fk.column], 'archived_at IS NULL AND ' + q(fk.column) + ' IS NOT NULL');
      continue;
    }
    const j = rel.junction;
    tables.push({ name: j.table, columns: [
      ...j.columns.map((c) => ({ name: c.name, type: 'TEXT', notNull: true, primary: false, fk: c.references.split('.')[0] })),
      ...j.attributes.map((a) => ({ name: a.name, type: SQL_TYPE[a.type], notNull: a.nullable === false, primary: false, fk: null, dflt: a.default })),
      { name: 'created_at', type: 'TEXT', notNull: true, primary: false, fk: null }, { name: 'archived_at', type: 'TEXT', notNull: false, primary: false, fk: null },
    ] });
    (j.unique || []).forEach((u, i) => idx('uq_' + j.table + '_' + i, j.table, true, u, 'archived_at IS NULL'));
    (j.indexes || []).forEach((ix, i) => idx('ix_' + j.table + '_' + i, j.table, false, ix));
  }
  return { tables, indexes };
}

export function actualSchema(db) {
  const tables = new Map(), indexes = new Map();
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    const fks = new Map(db.prepare('PRAGMA foreign_key_list(' + q(name) + ')').all().map((f) => [f.from, f.table]));
    tables.set(name, db.prepare('PRAGMA table_info(' + q(name) + ')').all().map((c) => ({ name: c.name, type: String(c.type).toUpperCase(), notNull: c.notnull === 1, primary: c.pk > 0, fk: fks.get(c.name) || null })));
  }
  for (const r of db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()) indexes.set(r.name, { table: r.tbl_name, sql: sqlOf(r.sql) });
  return { tables, indexes };
}

// Pure: (desired, actual) -> { ops, blocked, kept }. Ops run in this order; blocked is never applied.
export function planMigration(desired, actual) {
  const ops = [], blocked = [], kept = [];
  const block = (code, table, column, message) => blocked.push({ code, table, column, message });
  const rebuilt = new Set();
  for (const t of desired.tables) {
    const have = actual.tables.get(t.name);
    if (!have) { ops.push({ op: 'create_table', table: t.name, sql: createTableSql(t) }); continue; }
    const byName = new Map(have.map((c) => [c.name, c]));
    for (const c of t.columns) {
      const h = byName.get(c.name);
      if (!h) {
        if (c.primary) block('PRIMARY_KEY_MISSING', t.name, c.name, 'the primary key cannot be added to an existing table');
        else if (c.notNull && c.dflt === undefined) block('REQUIRED_COLUMN_WITHOUT_DEFAULT', t.name, c.name, 'existing rows would have no value: give "' + c.name + '" a default or make it optional');
        else ops.push({ op: 'add_column', table: t.name, column: c.name, sql: 'ALTER TABLE ' + q(t.name) + ' ADD COLUMN ' + colSql(c) + (c.notNull ? ' DEFAULT ' + literal(c.dflt) : '') });
        continue;
      }
      if (h.type !== c.type) block('TYPE_CHANGE', t.name, c.name, 'type ' + h.type + ' -> ' + c.type + ' is not migrated (existing values could be misread)');
      else if ((h.fk || null) !== (c.fk || null)) block('FOREIGN_KEY_CHANGE', t.name, c.name, 'the referenced table changed (' + (h.fk || 'none') + ' -> ' + (c.fk || 'none') + ')');
      else if (!c.primary && h.notNull !== c.notNull) rebuilt.add(t.name);
    }
    const wanted = new Set(t.columns.map((c) => c.name));
    for (const h of have) {
      if (wanted.has(h.name)) continue;
      if (h.notNull && !h.primary) block('REMOVED_REQUIRED_COLUMN', t.name, h.name, '"' + h.name + '" is still NOT NULL in the database, so inserts would fail: keep it in the definition (optional) instead of removing it');
      else kept.push({ table: t.name, column: h.name });
    }
  }
  const known = new Set(desired.tables.map((t) => t.name));
  for (const name of actual.tables.keys()) if (!known.has(name) && !name.startsWith('ion_') && !name.startsWith('__ion_')) kept.push({ table: name });
  for (const name of rebuilt) ops.push({ op: 'rebuild_table', table: name });
  const want = new Map(desired.indexes.map((i) => [i.name, i]));
  for (const [name, a] of actual.indexes) {
    if (!known.has(a.table) || !/^(uq|ix|fk)_/.test(name)) continue;
    const w = want.get(name);
    if (!w || sqlOf(w.sql) !== a.sql) ops.push({ op: 'drop_index', name, table: a.table });
  }
  for (const w of desired.indexes) {
    const a = actual.indexes.get(w.name), created = !actual.tables.has(w.table);
    if (created || !a || sqlOf(w.sql) !== a.sql || rebuilt.has(w.table)) ops.push({ op: 'create_index', name: w.name, table: w.table, sql: w.sql.replace('INDEX', 'INDEX IF NOT EXISTS') });
  }
  return { ops, blocked, kept };
}

export class MigrationError extends Error {
  constructor(message, plan) { super(message); this.name = 'MigrationError'; this.plan = plan; }
}
const describe = (o) => o.op + ' ' + o.table + (o.column ? '.' + o.column : o.name ? ' (' + o.name + ')' : '');

function applyPlan(db, desired, actual, plan, file, clock) {
  const rebuilds = plan.ops.filter((o) => o.op === 'rebuild_table');
  if (file !== ':memory:') db.prepare('VACUUM INTO ?').run(file + '.pre-migration-' + clock().replace(/[^0-9A-Za-z]/g, '-') + '.bak');
  if (rebuilds.length) db.exec('PRAGMA foreign_keys = OFF'); // cannot change inside a transaction; restored below
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const o of plan.ops) {
        if (o.op === 'rebuild_table') {
          const t = desired.tables.find((x) => x.name === o.table), tmp = '__ion_new_' + o.table;
          const cols = t.columns.filter((c) => actual.tables.get(o.table).some((h) => h.name === c.name)).map((c) => q(c.name)).join(', ');
          db.exec(createTableSql(t, tmp));
          db.exec('INSERT INTO ' + q(tmp) + ' (' + cols + ') SELECT ' + cols + ' FROM ' + q(o.table));
          db.exec('DROP TABLE ' + q(o.table));
          db.exec('ALTER TABLE ' + q(tmp) + ' RENAME TO ' + q(o.table));
        } else if (o.op === 'drop_index') db.exec('DROP INDEX IF EXISTS ' + q(o.name));
        else db.exec(o.sql);
      }
      if (rebuilds.length) { const bad = db.prepare('PRAGMA foreign_key_check').all(); if (bad.length) throw new MigrationError('foreign key check failed after the rebuild (' + bad.length + ' rows); nothing was changed', plan); }
      db.prepare('INSERT INTO ion_migrations (applied_at, ops) VALUES (?, ?)').run(clock(), JSON.stringify(plan.ops.map((o) => ({ op: o.op, table: o.table, column: o.column, name: o.name }))));
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e instanceof MigrationError ? e : new MigrationError('migration failed and was rolled back, nothing was changed: ' + e.message, plan); }
  } finally { if (rebuilds.length) db.exec('PRAGMA foreign_keys = ON'); }
}

// mode: 'auto' (additive changes only) | 'apply' (also rebuilds). Returns the plan that was applied.
function openDatabase(model, file, mode = 'auto', clock = isoNow) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec([
    'CREATE TABLE IF NOT EXISTS ion_ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, actor_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS ion_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, actor_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS ion_notifications (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, recipient_entity TEXT NOT NULL, recipient_id TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL, archived_at TEXT)',
    'CREATE INDEX IF NOT EXISTS ix_notifications_recipient ON ion_notifications(recipient_entity, recipient_id)',
    'CREATE TABLE IF NOT EXISTS ion_outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT)',
    'CREATE TABLE IF NOT EXISTS ion_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, applied_at TEXT NOT NULL, ops TEXT NOT NULL)',
    ...['ion_ledger', 'ion_audit'].flatMap((t) => [ // append-only (E10): the database itself refuses edits
      'CREATE TRIGGER IF NOT EXISTS ' + t + "_no_update BEFORE UPDATE ON " + t + " BEGIN SELECT RAISE(ABORT, 'append-only'); END",
      'CREATE TRIGGER IF NOT EXISTS ' + t + "_no_delete BEFORE DELETE ON " + t + " BEGIN SELECT RAISE(ABORT, 'append-only'); END",
    ]),
  ].join(';\n') + ';');
  const desired = desiredSchema(model), actual = actualSchema(db);
  const plan = planMigration(desired, actual);
  const fresh = !desired.tables.some((t) => actual.tables.has(t.name));
  const fail = (why) => { db.close(); throw new MigrationError(why + '\n' + plan.ops.map((o) => '  ' + describe(o)).join('\n'), plan); };
  if (plan.blocked.length) fail('the definition cannot be migrated onto this database:\n' + plan.blocked.map((b) => '  [' + b.code + '] ' + b.table + (b.column ? '.' + b.column : '') + ': ' + b.message).join('\n') + '\nnothing was changed.');
  if (!fresh && mode !== 'apply' && plan.ops.some((o) => o.op === 'rebuild_table')) fail('this change rebuilds a table (a column became required or optional). A backup is written first. Start once with ION_MIGRATE=apply to run it; planned:');
  if (plan.ops.length) {
    try { applyPlan(db, desired, actual, plan, fresh ? ':memory:' : file, clock); } catch (e) { db.close(); throw e; }
  }
  db.migration = { fresh, plan };
  return db;
}

// ---------------------------------------------------------------- data access
function makeStore(model, db, clock) {
  let depth = 0;
  const tx = (fn) => {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; } finally { depth--; }
  };
  const mOf = (entity) => { const m = model.byEntity.get(entity); if (!m) throw new Error('unknown entity ' + entity); return m; };
  const live = (m, id) => db.prepare('SELECT * FROM ' + q(m.table) + ' WHERE id = ? AND archived_at IS NULL').get(id);
  const need = (m, id) => { const r = UUID.test(String(id)) ? live(m, String(id).toLowerCase()) : null; if (!r) throw new HttpError(404, m.entity + ' not found'); return r; };

  function writable(m, body, { creating }) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('body must be a JSON object');
    const out = {};
    for (const [k, v] of Object.entries(body)) {
      const c = m.byName.get(k);
      if (!c || c.system) throw bad('unknown field ' + k, k);
      if (c.auto) throw bad(k + ' is set by the system', k);
      out[k] = v;
    }
    const cols = {};
    for (const c of m.columns) {
      if (c.system || c.auto) continue;
      let v = out[c.name];
      if (v === undefined) {
        if (!creating) continue;
        v = c.default !== undefined ? c.default : null;
      }
      cols[c.name] = coerce(c, v);
      if (creating && c.transitions && c.default !== undefined && cols[c.name] !== c.default) throw bad(c.name + ' must start as ' + c.default, c.name);
      if (c.fk && cols[c.name] !== null && !live(mOf(model.byTable.get(c.fk).entity), cols[c.name])) throw bad(c.name + ': referenced row not found', c.name);
    }
    return cols;
  }
  function uniqueError(e, m) {
    const msg = String(e && e.message || '');
    if (/UNIQUE constraint failed/i.test(msg)) {
      const col = (msg.match(/\.([a-z0-9_]+)\s*$/i) || [])[1];
      return new HttpError(409, (col || 'value') + ' already exists', col);
    }
    return e;
  }

  const store = {
    tx, mOf, live, need,
    create(m, body) {
      const cols = writable(m, body, { creating: true });
      const now = clock();
      for (const c of m.columns) if (c.auto && !c.system) cols[c.name] = autoValue(c, now);
      const row = { id: crypto.randomUUID(), ...cols, ...(m.versioned ? { version: 1 } : {}), created_at: now, archived_at: null };
      const names = Object.keys(row);
      try { db.prepare('INSERT INTO ' + q(m.table) + ' (' + names.map(q).join(', ') + ') VALUES (' + names.map(() => '?').join(', ') + ')').run(...names.map((n) => row[n])); } catch (e) { throw uniqueError(e, m); }
      return outRow(m, live(m, row.id));
    },
    update(m, id, body) {
      const current = need(m, id);
      let rest = body;
      if (m.versioned && typeof body === 'object' && body !== null && !Array.isArray(body) && 'version' in body) {
        const { version, ...others } = body;
        if (!Number.isInteger(version)) throw bad('version must be a whole number', 'version');
        if (version !== current.version) throw new HttpError(409, 'version conflict: the record is now at version ' + current.version, 'version');
        rest = others;
      }
      const cols = writable(m, rest, { creating: false });
      const names = Object.keys(cols);
      for (const n of names) assertTransition(m.byName.get(n), current[n], cols[n]);
      if (names.length) {
        try { db.prepare('UPDATE ' + q(m.table) + ' SET ' + names.map((n) => q(n) + ' = ?').join(', ') + bump(m) + ' WHERE id = ? AND archived_at IS NULL').run(...names.map((n) => cols[n]), String(id).toLowerCase()); } catch (e) { throw uniqueError(e, m); }
      }
      return outRow(m, live(m, String(id).toLowerCase()));
    },
    archive(m, id, depth = 0) {
      if (depth > MAX_DEPTH) throw new HttpError(422, 'cascade chain deeper than ' + MAX_DEPTH);
      need(m, id);
      id = String(id).toLowerCase();
      const now = clock();
      const follow = []; // [{ holder, ids }] archived after this row, so a loop in the data cannot recurse forever
      for (const rel of model.rels.values()) {
        if (!rel.cascade) continue;
        if (rel.foreign_key) {
          const parentM = rel.holderIsTo ? rel.fromM : rel.toM;
          if (parentM !== m) continue;
          const kids = db.prepare('SELECT id FROM ' + q(rel.holder.table) + ' WHERE ' + q(rel.fkColumn) + ' = ? AND archived_at IS NULL').all(id);
          if (!kids.length) continue;
          if (rel.cascade === 'restrict') throw new HttpError(409, 'cannot archive: ' + kids.length + ' linked ' + rel.holder.entity + ' (' + rel.id + ')');
          follow.push({ holder: rel.holder, ids: kids.map((k) => k.id) });
        } else {
          const j = rel.junction;
          for (const [i, end] of [[0, rel.fromM], [1, rel.toM]]) {
            if (end !== m) continue;
            const col = j.columns[i].name;
            const n = db.prepare('SELECT COUNT(*) AS n FROM ' + q(j.table) + ' WHERE ' + q(col) + ' = ? AND archived_at IS NULL').get(id).n;
            if (!n) continue;
            if (rel.cascade === 'restrict') throw new HttpError(409, 'cannot archive: ' + n + ' active link(s) (' + rel.id + ')');
            db.prepare('UPDATE ' + q(j.table) + ' SET archived_at = ? WHERE ' + q(col) + ' = ? AND archived_at IS NULL').run(now, id); // links go; the other rows stay
          }
        }
      }
      db.prepare('UPDATE ' + q(m.table) + ' SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(now, id);
      for (const f of follow) for (const kid of f.ids) if (live(f.holder, kid)) store.archive(f.holder, kid, depth + 1);
    },
    list(m, query) {
      const where = ['archived_at IS NULL'], args = [];
      const search = (m.ds && m.ds.search_fields) || [];
      const text = query.get('q');
      if (text && search.length) { where.push('(' + search.map((n) => 'instr(lower(' + q(n) + "), lower(?)) > 0").join(' OR ') + ')'); for (let i = 0; i < search.length; i++) args.push(text); }
      for (const [key, raw] of query.entries()) {
        const mt = /^filter\[([a-z0-9_]+)\](?:\[(gte|lte)\])?$/.exec(key);
        if (!mt) continue;
        const c = m.byName.get(mt[1]);
        if (!c || c.type === 'json' || c.type === 'array') throw bad('cannot filter by ' + mt[1], mt[1]);
        let v = raw;
        if (c.type === 'number' || c.type === 'integer' || c.type === 'money') { v = Number(raw); if (!Number.isFinite(v)) throw bad(mt[1] + ': not a number', mt[1]); }
        else if (c.type === 'boolean') v = raw === 'true' ? 1 : raw === 'false' ? 0 : (() => { throw bad(mt[1] + ': true or false', mt[1]); })();
        where.push(q(c.name) + ' ' + (mt[2] === 'gte' ? '>=' : mt[2] === 'lte' ? '<=' : '=') + ' ?'); args.push(v);
      }
      let order = 'created_at DESC, id';
      const sort = query.get('sort');
      if (sort) {
        const desc = sort[0] === '-', name = desc ? sort.slice(1) : sort, c = m.byName.get(name);
        if (!c || c.type === 'json' || c.type === 'array') throw bad('cannot sort by ' + name, 'sort');
        order = q(name) + (desc ? ' DESC' : ' ASC') + ', id';
      }
      const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1);
      const size = Math.min(200, Math.max(1, parseInt(query.get('pageSize') || '20', 10) || 20));
      const w = ' WHERE ' + where.join(' AND ');
      const total = db.prepare('SELECT COUNT(*) AS n FROM ' + q(m.table) + w).get(...args).n;
      const rows = db.prepare('SELECT * FROM ' + q(m.table) + w + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?').all(...args, size, (page - 1) * size);
      return { items: rows.map((r) => outRow(m, r)), total };
    },
  };
  return store;
}

// ---------------------------------------------------------------- events (event_spec interpreter)
function makeEvents(model, db, store, clock, outboxHook, nowMs) {
  const rates = new Map(); // event id -> timestamps (ms) inside the window
  const audit = (id, a, t) => db.prepare('INSERT INTO ion_audit (event_id, actor_id, target_id, created_at) VALUES (?, ?, ?, ?)').run(id, a, t, clock());
  function run(ev, actorId, targetId, depth) {
    if (depth > MAX_DEPTH) throw new HttpError(422, 'workflow chain deeper than ' + MAX_DEPTH);
    if (ev.rate) { // metadata: at most rate.max runs per rate.per_seconds, counted per event id
      const t = nowMs(), from = t - ev.rate.per_seconds * 1000;
      const hits = (rates.get(ev.id) || []).filter((x) => x > from);
      if (hits.length >= ev.rate.max) throw new HttpError(429, 'rate limit: ' + ev.id + ' allows ' + ev.rate.max + ' per ' + ev.rate.per_seconds + 's');
      hits.push(t); rates.set(ev.id, hits);
    }
    db.prepare('INSERT INTO ion_ledger (event_id, actor_id, target_id, created_at) VALUES (?, ?, ?, ?)').run(ev.id, actorId, targetId, clock());
    const ids = { actor: actorId, target: targetId };
    // { "from": "actor" | "target" } stands for that row's id (a uuid value in create_entity / update_field).
    const ref = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && (v.from === 'actor' || v.from === 'target') ? ids[v.from] : v);
    for (const t of ev.triggers) {
      switch (t.action) {
        case 'send_notification': {
          const m = store.mOf(t.to);
          store.need(m, ids[t.row]);
          db.prepare('INSERT INTO ion_notifications (id, event_id, recipient_entity, recipient_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), ev.id, t.to, ids[t.row], t.message, clock());
          break;
        }
        case 'increment': case 'decrement': {
          const m = store.mOf(t.entity);
          store.need(m, ids[t.row]);
          db.prepare('UPDATE ' + q(m.table) + ' SET ' + q(t.attribute) + ' = COALESCE(' + q(t.attribute) + ', 0) ' + (t.action === 'increment' ? '+' : '-') + ' ?' + bump(m) + ' WHERE id = ? AND archived_at IS NULL').run(Number(t.by), ids[t.row]);
          break;
        }
        case 'update_field': {
          const m = store.mOf(t.entity);
          const cur = store.need(m, ids[t.row]), col = m.byName.get(t.attribute), val = coerce(col, ref(t.value));
          assertTransition(col, cur[t.attribute], val);
          db.prepare('UPDATE ' + q(m.table) + ' SET ' + q(t.attribute) + ' = ?' + bump(m) + ' WHERE id = ? AND archived_at IS NULL').run(val, ids[t.row]);
          break;
        }
        case 'create_entity': store.create(store.mOf(t.entity), Object.fromEntries(Object.entries(t.values || {}).map(([k, v]) => [k, ref(v)]))); break;
        case 'delete_entity': store.archive(store.mOf(t.entity), ids[t.row]); break;
        case 'log': audit(ev.id, actorId, targetId); break;
        case 'send_email': {
          const m = store.mOf(t.to), row = store.need(m, ids[t.row]);
          if (!row[t.attribute]) throw new HttpError(422, 'no email address on ' + t.to);
          outboxHook('email', ev.id, { to: row[t.attribute], subject: t.subject, body: t.body });
          break;
        }
        case 'call_webhook': outboxHook('webhook', ev.id, { url: t.url, body: { event_id: ev.id, actor_id: actorId, target_id: targetId } }); break;
        case 'trigger_workflow': run(model.events.get(t.workflow), actorId, targetId, depth + 1); break;
        default: throw new HttpError(500, 'unknown action ' + t.action);
      }
    }
  }
  return { run: (ev, a, t) => run(ev, a, t, 0) };
}

// ---------------------------------------------------------------- webhooks (best effort, after commit)
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
async function deliver(db, id, allowPrivate, clock) {
  const row = db.prepare('SELECT * FROM ion_outbox WHERE id = ?').get(id);
  if (!row || row.kind !== 'webhook') return;
  const p = JSON.parse(row.payload);
  let status = 'sent';
  try {
    const u = new URL(p.url);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('bad url');
    if (!allowPrivate && PRIVATE_HOST.test(u.hostname)) throw new Error('private host blocked');
    const res = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.body), redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('status ' + res.status);
  } catch { status = 'failed'; }
  db.prepare('UPDATE ion_outbox SET status = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?').run(status, clock(), id);
}

// ---------------------------------------------------------------- routes
function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.split('/').map((s) => (s[0] === ':' ? (keys.push(s.slice(1)), '([^/]+)') : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '$');
  return { re, keys };
}

export function routeTable(spec) {
  const model = buildModel(spec);
  const rows = [];
  for (const m of model.byEntity.values()) {
    const a = m.ds && m.ds.api;
    if (!a) continue;
    for (const k of ['list', 'create', 'read', 'update', 'archive', 'notifications', 'activity']) if (a[k]) rows.push({ method: a[k].method, path: a[k].path });
  }
  for (const rel of model.rels.values()) for (const a of rel.apis) rows.push({ method: a.method, path: a.path });
  rows.push({ method: 'PATCH', path: '/api/notifications/:id/read' });
  return rows;
}

function buildRoutes(model, store, events, db, ctxOpts) {
  const routes = [];
  const add = (method, pattern, handler) => {
    const c = compile(pattern);
    if (routes.some((r) => r.method === method && r.shape === pattern.replace(/:[A-Za-z]+/g, ':')))
      throw new Error('route clash: ' + method + ' ' + pattern);
    routes.push({ method, shape: pattern.replace(/:[A-Za-z]+/g, ':'), ...c, handler });
  };
  const body = (c) => c.body === undefined ? {} : c.body;

  for (const m of model.byEntity.values()) {
    const a = m.ds.api, e = m.entity;
    add(a.list.method, a.list.path, (c) => { c.need('entity:' + e + ':list'); return { json: store.list(m, c.query) }; });
    add(a.create.method, a.create.path, (c) => { c.need('entity:' + e + ':create'); return { status: 201, json: store.tx(() => store.create(m, body(c))) }; });
    add(a.read.method, a.read.path, (c) => { c.need('entity:' + e + ':read'); return { json: outRow(m, store.need(m, c.params.id)) }; });
    add(a.update.method, a.update.path, (c) => { c.need('entity:' + e + ':update'); return { json: store.tx(() => store.update(m, c.params.id, body(c))) }; });
    add(a.archive.method, a.archive.path, (c) => { c.need('entity:' + e + ':archive'); store.tx(() => store.archive(m, c.params.id)); return {}; });
    if (a.notifications) add(a.notifications.method, a.notifications.path, (c) => {
      c.need('entity:' + e + ':read'); store.need(m, c.params.id);
      return { json: db.prepare('SELECT id, event_id, message, read_at, created_at FROM ion_notifications WHERE recipient_entity = ? AND recipient_id = ? AND archived_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 200').all(e, String(c.params.id).toLowerCase()) };
    });
    if (a.activity) add(a.activity.method, a.activity.path, (c) => {
      c.need('entity:' + e + ':read'); store.need(m, c.params.id);
      const id = String(c.params.id).toLowerCase();
      return { json: db.prepare('SELECT event_id, actor_id, target_id, created_at FROM ion_ledger WHERE actor_id = ? OR target_id = ? ORDER BY seq DESC LIMIT 100').all(id, id) };
    });
  }
  add('PATCH', '/api/notifications/:id/read', (c) => {
    const n = UUID.test(c.params.id) ? db.prepare('SELECT * FROM ion_notifications WHERE id = ? AND archived_at IS NULL').get(c.params.id.toLowerCase()) : null;
    if (!n) throw new HttpError(404, 'notification not found');
    c.need('entity:' + n.recipient_entity + ':read');
    db.prepare('UPDATE ion_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(ctxOpts.clock(), n.id);
    return {};
  });

  // relationships --------------------------------------------------------------------------
  const fire = (rel, type, fromId, toId) => {
    for (const ev of model.events.values()) {
      if (ev.relationship !== rel.id || ev.type !== type) continue;
      if (ev.actor === rel.from && ev.target === rel.to) events.run(ev, fromId, toId);
      else if (ev.actor === rel.to && ev.target === rel.from) events.run(ev, toId, fromId);
    }
  };
  const ends = (rel, c, otherId) => { // resolve both row ids from the URL (+ body toId on create)
    const fromId = c.params.fromId !== undefined ? c.params.fromId : otherId;
    const toId = c.params.toId !== undefined ? c.params.toId : otherId;
    return { from: store.need(rel.fromM, fromId), to: store.need(rel.toM, toId) };
  };
  const linkRow = (rel, fromId, toId) => db.prepare('SELECT * FROM ' + q(rel.junction.table) + ' WHERE ' + q(rel.junction.columns[0].name) + ' = ? AND ' + q(rel.junction.columns[1].name) + ' = ? AND archived_at IS NULL').get(fromId, toId);
  const attrsOut = (rel, row) => { const o = {}; for (const a of rel.junction.attributes) { let v = row[a.name]; if (v !== null && v !== undefined && a.type === 'boolean') v = !!v; if (v !== null && v !== undefined && (a.type === 'json' || a.type === 'array')) v = JSON.parse(v); o[a.name] = v; } return o; };
  const junctionAttrs = (rel, input, creating, now) => {
    const out = {};
    for (const k of Object.keys(input)) { const a = rel.junction.attributes.find((x) => x.name === k); if (!a) throw bad('unknown field ' + k, k); if (a.auto) throw bad(k + ' is set by the system', k); }
    for (const a of rel.junction.attributes) {
      if (a.auto) { if (creating) out[a.name] = autoValue(a, now); continue; }
      if (input[a.name] === undefined && !creating) continue;
      out[a.name] = coerce({ ...a, name: a.name }, input[a.name] === undefined ? (a.default !== undefined ? a.default : null) : input[a.name]);
    }
    return out;
  };
  const sideRows = (rel, side, id) => { // rows on the OTHER end of `id`, as the UI expects
    const otherM = side === 'from' ? rel.toM : rel.fromM, thisM = side === 'from' ? rel.fromM : rel.toM;
    store.need(thisM, id);
    id = String(id).toLowerCase();
    if (rel.foreign_key) {
      const thisIsHolder = rel.holderIsTo ? side === 'to' : side === 'from';
      if (thisIsHolder) {
        const row = live1(rel.holder, id);
        const ref = row && row[rel.fkColumn] ? store.live(otherM, row[rel.fkColumn]) : null;
        return ref ? [outRow(otherM, ref)] : [];
      }
      return db.prepare('SELECT * FROM ' + q(rel.holder.table) + ' WHERE ' + q(rel.fkColumn) + ' = ? AND archived_at IS NULL ORDER BY created_at, id').all(id).map((r) => outRow(otherM, r));
    }
    const j = rel.junction, mine = j.columns[side === 'from' ? 0 : 1].name, theirs = j.columns[side === 'from' ? 1 : 0].name;
    const rows = db.prepare('SELECT o.*, j.created_at AS __lc' + j.attributes.map((a) => ', j.' + q(a.name) + ' AS ' + q('__a_' + a.name)).join('') + ' FROM ' + q(j.table) + ' j JOIN ' + q(otherM.table) + ' o ON o.id = j.' + q(theirs) + ' WHERE j.' + q(mine) + ' = ? AND j.archived_at IS NULL AND o.archived_at IS NULL ORDER BY j.created_at, o.id').all(id);
    return rows.map((r) => { const link = {}; for (const a of j.attributes) link[a.name] = r['__a_' + a.name]; return { ...outRow(otherM, r), link: attrsOut(rel, link) }; });
  };
  const live1 = (m, id) => db.prepare('SELECT * FROM ' + q(m.table) + ' WHERE id = ? AND archived_at IS NULL').get(id);

  for (const rel of model.rels.values()) {
    for (const a of rel.apis) {
      const p = a.path;
      const hasFrom = p.includes(':fromId'), hasTo = p.includes(':toId');
      const key = (k) => 'relationship:' + rel.id + ':' + k;
      if (a.method === 'GET') {
        const side = hasFrom ? 'from' : 'to';
        add('GET', p, (c) => { c.need(key('read')); return { json: sideRows(rel, side, c.params[side === 'from' ? 'fromId' : 'toId']) }; });
      } else if (a.method === 'POST') {
        add('POST', p, (c) => {
          c.need(key('link'));
          const input = body(c);
          if (typeof input !== 'object' || input === null || Array.isArray(input)) throw bad('body must be a JSON object');
          const { toId, ...attrs } = input;
          if (typeof toId !== 'string') throw bad('toId is required', 'toId');
          store.tx(() => {
            const { from, to } = ends(rel, c, toId);
            if (rel.foreign_key) {
              if (Object.keys(attrs).length) throw bad('this relationship has no link attributes');
              const holderRow = rel.holderIsTo ? to : from, refRow = rel.holderIsTo ? from : to;
              try { db.prepare('UPDATE ' + q(rel.holder.table) + ' SET ' + q(rel.fkColumn) + ' = ? WHERE id = ?').run(refRow.id, holderRow.id); } catch (e) { if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'already linked'); throw e; }
            } else {
              if (linkRow(rel, from.id, to.id)) throw new HttpError(409, 'already linked');
              const vals = junctionAttrs(rel, attrs, true, ctxOpts.clock());
              const names = [rel.junction.columns[0].name, rel.junction.columns[1].name, ...Object.keys(vals), 'created_at'];
              db.prepare('INSERT INTO ' + q(rel.junction.table) + ' (' + names.map(q).join(', ') + ') VALUES (' + names.map(() => '?').join(', ') + ')').run(from.id, to.id, ...Object.values(vals), ctxOpts.clock());
            }
            fire(rel, 'create', from.id, to.id);
          });
          return { status: 201, json: {} };
        });
      } else if (a.method === 'PATCH') {
        add('PATCH', p, (c) => {
          c.need(key('link'));
          const input = body(c);
          if (typeof input !== 'object' || input === null || Array.isArray(input)) throw bad('body must be a JSON object');
          store.tx(() => {
            const { from, to } = ends(rel, c);
            if (rel.foreign_key) throw bad('this relationship has no link attributes');
            if (!linkRow(rel, from.id, to.id)) throw new HttpError(404, 'link not found');
            const vals = junctionAttrs(rel, input, false, ctxOpts.clock());
            const names = Object.keys(vals);
            if (names.length) db.prepare('UPDATE ' + q(rel.junction.table) + ' SET ' + names.map((n) => q(n) + ' = ?').join(', ') + ' WHERE ' + q(rel.junction.columns[0].name) + ' = ? AND ' + q(rel.junction.columns[1].name) + ' = ? AND archived_at IS NULL').run(...Object.values(vals), from.id, to.id);
            fire(rel, 'update', from.id, to.id);
          });
          return {};
        });
      } else if (a.method === 'DELETE') {
        add('DELETE', p, (c) => {
          c.need(key('unlink'));
          store.tx(() => {
            const { from, to } = ends(rel, c);
            if (rel.foreign_key) {
              const holderRow = rel.holderIsTo ? to : from, refRow = rel.holderIsTo ? from : to;
              if (holderRow[rel.fkColumn] !== refRow.id) throw new HttpError(404, 'link not found');
              db.prepare('UPDATE ' + q(rel.holder.table) + ' SET ' + q(rel.fkColumn) + ' = NULL WHERE id = ?').run(holderRow.id);
            } else {
              if (!linkRow(rel, from.id, to.id)) throw new HttpError(404, 'link not found');
              db.prepare('UPDATE ' + q(rel.junction.table) + ' SET archived_at = ? WHERE ' + q(rel.junction.columns[0].name) + ' = ? AND ' + q(rel.junction.columns[1].name) + ' = ? AND archived_at IS NULL').run(ctxOpts.clock(), from.id, to.id);
            }
            fire(rel, 'delete', from.id, to.id);
          });
          return {};
        });
      }
      void hasTo;
    }
  }

  // fire any event by id (custom events have no relationship to hang off) -----------------------
  add('POST', '/api/events/:id', (c) => {
    const ev = model.events.get(c.params.id);
    if (!ev) throw new HttpError(404, 'unknown event');
    c.need('entity:' + ev.actor + ':update');
    const input = body(c);
    if (typeof input.actor_id !== 'string' || typeof input.target_id !== 'string') throw bad('actor_id and target_id are required');
    store.tx(() => { store.need(store.mOf(ev.actor), input.actor_id); store.need(store.mOf(ev.target), input.target_id); events.run(ev, input.actor_id.toLowerCase(), input.target_id.toLowerCase()); });
    return {};
  });
  return routes;
}

// ---------------------------------------------------------------- browser shell
function shell(spec) {
  const ui = spec.ui.ui_spec, locale = ui.default_locale, dir = ui.directions && ui.directions[locale] ? ui.directions[locale] : (locale === 'ar' ? 'rtl' : 'ltr');
  return {
    html: '<!doctype html>\n<html lang="' + locale + '" dir="' + dir + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + String(spec.app || 'Ion').replace(/[<&>"]/g, '') + '</title><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div><script src="/ui_advanced.js"></script><script src="/app.js"></script><script src="/boot.js"></script></body></html>\n',
    boot: '(function(){var L=' + JSON.stringify(locale) + ',T={ar:{t:"رمز الدخول",b:"دخول",e:"رمز غير صحيح"},en:{t:"Access token",b:"Sign in",e:"Wrong token"}}[L==="ar"?"ar":"en"];' +
      'var root=document.getElementById("app");' +
      'function start(p){Ion.start({root:root,dataSource:Ion.createRestDataSource({baseUrl:""}),permissions:p,locale:L});}' +
      'function login(){root.replaceChildren();var f=document.createElement("form");f.className="ion";f.style.maxWidth="24rem";f.style.margin="4rem auto";' +
      'var l=document.createElement("label");l.textContent=T.t;l.htmlFor="tok";var i=document.createElement("input");i.id="tok";i.type="password";i.autocomplete="current-password";i.required=true;' +
      'var b=document.createElement("button");b.type="submit";b.textContent=T.b;var er=document.createElement("p");er.setAttribute("role","alert");er.className="error";' +
      'f.append(l,i,b,er);f.onsubmit=function(e){e.preventDefault();fetch("/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:i.value})}).then(function(r){return r.ok?r.json():Promise.reject()}).then(function(j){start(j.permissions)}).catch(function(){er.textContent=T.e})};root.appendChild(f);i.focus();}' +
      'fetch("/auth/me").then(function(r){return r.ok?r.json():Promise.reject()}).then(function(j){start(j.permissions)}).catch(login);})();\n',
  };
}

// ---------------------------------------------------------------- permissions and roles
// A permission list is exact keys, "*" (everything) or patterns whose segments may be "*" ("entity:order:*",
// "entity:*:read"); an entry starting with "!" removes what it matches, and a removal always wins. Patterns are
// matched against the keys the ui_spec declares, and one that matches nothing is refused at start (closed
// vocabulary: no permission is accepted and then ignored). The result is the concrete key list the checks use.
export function compilePermissions(list, declared, where = 'permissions') {
  if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) throw new Error(where + ': must be a list of strings');
  if (list.length === 1 && list[0] === '*') return ['*'];
  const allow = new Set(), deny = new Set();
  for (const raw of list) {
    const neg = raw.startsWith('!'), pat = neg ? raw.slice(1) : raw;
    const segs = pat.split(':');
    if (pat === '*' ? neg : !(segs.length === 3 && segs.every((x) => x === '*' || /^[a-z][a-z0-9_]*$/.test(x)))) throw new Error(where + ': bad permission "' + raw + '" (use entity:<id>:<action>, with * for any segment)');
    const hits = pat === '*' ? declared : declared.filter((k) => k.split(':').every((v, i) => segs[i] === '*' || segs[i] === v));
    if (!hits.length) throw new Error(where + ': "' + raw + '" matches no permission this app declares');
    for (const k of hits) (neg ? deny : allow).add(k);
  }
  return declared.filter((k) => allow.has(k) && !deny.has(k));
}

// roles config: { roles: { <name>: [perm, ...] | { extends: [<role>], permissions: [perm, ...] } }, tokens: { <token>: <role> } }
export function resolveRoles(config, declared) {
  const roles = config && typeof config.roles === 'object' && config.roles && !Array.isArray(config.roles) ? config.roles : null;
  const tokens = config && typeof config.tokens === 'object' && config.tokens && !Array.isArray(config.tokens) ? config.tokens : null;
  if (!roles || !tokens) throw new Error('roles: need { "roles": {...}, "tokens": {...} }');
  const flat = (name, trail) => {
    if (trail.includes(name)) throw new Error('roles: "' + [...trail, name].join(' -> ') + '" is a cycle');
    const r = roles[name];
    if (r === undefined) throw new Error('roles: unknown role "' + name + '"');
    const def = Array.isArray(r) ? { permissions: r } : r;
    const own = def && Array.isArray(def.permissions) ? def.permissions : null;
    if (!own || (def.extends !== undefined && !Array.isArray(def.extends))) throw new Error('roles: role "' + name + '" needs a permissions list (and extends, if any, a list of roles)');
    return [...(def.extends || []).flatMap((x) => flat(x, [...trail, name])), ...own];
  };
  const byRole = {};
  for (const name of Object.keys(roles)) byRole[name] = compilePermissions(flat(name, []), declared, 'roles.' + name);
  const out = {};
  for (const [tok, role] of Object.entries(tokens)) {
    if (tok.length < 16) throw new Error('roles: tokens need 16+ characters');
    if (!Object.hasOwn(byRole, role)) throw new Error('roles: a token names the unknown role "' + String(role) + '"');
    out[tok] = byRole[role];
  }
  return out;
}

// ---------------------------------------------------------------- server
export function createIonServer(opts) {
  const spec = opts.spec;
  const model = buildModel(spec);
  const clock = opts.now || isoNow;
  const db = openDatabase(model, opts.db || ':memory:', opts.migrate, clock);
  const store = makeStore(model, db, clock);
  const pending = [];
  const events = makeEvents(model, db, store, clock, (kind, eventId, payload) => {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO ion_outbox (id, kind, event_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, eventId, JSON.stringify(payload), 'queued', clock());
    if (kind === 'webhook') pending.push(id);
  }, opts.nowMs || Date.now);
  const routes = buildRoutes(model, store, events, db, { clock });

  // tokens -> permissions. Only SHA-256 digests are kept in memory.
  const digest = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  const byDigest = new Map();
  for (const [tok, perms] of Object.entries(opts.tokens || {})) byDigest.set(digest(tok), compilePermissions(perms, model.ui.permissions, 'token'));
  if (byDigest.size === 0) throw new Error('no access tokens configured');
  const sessionKey = crypto.createHash('sha256').update('ion-session|' + [...byDigest.keys()].sort().join('|')).digest();
  const sessionOf = (d) => crypto.createHmac('sha256', sessionKey).update(d).digest('hex');
  const bySession = new Map([...byDigest.entries()].map(([d, p]) => [sessionOf(d), p]));
  const fails = new Map();
  const web = shell(spec);
  const staticDir = opts.staticDir || path.resolve(HERE, '../../web');
  const STATIC = { '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/ui_advanced.js': ['ui_advanced.js', 'text/javascript; charset=utf-8'] };

  const send = (res, status, payload, headers = {}) => {
    const buf = payload === undefined ? Buffer.alloc(0) : Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
    res.writeHead(status, { 'content-length': buf.length, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", ...headers });
    res.end(buf);
  };
  const json = (res, status, o) => send(res, status, o, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  const readBody = (req) => new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
  const cookieOf = (req, name) => { for (const p of String(req.headers.cookie || '').split(';')) { const [k, ...v] = p.trim().split('='); if (k === name) return v.join('='); } return null; };
  const authenticate = (req) => {
    const h = String(req.headers.authorization || '');
    if (/^Bearer /i.test(h)) { const p = byDigest.get(digest(h.slice(7).trim())); return p ? { perms: p, via: 'bearer' } : null; }
    const s = cookieOf(req, 'ion_session');
    const p = s ? bySession.get(s) : null;
    return p ? { perms: p, via: 'cookie' } : null;
  };
  // The UI checks exact keys, so '*' is expanded to every key the ui_spec declares (enforcement still uses the raw list).
  const forUi = (perms) => (perms.includes('*') ? model.ui.permissions.slice() : perms);
  const allowed = (perms, key) => perms.includes('*') || perms.includes(key);
  const secure = (req) => opts.secureCookie || String(req.headers['x-forwarded-proto'] || '') === 'https';

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname, method = req.method;
    try {
      if (method === 'GET' && pathname === '/healthz') return json(res, 200, { ok: true });
      if (method === 'GET' && pathname === '/') return send(res, 200, web.html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      if (method === 'GET' && pathname === '/boot.js') return send(res, 200, web.boot, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      if (method === 'GET' && STATIC[pathname]) {
        const f = path.join(staticDir, STATIC[pathname][0]);
        if (!fs.existsSync(f)) return pathname === '/ui_advanced.js' ? send(res, 200, '', { 'content-type': STATIC[pathname][1] }) : json(res, 404, { error: 'not found' });
        return send(res, 200, fs.readFileSync(f), { 'content-type': STATIC[pathname][1], 'cache-control': 'no-cache' });
      }
      // CSRF: a browser request with a foreign Origin never reaches a handler
      const origin = req.headers.origin;
      if (origin && method !== 'GET' && method !== 'HEAD') { let o; try { o = new URL(origin).host; } catch { o = ''; } if (o !== req.headers.host) throw new HttpError(403, 'cross-origin request refused'); }

      if (pathname === '/auth/login' && method === 'POST') {
        const ip = req.socket.remoteAddress || '?';
        const rec = fails.get(ip);
        if (rec && rec.n >= 10 && Date.now() - rec.t < 900000) throw new HttpError(429, 'too many attempts, try later');
        const b = JSON.parse((await readBody(req)) || '{}');
        const p = typeof b.token === 'string' ? byDigest.get(digest(b.token)) : null;
        if (!p) { fails.set(ip, { n: (rec && Date.now() - rec.t < 900000 ? rec.n : 0) + 1, t: Date.now() }); throw new HttpError(401, 'wrong token'); }
        fails.delete(ip);
        return send(res, 200, { permissions: forUi(p) }, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': 'ion_session=' + sessionOf(digest(b.token)) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000' + (secure(req) ? '; Secure' : '') });
      }
      if (pathname === '/auth/logout' && method === 'POST') return send(res, 204, undefined, { 'set-cookie': 'ion_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      const who = authenticate(req);
      if (pathname === '/auth/me' && method === 'GET') { if (!who) throw new HttpError(401, 'sign in required'); return json(res, 200, { permissions: forUi(who.perms) }); }

      if (!pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
      if (!who) throw new HttpError(401, 'sign in required');
      let hit = null;
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (m) { hit = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
      }
      if (!hit) throw new HttpError(404, 'not found');
      let parsed;
      if (method === 'POST' || method === 'PATCH') {
        if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { const raw = await readBody(req); if (raw) throw new HttpError(415, 'send application/json'); parsed = {}; }
        else { const raw = await readBody(req); try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw bad('invalid JSON'); } }
      }
      const ctx = { params: hit.params, query: url.searchParams, body: parsed, need(key) { if (!allowed(who.perms, key)) throw new HttpError(403, 'not allowed: ' + key); } };
      const out = hit.r.handler(ctx) || {};
      if (pending.length) { const ids = pending.splice(0); for (const id of ids) deliver(db, id, !!opts.allowPrivateWebhooks, clock).catch(() => {}); }
      if (out.json === undefined) return send(res, out.status || 204, undefined, { 'cache-control': 'no-store' });
      return json(res, out.status || 200, out.json);
    } catch (e) {
      pending.length = 0;
      if (e instanceof HttpError) return json(res, e.status, e.field ? { error: e.message, field: e.field } : { error: e.message });
      console.error('ion: internal error', e);
      return json(res, 500, { error: 'internal error' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  return { server, db, routes, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

// ---------------------------------------------------------------- run directly: node server.mjs
async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'spec.json'), 'utf8'));
  const migrate = process.env.ION_MIGRATE || 'auto', dbFile = process.env.ION_DB || path.join(HERE, 'data', 'app.db');
  if (!['auto', 'apply', 'plan'].includes(migrate)) { console.error('ION_MIGRATE must be auto, apply or plan'); process.exit(1); }
  if (migrate === 'plan') { // dry run: print what would change on this database, change nothing
    if (!fs.existsSync(dbFile)) { console.log('no database yet at ' + dbFile + ': a fresh one will be created, nothing to migrate'); process.exit(0); }
    const probe = new DatabaseSync(dbFile, { readOnly: true });
    const plan = planMigration(desiredSchema(buildModel(spec)), actualSchema(probe)); probe.close();
    for (const o of plan.ops) console.log('would ' + describe(o));
    for (const b of plan.blocked) console.log('BLOCKED [' + b.code + '] ' + b.table + (b.column ? '.' + b.column : '') + ': ' + b.message);
    for (const k of plan.kept) console.log('kept (not in the definition, never dropped): ' + k.table + (k.column ? '.' + k.column : ''));
    if (!plan.ops.length && !plan.blocked.length) console.log('database already matches the definition');
    process.exit(plan.blocked.length ? 2 : 0);
  }
  const tokens = {};
  const owner = process.env.ION_OWNER_TOKEN;
  if (owner) { if (owner.length < 16) { console.error('ION_OWNER_TOKEN must be at least 16 characters'); process.exit(1); } tokens[owner] = ['*']; }
  if (process.env.ION_TOKENS) { // {"<token>": ["entity:student:list", ...]}
    for (const [t, p] of Object.entries(JSON.parse(process.env.ION_TOKENS))) { if (t.length < 16 || !Array.isArray(p)) { console.error('ION_TOKENS: tokens need 16+ characters and a permission list'); process.exit(1); } tokens[t] = p; }
  }
  const rolesFile = process.env.ION_ROLES || path.join(HERE, 'roles.json');
  if (process.env.ION_ROLES && !fs.existsSync(rolesFile)) { console.error('ION_ROLES points to a file that does not exist: ' + rolesFile); process.exit(1); }
  if (fs.existsSync(rolesFile)) {
    try { Object.assign(tokens, resolveRoles(JSON.parse(fs.readFileSync(rolesFile, 'utf8')), spec.ui.ui_spec.permissions)); } catch (e) { console.error(String(e.message || e)); process.exit(1); }
  }
  if (!Object.keys(tokens).length) { console.error('Set ION_OWNER_TOKEN (16+ characters). Nothing is served without a token.'); process.exit(1); }
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
  let app;
  try { app = createIonServer({ spec, tokens, migrate, db: dbFile, staticDir: process.env.ION_STATIC, secureCookie: process.env.ION_SECURE_COOKIE === '1' }); } catch (e) { if (e instanceof MigrationError) { console.error(e.message); process.exit(1); } throw e; }
  app.server.listen(port, host, () => console.log('Ion listening on http://' + host + ':' + port));
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
