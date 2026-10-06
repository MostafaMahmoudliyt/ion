// The fixed half of handlers.js: identical in every build, no per-definition logic.
// All definition-specific content lives in the generated EVENTS table, which is plain data.
// No eval, no Function, no dynamic import (constitution section 10).

export const EVENT_RUNTIME_JS = String.raw`// ---- Ion event runtime (fixed, identical in every build) ----
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEPTH = 16;
const LEDGER_SQL = 'INSERT INTO ion_event_log (event_id, actor_id, target_id) VALUES ($1, $2, $3)';

export class IonEventError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IonEventError';
    this.code = code;
  }
}

const bindOne = (b, event) => ('literal' in b ? b.literal : b.id === 'actor' ? event.actor_id : event.target_id);
const bindAll = (binds, event) => binds.map((b) => bindOne(b, event));

async function runAfter(ctx, def, step, event, depth) {
  switch (step.action) {
    case 'push':
      if (!ctx.push) return { skipped: true };
      await ctx.push.send({
        event_id: def.id,
        recipient_entity: step.recipient_entity,
        recipient_id: bindOne(step.recipient, event),
        message: step.message,
      });
      return {};
    case 'send_email': {
      if (!ctx.email) throw new IonEventError('NO_EMAIL_ADAPTER', 'ctx.email is required to send email');
      const found = await ctx.db.query(step.lookup.sql, bindAll(step.lookup.bind, event));
      const to = found.rows[0] && found.rows[0][step.lookup.column];
      if (!to) throw new IonEventError('NO_RECIPIENT', 'no email address found for ' + step.lookup.entity);
      await ctx.email.send({ event_id: def.id, to, subject: step.subject, body: step.body });
      return {};
    }
    case 'call_webhook':
      if (!ctx.http) throw new IonEventError('NO_HTTP_ADAPTER', 'ctx.http is required to call webhooks');
      await ctx.http.post(step.url, { event_id: def.id, actor_id: event.actor_id, target_id: event.target_id });
      return {};
    case 'trigger_workflow':
      await execute(ctx, step.workflow, event, depth + 1);
      return {};
    default:
      throw new IonEventError('UNKNOWN_STEP', 'unknown step ' + step.action);
  }
}

async function execute(ctx, eventId, event, depth) {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, eventId)) throw new IonEventError('UNKNOWN_EVENT', 'unknown event ' + String(eventId));
  if (depth > MAX_DEPTH) throw new IonEventError('WORKFLOW_DEPTH', 'workflow chain deeper than ' + MAX_DEPTH);
  if (!event || !UUID_RE.test(event.actor_id) || !UUID_RE.test(event.target_id)) {
    throw new IonEventError('INVALID_PAYLOAD', 'event needs actor_id and target_id as UUIDs');
  }
  if (!ctx || !ctx.db || typeof ctx.db.transaction !== 'function') {
    throw new IonEventError('NO_TRANSACTION', 'ctx.db.transaction(fn) is required: database steps must be atomic');
  }
  const def = EVENTS[eventId];

  // Phase 1 (atomic): the ledger row and every database step commit together or not at all.
  await ctx.db.transaction(async (tx) => {
    await tx.query(LEDGER_SQL, [def.id, event.actor_id, event.target_id]);
    for (const step of def.steps) {
      const res = await tx.query(step.sql, bindAll(step.bind, event));
      if (step.expect !== undefined && res.rowCount !== step.expect) {
        throw new IonEventError('ROW_NOT_FOUND', step.action + ' changed ' + res.rowCount + ' rows, expected ' + step.expect + ': the row is missing or archived');
      }
    }
  });

  // Phase 2 (after commit, in declared order): outward effects. Each failure is reported, never hidden.
  const effects = [];
  for (const step of def.after) {
    try {
      const r = await runAfter(ctx, def, step, event, depth);
      effects.push(r.skipped ? { action: step.action, ok: true, skipped: true } : { action: step.action, ok: true });
    } catch (e) {
      effects.push({ action: step.action, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }
  return { event_id: def.id, ok: effects.every((x) => x.ok), effects };
}

export function dispatch(ctx, eventId, event) {
  return execute(ctx, eventId, event, 0);
}
`;
