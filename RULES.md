# The 45 rules (constitution section 17)

Status: **proposed, pending vision-owner approval (section 112).** The constitution fixes the counts (10 / 5 / 10 / 20 / 0) but never lists the rules; this is the list the code enforces. Each rule is an executable check in `src/rules.ts`, run by `validateSpecs` (so every generator is protected), and each is broken on purpose in `test/rules.test.ts`.

`origin: added` marks the ten rules introduced to complete the UI engine (U11-U20); every other rule describes behaviour the engines already had. Metadata (3.1.0) added **no rule**: its spec-level checks live inside S6, R1 and E3.

## Schema Engine (10)

| Id | Rule | Origin |
|---|---|---|
| S1 | One table per entity: entity ids and table names are unique | existing |
| S2 | Every table owns the system columns id (uuid, primary, auto), created_at and archived_at | existing |
| S3 | Exactly one primary column per table, and it is id | existing |
| S4 | Columns use only the 13 Ion attribute types, never a platform type | existing |
| S5 | Every column states its nullability explicitly (required attribute = not nullable) | existing |
| S6 | Column flags are literal true, a default has the column type, and enum transitions only use the enum values | existing |
| S7 | auto is only for date, timestamp and uuid, and never together with a default | existing |
| S8 | enum columns carry a non-empty list of unique values; no other type has values | existing |
| S9 | Row-level security is declared on every table | existing |
| S10 | Nothing is deleted: every table is archivable through archived_at | existing |

## Relationship Engine (5)

| Id | Rule | Origin |
|---|---|---|
| R1 | One of the 5 types, exactly one storage form (junction for many-to-many, foreign key otherwise), and cascade is restrict or archive when present | existing |
| R2 | Placement is fixed by type: one-to-many holds the key in "to"; many-to-one, one-to-one and self in "from" | existing |
| R3 | Every reference resolves to a real table.column, and both ends are entities of the schema | existing |
| R4 | Uniqueness covers active rows only, so archiving never blocks re-linking | existing |
| R5 | Every relationship exposes create, read, update and delete endpoints, with no duplicate method+path | existing |

## Event Engine (10)

| Id | Rule | Origin |
|---|---|---|
| E1 | Event ids are dotted lower-case, unique, and unambiguous between "." and "_" | existing |
| E2 | Actor and target are entities of the schema | existing |
| E3 | Event type is one of create, update, delete, custom, and a rate limit is whole numbers max per seconds | existing |
| E4 | An event that names a relationship names one that exists | existing |
| E5 | Triggers use only the 10 declared actions | existing |
| E6 | Every trigger is fully resolved: entity, attribute and row (actor or target) are never left implicit | existing |
| E7 | Trigger attributes exist in the schema; increment and decrement act on numbers, send_email on an email column | existing |
| E8 | trigger_workflow points at a declared event and the chain never loops | existing |
| E9 | Webhook targets are http(s) URLs without embedded credentials | existing |
| E10 | Once events exist: ledger and audit are append-only, notifications exist, and each event declares compensations | existing |

## UI Engine (20)

| Id | Rule | Origin |
|---|---|---|
| U1 | Four pages per entity: list, create, detail, edit, each with its own path | existing |
| U2 | Every declared attribute is a field, and forms offer exactly the non-automatic fields | existing |
| U3 | The attribute type picks the widget (relation fields are uuid and name their target) | existing |
| U4 | Every relationship appears as a related-items section on both of its entities | existing |
| U5 | Lists paginate with a positive page size | existing |
| U6 | Lists filter every enum, boolean, number, integer, date and timestamp field | existing |
| U7 | Lists search the text fields (string, email, url, phone) and say so with search:true | existing |
| U8 | Events surface as a notification area (receivers) and an activity feed (actors and targets) | existing |
| U9 | Permissions: a key per page and per action; every page names a declared key | existing |
| U10 | Locales include ar and en, the default is one of them, and every entity has an English name | existing |
| U11 | A dashboard home page shows one count widget per data source, guarded by that list permission | added |
| U12 | Every list has a declared default sort on an existing field | added |
| U13 | Archiving always asks for confirmation (lists with a delete action, and detail pages) | added |
| U14 | Every list declares empty, loading and error states with an English label | added |
| U15 | Every page declares a breadcrumb that starts at its entity list and ends at itself | added |
| U16 | Every list says how it adapts: cards on compact screens, a table on regular ones | added |
| U17 | Every page, field and related-items section has an English label (the accessible name) | added |
| U18 | Text direction is declared per locale (ar rtl, en ltr), never guessed by a renderer | added |
| U19 | Lists offer ascending page sizes (max 100) that include the default size | added |
| U20 | The theme colour is #rrggbb with at least 4.5:1 contrast on white, and density is compact, medium or comfortable | added |

## Publish Engine (0)

Uses the four Specs above and adds no rule of its own (section 17).
