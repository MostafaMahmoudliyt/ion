# events-node-postgres

Event Generator (kind `api`). Reads `event_spec` + `schema_spec`; writes `handlers.js` (ES module, Node.js).

One exported handler per event (`student.enrolled` -> `onStudentEnrolled`), plus `handlers`, `eventIds` and `dispatch`.

Adapter you pass in: `ctx = { db: { transaction(fn), query(sql, params) }, push?, email?, http? }`
(`query` returns `{ rows, rowCount }`, the node-postgres shape).

Execution of one event:
1. **One transaction**: ledger row, then `increment` / `decrement` / `update_field` / `create_entity` / `delete_entity` (archives) / `log` / `send_notification` (in-app row). Any failure, including a step that touches no row, rolls everything back.
2. **After commit, in declared order**: push delivery, `send_email`, `call_webhook`, `trigger_workflow`. Each result is returned in `effects[]`; a failed effect is reported, never hidden, and never undoes phase 1.

Every value reaches SQL as a bound parameter. Event ids and payloads are validated at runtime (`__proto__` and unknown ids are rejected). Workflow chains stop at depth 16.

Requires the tables from `sql-postgres/0003_events.sql`.
