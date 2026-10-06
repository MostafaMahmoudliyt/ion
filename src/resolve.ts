// Resolves an entity reference: exact entity id first, then a unique entity name.
// Shared by relationships (engine 2), events (engine 3) and the UI (engine 4).
export function makeResolver<T extends { id: string; name: string }>(entities: T[]) {
  const byId = new Map<string, T>();
  const byName = new Map<string, T[]>();
  for (const e of entities) {
    if (!byId.has(e.id)) byId.set(e.id, e);
    const list = byName.get(e.name);
    if (list) list.push(e);
    else byName.set(e.name, [e]);
  }
  return (ref: unknown): T | undefined => {
    if (typeof ref !== 'string') return undefined;
    const direct = byId.get(ref);
    if (direct) return direct;
    const named = byName.get(ref);
    return named && named.length === 1 ? named[0] : undefined;
  };
}

