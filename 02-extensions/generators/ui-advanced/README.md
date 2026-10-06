# ui-advanced

Utility Generator (kind `utility`, target `web/`). Reads `schema_spec` + `ui_spec`; writes `ui_advanced.json` and `ui_advanced.js`.

An **overlay**, not a sixth spec: Core still emits exactly five Specs (section 36). This file is this extension's own output and is plain data. Every value follows a fixed rule from the specs; same specs, same bytes.

| Part | Rule | Drawn by ui-web? |
|---|---|---|
| `flows` | A create form with 5+ fields becomes a wizard: ceil(n/4) steps of near-equal size, in field order, plus a final review step | **yes** (validates each step before moving on; checked in a real browser) |
| `entities.*.empty` | First-use message and an "Add ..." action. Arabic only when the entity has Arabic labels | **yes** (only when the list is empty and nothing is filtered or searched) |
| `entities.*.metrics` | `count`, `avg` per number/integer/money column (a money metric carries `scale`, and its value is in minor units: show it with the same scale as the field), `distribution` per enum column, `trend` of `created_at` per day | no (declared; a backend must compute them) |
| `entities.*.composition` | Detail order: fields, single-valued relations, many-valued relations, notifications, activity | no (declared) |
| `interactions` | Tokens: skeleton loading, highlight on create/update, fade on archive, reduced motion respected | no (declared) |
| `personalization` | Per-user preferences a renderer may remember: locale, sort, page size, filters, search | no (declared) |

Not derivable, so not included: **role-based views.** Ion has no role model, so "admin sees all, professor sees their students" cannot be computed from the specs.

ui-web loads `ui_advanced.js` before `app.js` if it exists and ignores it if it does not. Remove this extension from a build and the UI is exactly the plain one.
