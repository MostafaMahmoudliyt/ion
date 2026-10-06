# sql-postgres

Database Generator (kind `database`). Reads `schema_spec`, `relationship_spec`, `event_spec`; writes PostgreSQL.

| File | From | Content |
|---|---|---|
| `0001_schema.sql` | schema_spec | one table per entity, Ion types mapped to PostgreSQL types, `CHECK` for email / url / enum, row-level security enabled |
| `0002_relationships.sql` | relationship_spec | junction tables, foreign keys, indexes; uniqueness only over non-archived rows (`WHERE archived_at IS NULL`) |
| `0003_events.sql` | event_spec | `ion_event_log`, `ion_audit_log` (append-only, enforced by trigger), `ion_notifications` |

Type map: string/email/url/phone/enum -> `TEXT`, number -> `NUMERIC`, integer -> `INTEGER`, boolean -> `BOOLEAN`,
date -> `DATE`, timestamp -> `TIMESTAMP`, uuid -> `UUID`, json/array -> `JSONB`.

Run in numeric order. Identifiers over 63 bytes are shortened with a stable hash.
The three `ion_*` record tables are the contract shared with `events-node-postgres`.

Tests: `node --test tests.ts` (set `ION_PG_URI` to also execute the SQL on a real PostgreSQL).
