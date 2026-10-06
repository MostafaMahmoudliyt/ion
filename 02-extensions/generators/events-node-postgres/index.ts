// Event Generator: Node.js handlers on PostgreSQL (constitution section 38, item 3). An Extension, not Core.
// Reads event_spec (what happens) and schema_spec (which table/column that means) and writes handlers.js.
// It shares the ion_* record table names with sql-postgres (see README).
import { EVENT_RUNTIME_JS } from './runtime.ts';

type Obj = Record<string, any>; // validated spec JSON
type Bind = { id: 'actor' | 'target' } | { literal: unknown };

const handlerName = (eventId: string): string =>
  'on' + eventId.split(/[._]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');

const placeholder = (type: string, n: number): string => (type === 'json' || type === 'array' ? `$${n}::jsonb` : `$${n}`);

// Literal or { from: "actor" | "target" } -> bind. json/array literals are serialised once, at build time.
function bindFor(type: string, v: any): Bind {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && 'from' in v) return { id: v.from };
  return { literal: type === 'json' || type === 'array' ? JSON.stringify(v) : v };
}

export function generate(specs: Obj): Record<string, string> {
  const events: Obj[] = specs.event_spec.event_spec.events;
  if (events.length === 0) return {};

  const table = new Map<string, Obj>(specs.schema_spec.schema_spec.tables.map((t: Obj) => [t.entity, t]));
  const col = (entity: string, attribute: string): Obj => table.get(entity)!.columns.find((c: Obj) => c.name === attribute)!;

  const blocks: string[] = [];
  const names: Array<{ id: string; handler: string }> = [];

  for (const ev of events) {
    const steps: Obj[] = [];
    const after: Obj[] = [];

    for (const t of ev.triggers) {
      switch (t.action) {
        case 'send_notification':
          steps.push({ action: t.action, sql: 'INSERT INTO ion_notifications (event_id, recipient_entity, recipient_id, message) VALUES ($1, $2, $3, $4)', bind: [{ literal: ev.id }, { literal: t.to }, { id: t.row }, { literal: t.message }] });
          after.push({ action: 'push', recipient_entity: t.to, recipient: { id: t.row }, message: t.message });
          break;
        case 'increment':
        case 'decrement': {
          const op = t.action === 'increment' ? '+' : '-';
          steps.push({ action: t.action, sql: `UPDATE ${table.get(t.entity)!.table} SET ${t.attribute} = COALESCE(${t.attribute}, 0) ${op} $2 WHERE id = $1 AND archived_at IS NULL`, bind: [{ id: t.row }, { literal: t.by }], expect: 1 });
          break;
        }
        case 'update_field': {
          const c = col(t.entity, t.attribute);
          steps.push({ action: t.action, sql: `UPDATE ${table.get(t.entity)!.table} SET ${t.attribute} = ${placeholder(c.type, 2)} WHERE id = $1 AND archived_at IS NULL`, bind: [{ id: t.row }, bindFor(c.type, t.value)], expect: 1 });
          break;
        }
        case 'create_entity': {
          const names = Object.keys(t.values);
          steps.push({
            action: t.action,
            sql: names.length
              ? `INSERT INTO ${table.get(t.entity)!.table} (${names.join(', ')}) VALUES (${names.map((n, i) => placeholder(col(t.entity, n).type, i + 1)).join(', ')})`
              : `INSERT INTO ${table.get(t.entity)!.table} DEFAULT VALUES`,
            bind: names.map((n) => bindFor(col(t.entity, n).type, t.values[n])),
            expect: 1,
          });
          break;
        }
        case 'delete_entity': // nothing is deleted, only archived
          steps.push({ action: t.action, sql: `UPDATE ${table.get(t.entity)!.table} SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL`, bind: [{ id: t.row }], expect: 1 });
          break;
        case 'log':
          steps.push({ action: t.action, sql: 'INSERT INTO ion_audit_log (event_id, actor_id, target_id) VALUES ($1, $2, $3)', bind: [{ literal: ev.id }, { id: 'actor' }, { id: 'target' }] });
          break;
        case 'send_email':
          after.push({ action: t.action, lookup: { entity: t.to, column: t.attribute, sql: `SELECT ${t.attribute} FROM ${table.get(t.to)!.table} WHERE id = $1 AND archived_at IS NULL`, bind: [{ id: t.row }] }, subject: t.subject, body: t.body });
          break;
        case 'call_webhook':
          after.push({ action: t.action, url: t.url });
          break;
        case 'trigger_workflow':
          after.push({ action: t.action, workflow: t.workflow });
          break;
      }
    }

    const list = (items: unknown[]): string => (items.length ? `[\n${items.map((x) => '      ' + JSON.stringify(x)).join(',\n')},\n    ]` : '[]');
    blocks.push(
      `  ${JSON.stringify(ev.id)}: {\n    id: ${JSON.stringify(ev.id)},\n    name: ${JSON.stringify(ev.name)},\n` +
        `    actor: ${JSON.stringify(ev.actor)},\n    target: ${JSON.stringify(ev.target)},\n` +
        `    steps: ${list(steps)},\n    after: ${list(after)},\n  },`,
    );
    names.push({ id: ev.id, handler: handlerName(ev.id) });
  }

  const js =
    '// Ion events-node-postgres. Deterministic: same specs => same output. Generated, do not edit.\n' +
    '// Adapter contract: ctx = { db: { transaction(fn), query(sql, params) }, push?, email?, http? }.\n' +
    '// tx.query / db.query return { rows, rowCount } (the shape node-postgres uses).\n\n' +
    EVENT_RUNTIME_JS +
    '\n// ---- Generated from event_spec: plain data, no logic ----\n' +
    `const EVENTS = Object.freeze({\n${blocks.join('\n')}\n});\n\n` +
    names.map((s) => `export const ${s.handler} = (ctx, event) => dispatch(ctx, ${JSON.stringify(s.id)}, event);`).join('\n') +
    '\n\n' +
    `export const handlers = Object.freeze({\n${names.map((s) => `  ${JSON.stringify(s.id)}: ${s.handler},`).join('\n')}\n});\n` +
    `export const eventIds = Object.freeze(${JSON.stringify(names.map((s) => s.id))});\n`;
  return { 'handlers.js': js };
}
