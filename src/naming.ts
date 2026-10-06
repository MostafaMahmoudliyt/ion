export function snake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
    .toLowerCase();
}

export function kebab(input: string): string {
  return snake(input).replace(/_/g, '-');
}

const IRREGULAR: Array<[string, string]> = [
  ['person', 'people'],
  ['child', 'children'],
];

// Deterministic English pluralisation of the last word of a snake_case name.
export function plural(word: string): string {
  for (const [singular, pl] of IRREGULAR) {
    if (word.endsWith(singular)) return word.slice(0, -singular.length) + pl;
  }
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es';
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

export function tableName(entityId: string): string {
  return plural(snake(entityId));
}

export function pathSegment(id: string): string {
  return kebab(plural(snake(id)));
}

// Human label from a snake/camel identifier: "enrolled_at" -> "Enrolled at".
export function humanize(id: string): string {
  const words = snake(id).split('_').filter(Boolean).join(' ');
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

// Event ids that differ only by "." versus "_" are the same event to every generator.
export function eventKey(eventId: string): string {
  return eventId.split(/[._]/).filter(Boolean).join('.');
}
