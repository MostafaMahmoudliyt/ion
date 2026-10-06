// Utility Generator / UI enhancements (constitution sections 38-40, 47). An Extension, not Core.
// schema_spec + ui_spec -> ui_advanced.json: a deterministic OVERLAY, not a sixth spec. Core still emits exactly
// five Specs (section 36); this file is this extension's own output, like routes.js or app.js, and is plain data.
// Every value is derived by a fixed rule from the specs. Nothing is guessed, nothing depends on runtime data.

type Obj = Record<string, any>; // validated spec JSON

export const WIZARD_MIN_FIELDS = 5; // a create form with this many fields or more becomes a wizard
export const STEP_MAX_FIELDS = 4; // ...with at most this many fields per step, split as evenly as possible

const embed = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const bi = (en: string, ar?: string): { en: string; ar?: string } => (ar === undefined ? { en } : { en, ar });

// n names -> ceil(n / STEP_MAX_FIELDS) steps whose sizes differ by at most one (extra fields go to the first steps).
export function chunk(names: string[]): string[][] {
  const steps = Math.ceil(names.length / STEP_MAX_FIELDS);
  const base = Math.floor(names.length / steps);
  const extra = names.length % steps;
  const out: string[][] = [];
  let at = 0;
  for (let k = 0; k < steps; k++) {
    const size = base + (k < extra ? 1 : 0);
    out.push(names.slice(at, at + size));
    at += size;
  }
  return out;
}

export function overlay(specs: Obj): Obj {
  const ui = specs.ui_spec.ui_spec;
  const tables = new Map<string, Obj>((specs.schema_spec.schema_spec.tables as Obj[]).map((t) => [t.table, t]));

  // ---- flows: long create forms become wizards (a final review step shows the values before saving)
  const flows: Obj = {};
  for (const p of ui.pages as Obj[]) {
    if (p.type !== 'form' || p.mode !== 'create' || p.fields.length < WIZARD_MIN_FIELDS) continue;
    const steps = chunk(p.fields as string[]).map((fields, i) => ({ id: `step_${i + 1}`, fields, labels: bi(`Part ${i + 1}`, `الجزء ${i + 1}`) }));
    steps.push({ id: 'review', fields: [], labels: bi('Review', 'مراجعة') });
    flows[p.id] = { kind: 'wizard', steps };
  }

  // ---- entities: first-use empty state, analytics metrics, detail composition
  const entities: Obj = {};
  for (const d of ui.data_sources as Obj[]) {
    const sg = d.labels.en.singular as string, pl = d.labels.en.plural as string;
    const sgAr = d.labels.ar?.singular as string | undefined, plAr = d.labels.ar?.plural as string | undefined;
    const label = (name: string): { en: string; ar?: string } => (d.fields as Obj[]).find((f) => f.name === name)?.labels ?? { en: name };
    const perm = `entity:${d.entity}:list`;

    const metrics: Obj[] = [{ id: 'count', kind: 'count', permission: perm, labels: bi(`Total ${pl}`, plAr === undefined ? undefined : `إجمالي ${plAr}`) }];
    for (const c of (tables.get(d.id)?.columns ?? []) as Obj[]) {
      if (c.system || c.auto) continue;
      const l = label(c.name);
      if (c.type === 'number' || c.type === 'integer' || c.type === 'money') metrics.push({ id: `avg_${c.name}`, kind: 'avg', field: c.name, ...(c.type === 'money' ? { scale: c.scale ?? 2 } : {}), permission: perm, labels: bi(`Average ${l.en}`, l.ar === undefined ? undefined : `متوسط ${l.ar}`) });
      else if (c.type === 'enum') metrics.push({ id: `distribution_${c.name}`, kind: 'distribution', field: c.name, permission: perm, labels: bi(`${l.en} breakdown`, l.ar === undefined ? undefined : `توزيع ${l.ar}`) });
    }
    metrics.push({ id: 'trend_created_at', kind: 'trend', field: 'created_at', bucket: 'day', permission: perm, labels: bi(`${pl} added per day`, plAr === undefined ? undefined : `${plAr}: الإضافات اليومية`) });

    // Detail composition: the entity's own fields, then single-valued relations, then many-valued ones, then the surfaces.
    const rels = (d.relations ?? []) as Obj[];
    const detail: Obj[] = [{ kind: 'fields' }];
    for (const r of [...rels.filter((x) => !x.many), ...rels.filter((x) => x.many)]) detail.push({ kind: 'relation', relationship: r.relationship, side: r.side });
    if (d.surfaces?.notifications) detail.push({ kind: 'notifications' });
    if (d.surfaces?.activity) detail.push({ kind: 'activity' });

    entities[d.entity] = {
      empty: { message: bi(`Start by adding your first ${sg}`, sgAr === undefined ? undefined : `ابدأ بإضافة ${sgAr}`), action: bi(`Add ${sg}`, sgAr === undefined ? undefined : `إضافة ${sgAr}`) },
      metrics,
      composition: { detail },
    };
  }

  return {
    ui_advanced: {
      profile: 'advanced',
      derived_from: ['schema_spec', 'ui_spec'],
      flows,
      entities,
      // Tokens only: how a renderer should animate, never code. Reduced motion is always respected.
      interactions: { loading: 'skeleton', on_create: 'highlight', on_update: 'highlight', on_archive: 'fade-out', duration_ms: 180, reduced_motion: 'respect' },
      // Per-user view preferences a renderer may remember. Role-based views are NOT derivable: Ion has no role model.
      personalization: { scope: 'user', persist: ['locale', 'list.sort', 'list.page_size', 'list.filters', 'list.search'] },
    },
  };
}

export function generate(specs: Obj): Record<string, string> {
  const o = overlay(specs);
  return {
    'ui_advanced.json': JSON.stringify(o, null, 2) + '\n',
    // Classic script so index.html also works from disk (no fetch). Data assigned to one global, nothing else.
    'ui_advanced.js': '// Ion ui-advanced overlay. Deterministic data; generated, do not edit.\nwindow.ION_ADVANCED = ' + embed(o.ui_advanced) + ';\n',
  };
}
