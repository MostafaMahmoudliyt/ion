// Engine 4 — UI Engine: all earlier specs -> ui_spec.json (constitution sections 4, 34).
// Describes pages, fields, widgets and navigation. Emits no HTML, CSS, JS, Swift or Kotlin (section 96):
// any Renderer (web, iOS, Android, desktop, terminal...) turns the same ui_spec into a real UI.
//
// The 20 UI rules (U1-U20) are listed, enforced and tested in rules.ts; this engine produces what they require.
// U1-U10 are the original working set; U11-U20 (dashboard, sort, confirm, states, breadcrumb, responsive,
// labels, directions, page sizes, theme contrast) were added to complete section 17's count of 20.

import { DEFAULT_THEME, LOCALES, WIDGETS } from './constitution.ts';
import { humanize, pathSegment, plural, snake } from './naming.ts';
import { placeRelationship } from './relationship-engine.ts';
import { makeResolver } from './resolve.ts';
import type { Attribute, Entity, Relationship, IonDefinition } from './types.ts';
import type { EventSpec, RelationshipSpec, SchemaSpec, SpecColumn, UiDataSource, UiField, UiPage, UiRelation, UiSpec } from './specs.ts';
import { IonValidationError, validateDefinition } from './validate.ts';
import type { Issue } from './validate.ts';

type I18n = Record<string, { name?: string; plural?: string; attributes?: Record<string, string> }>;
// U19 / U14: fixed, declared once so every build agrees.
const PAGE_SIZES = [10, 20, 50, 100] as const;
const LIST_STATES = {
  empty: { labels: { en: 'Nothing here yet', ar: 'لا توجد سجلات بعد' } },
  loading: { labels: { en: 'Loading…', ar: 'جارٍ التحميل…' } },
  error: { labels: { en: 'Something went wrong', ar: 'حدث خطأ ما' } },
} as const;
const i18nOf = (meta: Record<string, unknown> | undefined): I18n => (meta?.i18n as I18n | undefined) ?? {};

function uiField(a: Attribute | SpecColumn, name: string, ar?: string): UiField {
  const required = 'nullable' in a ? !(a as SpecColumn).nullable : !!(a as Attribute).required;
  const f: UiField = {
    name, type: a.type, widget: WIDGETS[a.type], required, auto: !!a.auto,
    labels: { en: humanize(name), ...(ar ? { ar } : {}) },
  };
  if (a.type === 'enum') f.values = [...((a as Attribute).values ?? [])];
  if (a.type === 'money') f.scale = (a as SpecColumn).scale ?? (a as Attribute).scale ?? 2;
  return f;
}

function displayAttribute(e: Entity): string | null {
  const texty = e.attributes.filter((a) => a.type === 'string' || a.type === 'email');
  return (texty.find((a) => a.name === 'name' || a.name === 'title') ?? texty.find((a) => a.required) ?? texty[0])?.name ?? null;
}

export function generateUiSpec(input: unknown, schema: SchemaSpec, relationships: RelationshipSpec, events: EventSpec): UiSpec {
  const issues = validateDefinition(input);
  if (issues.length) throw new IonValidationError(issues);
  const def = input as IonDefinition;
  const rels = (def.relationships ?? []) as Relationship[];
  const resolve = makeResolver(def.entities);
  const tableOf = new Map(schema.schema_spec.tables.map((t) => [t.entity, t.table]));
  const relSpec = new Map(relationships.relationship_spec.relationships.map((r) => [r.id, r]));
  const problems: Issue[] = [];

  // Which entities have a notification area / an activity feed (rule 8), read from the event_spec.
  const notified = new Set<string>();
  const involved = new Set<string>();
  for (const ev of events.event_spec.events) {
    involved.add(ev.actor); involved.add(ev.target);
    for (const t of ev.triggers) if (t.action === 'send_notification') notified.add(t.to);
  }

  const routes = new Map<string, string>();
  for (const e of def.entities) {
    const seg = pathSegment(e.id);
    const prior = routes.get(seg);
    if (prior !== undefined) problems.push({ code: 'DUPLICATE_ROUTE', path: `entity "${e.id}"`, message: `route "/${seg}" is already used by entity "${prior}"` });
    routes.set(seg, e.id);
  }
  if (problems.length) throw new IonValidationError(problems);

  const apiPath = (relId: string, operation: string, needle?: string): string => {
    const r = relSpec.get(relId);
    const hit = r?.apis.find((x) => x.operation === operation && (!needle || x.path.includes(needle)));
    if (!hit) throw new IonValidationError([{ code: 'SPEC_MISMATCH', path: `relationship "${relId}"`, message: `no ${operation} endpoint in relationship_spec` }]);
    return hit.path;
  };

  // Relationships touching each entity, in definition order: keeps the build linear in entities + relationships.
  const ends = new Map<Relationship, { from: Entity; to: Entity }>();
  const touching = new Map<string, Relationship[]>();
  for (const rel of rels) {
    const from = resolve(rel.from)!;
    const to = resolve(rel.to)!;
    ends.set(rel, { from, to });
    (touching.get(from.id) ?? touching.set(from.id, []).get(from.id)!).push(rel);
    if (to.id !== from.id) (touching.get(to.id) ?? touching.set(to.id, []).get(to.id)!).push(rel);
  }

  const dataSources: UiDataSource[] = [];
  const pages: UiPage[] = [];
  const permissions: string[] = [];

  for (const e of def.entities) {
    const i18n = i18nOf(e.metadata);
    const route = pathSegment(e.id);
    const table = tableOf.get(e.id)!;

    const labels: UiDataSource['labels'] = {
      en: { singular: i18n.en?.name ?? e.name, plural: i18n.en?.plural ?? humanize(plural(snake(e.name))) },
    };
    if (i18n.ar) labels.ar = { singular: i18n.ar.name ?? labels.en.singular, plural: i18n.ar.plural ?? i18n.ar.name ?? labels.en.plural };

    // rules 2 + 3: every attribute is a field; its type picks the widget
    const fields: UiField[] = e.attributes.map((a) => uiField(a, a.name, i18n.ar?.attributes?.[a.name]));

    // Foreign keys the relationship_spec stores on this entity's table become `relation` selects.
    for (const rel of touching.get(e.id) ?? []) {
      const { from, to } = ends.get(rel)!;
      const place = placeRelationship(rel, from, to);
      const fk = relSpec.get(rel.id)?.foreign_key;
      if (place.kind !== 'fk' || !fk || fk.table !== table) continue;
      const labelEntity = rel.type !== 'self' ? place.target.id : undefined;
      const targetEn = i18nOf(place.target.metadata).en?.name ?? place.target.name;
      const existing = fields.find((f) => f.name === place.column);
      if (existing) {
        existing.widget = 'relation'; existing.target = place.target.id; existing.relationship = rel.id;
        if (labelEntity) {
          // The label is the related entity's name, unless the author wrote one for this attribute.
          if (!i18n.en?.attributes?.[place.column]) existing.labels.en = targetEn;
          if (!i18n.ar?.attributes?.[place.column]) existing.label_entity = labelEntity;
        }
      } else {
        fields.push({
          name: place.column, type: 'uuid', widget: 'relation', required: false, auto: false,
          labels: { en: rel.type === 'self' ? humanize(rel.id) : targetEn },
          target: place.target.id, relationship: rel.id, ...(labelEntity ? { label_entity: labelEntity } : {}),
        });
      }
      for (const a of fk.attributes) fields.push(uiField(a.attribute, a.column));
    }
    fields.push({ name: 'created_at', type: 'timestamp', widget: 'datetime', required: false, auto: true, system: true, labels: { en: 'Created', ar: 'تاريخ الإنشاء' } });

    // rules 5, 6, 7
    const listable = fields.filter((f) => !f.system && f.widget !== 'json' && f.widget !== 'relation');
    const columns = [...listable.slice(0, 7).map((f) => f.name), 'created_at'];
    const searchFields = e.attributes.filter((a) => ['string', 'email', 'url', 'phone'].includes(a.type)).map((a) => a.name);
    const filters = e.attributes.flatMap((a): UiDataSource['filters'] => {
      if (a.type === 'enum') return [{ field: a.name, kind: 'select', values: [...(a.values ?? [])] }];
      if (a.type === 'boolean') return [{ field: a.name, kind: 'boolean' }];
      if (['date', 'timestamp', 'number', 'integer', 'money'].includes(a.type)) return [{ field: a.name, kind: 'range', type: a.type }];
      return [];
    });

    // rule 4: every relationship appears on both of its entities
    const relations: UiRelation[] = [];
    for (const rel of touching.get(e.id) ?? []) {
      const { from, to } = ends.get(rel)!;
      const sides: Array<'from' | 'to'> = [];
      if (from.id === e.id) sides.push('from');
      if (to.id === e.id) sides.push('to');
      for (const side of sides) {
        const other = side === 'from' ? to : from;
        const many = rel.type === 'many-to-many' ? true : rel.type === 'one-to-many' ? side === 'from' : rel.type === 'many-to-one' ? side === 'to' : rel.type === 'one-to-one' ? false : side === 'to';
        relations.push({
          relationship: rel.id, side, other: other.id, type: rel.type, many,
          title: rel.type === 'self' ? { text: humanize(rel.id), reverse: side === 'to' } : { entity: other.id },
          attributes: (rel.attributes ?? []).map((a) => uiField(a, a.name)),
          paths: {
            list: side === 'from' ? apiPath(rel.id, 'read', ':fromId') : apiPath(rel.id, 'read', ':toId'),
            create: apiPath(rel.id, 'create'), update: apiPath(rel.id, 'update'), delete: apiPath(rel.id, 'delete'),
          },
        });
      }
    }
    const seen = new Map<string, number>();
    for (const r of relations) if (r.title.entity) seen.set(r.title.entity, (seen.get(r.title.entity) ?? 0) + 1);
    for (const r of relations) if (r.title.entity && (seen.get(r.title.entity) ?? 0) > 1) r.title.suffix = humanize(r.relationship);

    const root = `/api/${route}`;
    const surfaces = { notifications: notified.has(e.id), activity: involved.has(e.id) };
    dataSources.push({
      id: table, entity: e.id, labels, display: displayAttribute(e), fields, relations, filters, search_fields: searchFields, surfaces,
      api: {
        list: { method: 'GET', path: root }, create: { method: 'POST', path: root }, read: { method: 'GET', path: `${root}/:id` },
        update: { method: 'PATCH', path: `${root}/:id` }, archive: { method: 'DELETE', path: `${root}/:id` },
        notifications: surfaces.notifications ? { method: 'GET', path: `${root}/:id/notifications` } : undefined,
        activity: surfaces.activity ? { method: 'GET', path: `${root}/:id/activity` } : undefined,
      },
    });
    for (const k of ['list', 'read', 'create', 'update', 'archive']) permissions.push(`entity:${e.id}:${k}`);

    // rule 1: four pages. "new" is listed before ":id" so it is never read as an id.
    const pageLabels = (en: string, ar?: string): { en: string; ar?: string } => ({ en, ...(ar ? { ar } : {}) });
    const L = labels;
    pages.push(
      { id: `${e.id}_list`, title: L.en.plural, labels: pageLabels(L.en.plural, L.ar?.plural), type: 'list', data_source: table, path: `/${route}`,
        columns, layout: 'table', actions: ['view', 'edit', 'delete'], pagination: { size: 20 }, search: searchFields.length > 0, filters: filters.map((f) => f.field), permission: `entity:${e.id}:list`,
        sort: { field: 'created_at', direction: 'desc' }, page_sizes: [...PAGE_SIZES], confirm: ['delete'], states: { ...LIST_STATES }, responsive: { compact: 'cards', regular: 'table' }, breadcrumb: [`${e.id}_list`] },
      { id: `${e.id}_create`, title: `New ${L.en.singular}`, labels: pageLabels(`New ${L.en.singular}`, L.ar ? `${L.ar.singular} جديد` : undefined), type: 'form', mode: 'create', data_source: table, path: `/${route}/new`,
        fields: fields.filter((f) => !f.auto).map((f) => f.name), submit_action: `${e.id}.create`, permission: `entity:${e.id}:create`, breadcrumb: [`${e.id}_list`, `${e.id}_create`] },
      { id: `${e.id}_detail`, title: L.en.singular, labels: pageLabels(L.en.singular, L.ar?.singular), type: 'detail', data_source: table, path: `/${route}/:id`,
        fields: fields.map((f) => f.name), permission: `entity:${e.id}:read`, confirm: ['delete'], breadcrumb: [`${e.id}_list`, `${e.id}_detail`] },
      { id: `${e.id}_edit`, title: `Edit ${L.en.singular}`, labels: pageLabels(`Edit ${L.en.singular}`, L.ar ? `تعديل ${L.ar.singular}` : undefined), type: 'form', mode: 'edit', data_source: table, path: `/${route}/:id/edit`,
        fields: fields.filter((f) => !f.auto).map((f) => f.name), submit_action: `${e.id}.update`, permission: `entity:${e.id}:update`, breadcrumb: [`${e.id}_list`, `${e.id}_detail`, `${e.id}_edit`] },
    );
  }

  for (const rel of rels) permissions.push(`relationship:${rel.id}:read`, `relationship:${rel.id}:link`, `relationship:${rel.id}:unlink`);

  const eventLabels = (def.events ?? []).map((ev) => {
    const i = i18nOf(ev.metadata);
    return { id: ev.id, labels: { en: i.en?.name ?? ev.name, ...(i.ar?.name ? { ar: i.ar.name } : {}) }, type: ev.type ?? 'custom' };
  });

  return {
    ui_spec: {
      locales: [...LOCALES], default_locale: 'ar',
      pages, data_sources: dataSources, events: eventLabels,
      navigation: { type: 'sidebar', items: dataSources.map((d) => d.id) },
      dashboard: { path: '/', widgets: dataSources.map((d) => ({ kind: 'count' as const, data_source: d.id, permission: `entity:${d.entity}:list`, labels: d.labels.ar ? { en: d.labels.en.plural, ar: d.labels.ar.plural } : { en: d.labels.en.plural } })) },
      directions: { ar: 'rtl', en: 'ltr' },
      theme: { ...DEFAULT_THEME }, permissions,
    },
  };
}
