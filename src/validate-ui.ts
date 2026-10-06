// Validation of the optional display metadata the UI Engine reads (law 11, 33):
//   entity.metadata.i18n.<ar|en> = { name, plural, attributes: { <attribute>: label } }
//   event.metadata.i18n.<ar|en>  = { name }
// Metadata stays optional and free-form everywhere else; only this one key is checked.

import { LOCALES } from './constitution.ts';

type Add = (code: string, path: string, message: string) => void;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '' && v.length <= 200;

function checkI18n(meta: unknown, path: string, add: Add, allowed: string[], attributeNames?: Set<string>): void {
  if (!isObj(meta) || meta.i18n === undefined) return;
  const i18n = meta.i18n;
  const base = `${path}.metadata.i18n`;
  if (!isObj(i18n)) { add('INVALID_I18N', base, 'i18n must be an object keyed by locale'); return; }
  for (const [locale, entry] of Object.entries(i18n)) {
    const p = `${base}.${locale}`;
    if (!(LOCALES as readonly string[]).includes(locale)) { add('INVALID_I18N', p, `locale must be one of: ${LOCALES.join(', ')}`); continue; }
    if (!isObj(entry)) { add('INVALID_I18N', p, 'locale entry must be an object'); continue; }
    for (const [k, v] of Object.entries(entry)) {
      if (!allowed.includes(k)) { add('INVALID_I18N', `${p}.${k}`, `unknown key; allowed: ${allowed.join(', ')}`); continue; }
      if (k === 'attributes') {
        if (!isObj(v)) { add('INVALID_I18N', `${p}.attributes`, 'attributes must be an object of labels'); continue; }
        for (const [attr, label] of Object.entries(v)) {
          if (attributeNames && !attributeNames.has(attr)) add('UNKNOWN_ATTRIBUTE', `${p}.attributes.${attr}`, `no attribute "${attr}" on this entity`);
          if (!text(label)) add('INVALID_I18N', `${p}.attributes.${attr}`, 'label must be a non-empty string (max 200 characters)');
        }
      } else if (!text(v)) add('INVALID_I18N', `${p}.${k}`, `${k} must be a non-empty string (max 200 characters)`);
    }
  }
}

export function validateI18n(def: Obj, add: Add): void {
  if (Array.isArray(def.entities)) {
    def.entities.forEach((e: unknown, i: number) => {
      if (!isObj(e)) return;
      const names = new Set((Array.isArray(e.attributes) ? e.attributes : []).filter(isObj).map((a) => String(a.name)));
      checkI18n(e.metadata, `$.entities[${i}]`, add, ['name', 'plural', 'attributes'], names);
    });
  }
  if (Array.isArray(def.events)) {
    def.events.forEach((ev: unknown, i: number) => { if (isObj(ev)) checkI18n(ev.metadata, `$.events[${i}]`, add, ['name']); });
  }
}
