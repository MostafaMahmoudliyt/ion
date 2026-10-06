# Ion 3.0.0 — Core (5 Spec engines) + Extensions

Implements the Sovereign Constitution v3.0.0: **Core produces Specs (JSON) and never code; code comes from Generators and Renderers, which are Extensions.**

```
definition.json ──► Schema ► Relationship ► Event ► UI   (Core: 4 engines, zero dependencies)
                      │            │           │      │
                schema_spec  relationship_spec  event_spec  ui_spec        (specs/*.json)
                      │            │           │      │
                      └────────────┴─────┬─────┴──────┘
                                  Extensions (02-extensions/)
        sql-postgres · events-node-postgres · api-rest · ui-web        (SQL, JS, HTML/CSS/JS)
```

Delivered: Schema, Relationship, Event, UI and **Publish** engines (the fifth Spec, `uapp_spec.json`), Spec Loader/Validator, generator contract and registry, four extensions, the `.ion` Spec Bundle, the `.uapp` deployed-app layout, the Library API (3 methods) and all 8 CLI commands.
Renderers and cloud: `ui-terminal`, `ui-android`, `ui-ios`, `ui-desktop`, `cloud-cloudflare` (see the status table below). Not here: Flutter / React Native / Watch / TV renderers, other clouds (AWS, Vercel, Netlify...), MongoDB / GraphQL generators: each is one more extension, no change to Core.

## Extensions: what each one is, and how far it was verified

| Extension | Target folder in the .uapp | Output | Verified here |
|---|---|---|---|
| `sql-postgres` | `backend/database/` | SQL migrations | tests + real PostgreSQL when `ION_PG_URI` is set |
| `events-node-postgres` | `backend/events/` | event handlers | tests + real PostgreSQL when set |
| `api-rest` | `backend/api/` | route table | tests |
| `ui-web` | `web/` | HTML/CSS/JS | tests in jsdom and Chromium when available |
| `ui-terminal` | `terminal/` | `tui.cjs` | **executed**: scripted stdin sessions, a real HTTP server for REST mode, escape-sequence injection |
| `ui-android` | `android/` | Kotlin + Compose Gradle project | structure only: **never compiled** |
| `ui-ios` | `ios/` | SwiftUI sources + XcodeGen `project.yml` | structure only: **never compiled** |
| `ui-desktop` | `desktop/` | Tauri 2 project wrapping `../../web` | structure and path resolution only: never built |
| `cloud-cloudflare` | `cloud/cloudflare/` | `wrangler.toml` serving `../../web` | structure and path resolution only: never deployed |

Android, iOS, Desktop and Cloudflare could not be built or deployed where they were written (no Android SDK, Xcode, Rust or Cloudflare account). Their tests prove the layout, determinism, that every platform embeds the very same `ui_spec`, that the cross-folder paths resolve inside a real `.uapp`, and that no dynamic-code APIs are used. They do not prove the compilers accept the code; expect to fix small errors on the first build and report them. Each README says the same.
Native and terminal renderers cover menu, list (search, paging), detail, create, edit, archive and Arabic RTL; filters, related items, notifications and activity exist only in `ui-web` for now.
`--generators a,b,c` (preview, publish, deploy) chooses the extensions (section 42); the default is every official one, and `deploy` can override the choice recorded in the `.ion`.

## Run it (server-node-sqlite)

`ion publish` + `ion deploy` produce `backend/server/` inside the `.uapp`. It needs only Node 22.13+ (no npm install):

```bash
cd site/university.uapp/backend/server
ION_OWNER_TOKEN='a-long-random-secret' node server.mjs     # http://127.0.0.1:8787
```

One process serves the API and the web UI same-origin, with a sign-in page, SQLite storage, enforced permissions, atomic event execution (notification, counter, audit, ledger, outbox) and the metadata below. Walked end to end in headless Chromium: sign in, empty state, create, 3-step wizard, enrol (fires the event), notification and counter visible. `server.mjs` is one fixed file identical in every build; only `spec.json` changes. See its README for what it deliberately does not do.

## Metadata (3.1.0)

Properties on the three primitives, never a fourth primitive, a sixth engine or a 46th rule. The vocabulary is **closed**: unknown keys are rejected (`UNKNOWN_METADATA`) so nothing is accepted and then ignored. Each key is validated in the definition, carried into the specs, and executed by the server (tests for each, including failure and rollback paths).

| On | Key | Effect |
|---|---|---|
| entity | `versioned: true` | `version` column; every update bumps it; a stale `version` in PATCH is a 409 |
| entity | `indexed: [attr]` | a real index (the test checks the query planner uses it) |
| enum attribute | `transitions: {a: [b]}` | only declared state changes, on PATCH and inside events; new rows start at the default |
| relationship | `cascade: restrict \| archive` | archiving a parent is refused, or archives its children (links are removed, never the other entity) |
| event | `rate: {max, per_seconds}` | 429 past the limit; the refused run leaves nothing behind |

Not implemented, on purpose: ranking formulas, ML, recommendations, auto-scaling, role-based views. A formula string is code (law 10), and "Algorithm = relationship + metadata" renames a capability without providing it. Those need their own runtime design, not a property.

## Amendments

1. **Section 22, attribute types 13 -> 14: `money`.** Approved by the vision owner in conversation (2026-10-06). Additive; no existing definition changes meaning. Reason: amounts were being stored as `number` (a float). Scope: Core validation and engines, the server, PostgreSQL mapping, web and terminal forms, `payable`. Also covered: dashboard metric declarations and the Android, iOS and desktop renderers (native code never compiled; see Money above).

## Metadata processors (extension, 3.2 proposal)

A processor teaches the toolchain what a metadata key *means* without touching Core: it is a JSON manifest (`02-extensions/processors/<id>/processor.json`) that expands a key on an entity into ordinary entities, relationships and events **before** Core runs. The key is consumed, so the Core vocabulary stays closed (`ml_model`, `weighted`... are still `UNKNOWN_METADATA`), and the result is validated by the same 45 rules. No code, no network, no recursion; name collisions are errors (`EXPANSION_CONFLICT`).

| Key | Value | Adds |
|---|---|---|
| `commentable` | `true` | `<entity>_comment` (body) + many-to-one relationship, `cascade: archive` |
| `payable` | `true` or `{currency: USD\|EUR\|EGP\|SAR}` | `<entity>_payment` (amount, currency, status with transitions pending→paid/failed, paid→refunded, versioned, indexed) + relationship, `cascade: restrict` |

`ion build|preview|publish` run the expansion and print what each processor added. Programmatic use: `expandDefinition(def, loadProcessors(dir))` from `02-extensions/processors/expand.ts`.

**Money:** use the `money` attribute type (the 14th, added by constitution amendment). The stored value is whole minor units (12050 = 120.50) in an INTEGER column (BIGINT in PostgreSQL); `scale` (0-4, default 2) only controls how the UI shows and reads it. Decimals and strings are refused by the server, `increment`/`decrement` need whole amounts, and the web and terminal forms convert with string math, so 0.1 + 0.2 is exactly 0.3. A `number` is still a float and is for non-monetary values. Migrating an existing `number` column to `money` is refused (it cannot be reinterpreted safely); `integer` to `money` is a no-op. `payable` uses `money`. Currency is not part of the type: keep it in its own attribute, as `payable` does. Dashboard metrics declare an `avg` per money column (with its `scale`); the web, terminal, Android and iOS forms parse, show and pre-fill it in major units, and the desktop app reuses the web renderer. The Kotlin and Swift code is covered by structural tests only: no Kotlin or Swift compiler was available, so it has never been compiled or run.

What this is **not**: `payable` models the payment *ledger*; it does not call a gateway. Charging a card, training a model, scaling servers or holding a licence still need a real runtime or external service, and an Ion definition cannot make that exist by naming it. A new processor is a few lines of JSON, so more keys can be added without a new engine or rule.

## Roles and permissions (server-node-sqlite)

`roles.json` next to `server.mjs` (or `ION_ROLES`) maps tokens to roles; a role is a list of permissions, optionally `extends` other roles. `*` matches any one segment (`entity:order:*`, `entity:*:read`), a leading `!` removes what it matches and always wins, and a pattern that matches no permission the app declares stops the server at start. Verified on the 46-entity Atlas example with four roles over real HTTP (`scripts/e2e-atlas.py` covers the owner flow).

**Not covered:** this is role-level only. A role that may read `order` reads every order; there is no row-level rule ("my orders only"), no end-user accounts or password sign-in (tokens only), no token expiry or revocation, and `POST /api/events/<id>` is guarded by the actor's `update` permission, not a key of its own. Treat it as access control for staff roles, not yet for a public multi-tenant app.

## Schema migrations (server-node-sqlite)

The server compares the real database with the definition at every start and plans the difference. Additive changes apply automatically in one transaction (recorded in `ion_migrations`); making a column required or optional rebuilds the table and needs `ION_MIGRATE=apply` (a backup file is written first); `ION_MIGRATE=plan` is a read-only dry run. Unsafe changes (type change, required column without default, foreign-key target change) are refused with the reason, and nothing removed from the definition is ever dropped. Verified on a 504,000-row database created by the previous server version: no spurious changes on adoption; a v2 definition (new columns, entity, many-to-many, and a rebuild of the 504k-row table) applied in about 4.5 s with integrity intact.

**Not covered:** SQLite only (the PostgreSQL generators still emit create-only SQL, no migration), renames (a renamed entity or attribute is a new one plus an orphan), type changes, rollback of an applied migration (restore the backup), and a rebuild locks the database while it runs, so it is a maintenance window, not an online change.

## Advanced UI (ui-advanced)

An optional extension (`02-extensions/generators/ui-advanced`, see its README) derives wizard flows for long forms, first-use empty states, analytics metrics, detail composition, interaction tokens and personalization preferences into `web/ui_advanced.json`. It is an overlay, not a sixth spec, and adds no rule to Core. ui-web draws the wizard and the empty state (walked through in headless Chromium with `scripts/e2e-web.py`, no page errors); metrics, composition, interactions and personalization are declared only. Role-based views are not derivable because Ion has no role model. This is a richer UI than the basic one, not a measured "top 0.01%".

## Types and CI for the four unbuilt targets

- `npm run build:types` emits `types/index.d.ts` (one `.d.ts` per module); `package.json` points `types` and `exports` at it. Verified by compiling a strict consumer file against it, including two lines that must fail to compile.
- `.github/workflows/targets.yml` builds what this machine could not: Android (`gradle assembleDebug`), iOS (XcodeGen + `xcodebuild` for the simulator), desktop (Tauri on Linux, macOS and Windows) and Cloudflare (`wrangler deploy --dry-run`; a real deploy only on a manual run with your secrets). **It has not run yet**: until it is green, those four stay unproven, and the status lines in the extension READMEs remain true.

## .ion and .uapp (decision: the uapp conflict)

```
definition ─► Core (5 engines) ─► .ion ─► Generators ─► .uapp/
                                  one JSON file             folder per target + manifest.json
```
- `<app-id>.ion` — Spec Bundle: the 5 Specs + metadata + `manifest_hash` (sha256 over the four spec files). Opening it re-validates every spec and refuses a bundle edited after publishing.
- `<app-id>.uapp/` — a folder, never a single file: `manifest.json` (every file with sha256 and size) plus one sub-folder per extension `target` (`web/`, `backend/database/`, `backend/events/`, `backend/api/`; later `ios/`, `android/`, `desktop/`). `target` is an optional field of an extension's manifest.json (additive, law 17).

## Use

```bash
ion init shop                                            # shop/ion.json (empty definition with an app block)
ion add entity   product.json  --id product  --to shop/ion.json
ion add relation purchase.json --id purchase --to shop/ion.json
ion add event    bought.json   --id customer.bought --to shop/ion.json
ion build   shop/ion.json --out out      # out/specs/{schema,relationship,event,ui,uapp}_spec.json
ion preview shop/ion.json --out out      # + out/generated/<extension>/ for every official extension
ion publish shop/ion.json --out out      # out/shop.ion
ion deploy  out/shop.ion  site           # site/shop.uapp/  (--force replaces an existing .uapp)
# open site/shop.uapp/web/demo.html  (in-memory data, all permissions)
```
(`node src/cli.ts ...` runs the same thing without installing.) `add` takes a JSON file with one entity / relationship / event; `--id` sets its id; nothing is ever replaced and the whole definition is re-validated before it is written.

```js
const ion = new Ion({ app: { id: 'school', name: 'School', domain: 'education' } });
ion.define('entity', 'Student', { type: 'person', attributes: [...] });
ion.define('relationship', 'enrollment', { from: 'student', to: 'course', type: 'many-to-many' });
ion.define('event', 'student.enrolled', { actor: 'student', target: 'course', triggers: [{ action: 'log' }] });
const uapp_spec = await ion.build();
const { file, content } = await ion.publish(uapp_spec);   // school.ion
```

Node >= 22.18 runs the TypeScript directly (no build step). `examples/mit-specs/` holds the specs of the MIT example.

## Tests

```bash
npm install            # dev only: typescript, jsdom, pg. Core itself has no dependencies.
npm run typecheck
npm test                                       # PostgreSQL and jsdom tests skip themselves if unavailable
ION_PG_URI=postgresql://... npm test       # also executes the SQL and the event handlers on a real PostgreSQL
```

Covered: the 45 rules (counts pinned, each one provably fails when broken), the five engines, the .ion/.uapp round trip, every extension (above), validation codes, every engine, spec cross-validation (tampered specs), determinism (byte-identical reruns), performance bounds of section 117, no dependency / eval / platform code in Core, no other project named anywhere,
the generator sandbox (path escape, mutation, manifest, registry), the CLI, the generated SQL on PostgreSQL (constraints, archive-then-relink, append-only records),
the generated handlers on PostgreSQL (atomic rollback, effects after commit, injection stored as data), the generated web app in jsdom and a real Chromium (RTL, forms, paging, relations, XSS).

## Where the constitution is silent or contradicts itself (decisions to confirm)

1. **The 45 rules** are counted in section 17 (10/5/10/20/0) but were never listed. They are now listed in [`RULES.md`](RULES.md) and implemented in `src/rules.ts` as 45 executable checks (S1-S10, R1-R5, E1-E10, U1-U20), run by `validateSpecs` and broken on purpose one by one in `test/rules.test.ts`. **The list is a proposal until the vision owner approves it (section 112).** U1-U10 are the original working set; U11-U20 (dashboard, default sort, archive confirmation, list states, breadcrumbs, responsive layout, accessible labels, declared text direction, page sizes, theme contrast) were added to reach 20. They are declared in `ui_spec` only: `ui-web`, `ui-terminal` and the native renderers do not consume them yet.
2. **Column types.** The section 31 example shows `text` / `numeric`; sections 22, 45 and 114 fix the Ion types (13, then 14 with `money`: see Amendments) and one spec for Postgres and MongoDB. Specs therefore keep Ion types; generators map them.
3. **Spec envelope.** One file holds all entities: `schema_spec.tables[]` (the example shows one table). `entity` is the entity **id** (the example uses the display name), matching `actor`/`target` in the event example.
4. **Section 26 vs section 10.** A "Spec Executor (يُشغّل)" executes; section 10 forbids code execution. Loader and Validator exist (`spec-validate.ts`, `bundle.ts`); no Executor. The Spec Renderer component is `runGenerators` + `buildUapp`.
5. **CLI.** Signatures are fixed, so there is no `--generators` flag: `build` = the 5 specs, `preview` = specs + every `official` extension, `publish` = the `.ion`, `deploy <file.ion> <target-dir>` = the `.uapp`. `uapp_spec.generators_used` lists the official extensions; `deploy` runs those. `add <kind> <def.json> --id <id> [--to <project>]` and `--force` are the only additions (reading of the fixed signature `add entity <def> --id <id>`: `<def>` is a file holding the item).
6. **Section 33 extras.** `channel`, `template`, `level` are accepted as free identifiers and passed through; `compensations` is always `[]`.
7. **Document counts.** Section 125 says 130 sections; the text ends at 129.
8. `events-node-postgres` is tied to PostgreSQL (a stack generator); a MongoDB variant would be another extension. `api-rest` emits a route table only; no server is generated yet. Extensions are `.ts` (Core is TypeScript); folder `02-extensions/` follows section 41.
9. **New names.** `.ion` / `.uapp` follow your decision on the uapp conflict, but law 16 (no new names) and section 35 ("لا bundle") predate it: amend sections 35/36 to bless them (additive, vision-owner approval, section 112).
10. **Phases.** The notes list 7 phases under the title "5 phases". Nothing in the code depends on it.
11. `app` (id, name, domain) is a new optional top-level block of the definition; without it the app is `app` / `App` / `general`. It affects `uapp_spec.json` only, never the other four specs.
