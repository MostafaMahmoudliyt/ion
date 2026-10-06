// API Generator / runnable server (constitution sections 26, 49). An Extension, not Core.
// The runtime (server.mjs) is fixed and identical in every build; everything specific to the app is spec.json,
// plain data. So the server is a Spec interpreter (section 26: Spec Loader, Validator, Executor) rather than
// per-app generated code, and "same spec => same bytes" holds trivially.
import { readFileSync } from 'node:fs';

type Obj = Record<string, any>; // validated spec JSON

const RUNTIME = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

const RUN_MD = `# Run this app

Needs Node 22.13 or newer. No npm install: the server has no dependencies.

\`\`\`bash
cd backend/server
export ION_OWNER_TOKEN='choose-a-long-random-secret-16+chars'
node server.mjs            # http://127.0.0.1:8787  (PORT, HOST, ION_DB, ION_STATIC override)
\`\`\`

Open the address, paste the token, you are in. The database is \`data/app.db\` (SQLite, WAL).

- Access: every /api call needs the token (Bearer header or the session cookie set by the sign-in page).
  \`ION_TOKENS='{"<token>": ["entity:student:list","entity:student:read"]}'\` adds scoped tokens.
- Schema changes: the database is compared with the definition at every start. New tables, new optional columns, required columns that have a default, and index changes apply automatically in one transaction and are recorded in \`ion_migrations\`. A column that becomes required or optional rebuilds its table: start once with \`ION_MIGRATE=apply\` (a \`.pre-migration-*.bak\` copy is written first). \`ION_MIGRATE=plan\` prints what would change and touches nothing. Refused with the reason: a type change, a required column without a default, a changed foreign-key target, removing a still-required column. Tables and columns removed from the definition are kept, never dropped.
- Roles: put a \`roles.json\` next to server.mjs (or set \`ION_ROLES\`):
  \`{"roles": {"viewer": ["entity:*:list", "entity:*:read"], "sales": {"extends": ["viewer"], "permissions": ["entity:order:*", "!entity:*:archive"]}},
  "tokens": {"<16+ char token>": "sales"}}\`. \`*\` stands for any one segment, \`!\` removes (and always wins), a pattern that
  matches no declared permission stops the server from starting.
- Behind HTTPS (Caddy, Cloudflare Tunnel, Tailscale) set \`ION_SECURE_COOKIE=1\`.
- Events: relationship events fire when a link is created, updated or removed; any event can also be fired with
  \`POST /api/events/<id>\` and \`{"actor_id": "...", "target_id": "..."}\`. Email steps are written to the
  \`ion_outbox\` table with status \`queued\` (no mail server is wired); webhooks are sent after commit and
  private addresses are refused.
- Backup: copy \`data/app.db\` while stopped, or run \`sqlite3 data/app.db ".backup out.db"\`.
`;

export function generate(specs: Obj): Record<string, string> {
  const spec = { schema: specs.schema_spec, relationship: specs.relationship_spec, event: specs.event_spec, ui: specs.ui_spec };
  return {
    'server.mjs': RUNTIME,
    'spec.json': JSON.stringify(spec, null, 2) + '\n',
    'RUN.md': RUN_MD,
  };
}
