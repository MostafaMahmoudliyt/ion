# server-node-sqlite

API Generator (kind `api`, target `backend/server`). Reads all four specs; writes `server.mjs`, `spec.json`, `RUN.md`.

`server.mjs` is a **fixed runtime, identical in every build** (a Spec interpreter, section 26); everything specific to the app is `spec.json`, plain data. Zero dependencies: `node:http`, `node:sqlite`, `node:crypto`. Needs Node 22.13+.

What it does: serves exactly the routes `api-rest` declares (a test compares both lists); creates the SQLite schema from `schema_spec` and `relationship_spec`; validates every write against the column types; enforces token permissions on every route; runs `event_spec` triggers atomically (notifications, counters, field updates, audit and ledger, workflow chains); queues email in `ion_outbox` and sends webhooks after commit (private addresses refused); serves the web UI same-origin with a sign-in page.

What it does not do: SQLite has no row-level security, so authority is the permission check on each route (one owner, optional scoped tokens); no mail server is wired; no TLS (put it behind Caddy, a Cloudflare tunnel or Tailscale and set `ION_SECURE_COOKIE=1`).
