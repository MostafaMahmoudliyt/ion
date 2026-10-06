# api-rest

API Generator (kind `api`). Reads `relationship_spec` + `ui_spec`; writes `routes.js`.

`routes` is a frozen, sorted list of `{ method, path, resource, operation, handler }`: entity CRUD, relationship links, notifications, activity.
Every path the generated UI calls is in the table (tested), so the UI and the API cannot drift.

This is a **route table only**. It does not implement handlers or a server.
