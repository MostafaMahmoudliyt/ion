// API Generator: REST (constitution section 49). An Extension, not Core.
// Emits the route table; it does not implement handlers or a server.
type Obj = Record<string, any>; // validated spec JSON

const pascal = (s: string): string => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');

export function generate(specs: Obj): Record<string, string> {
  const routes: Obj[] = [];
  const names = new Set<string>();
  const push = (r: Obj): void => {
    let handler = r.handler as string;
    for (let n = 2; names.has(handler); n++) handler = `${r.handler}${n}`; // a clash never silently shadows a route
    names.add(handler);
    routes.push({ ...r, handler });
  };

  const ui = specs.ui_spec.ui_spec;
  let anyNotifications = false;
  for (const d of ui.data_sources) {
    const E = pascal(d.entity);
    const P = pascal(d.id);
    const a = d.api;
    push({ method: a.list.method, path: a.list.path, resource: d.entity, operation: 'list', handler: `list${P}` });
    push({ method: a.create.method, path: a.create.path, resource: d.entity, operation: 'create', handler: `create${E}` });
    push({ method: a.read.method, path: a.read.path, resource: d.entity, operation: 'read', handler: `get${E}` });
    push({ method: a.update.method, path: a.update.path, resource: d.entity, operation: 'update', handler: `update${E}` });
    push({ method: a.archive.method, path: a.archive.path, resource: d.entity, operation: 'archive', handler: `archive${E}` });
    if (a.notifications) { push({ method: a.notifications.method, path: a.notifications.path, resource: d.entity, operation: 'notifications', handler: `list${E}Notifications` }); anyNotifications = true; }
    if (a.activity) push({ method: a.activity.method, path: a.activity.path, resource: d.entity, operation: 'activity', handler: `list${E}Activity` });
  }
  if (anyNotifications) push({ method: 'PATCH', path: '/api/notifications/:id/read', resource: 'notification', operation: 'update', handler: 'markNotificationRead' });

  for (const r of specs.relationship_spec.relationship_spec.relationships) {
    const R = pascal(r.id);
    for (const api of r.apis) {
      const handler = api.operation === 'create' ? `create${R}`
        : api.operation === 'update' ? `update${R}`
        : api.operation === 'delete' ? `archive${R}`
        : api.path.includes(':toId') && !api.path.includes(':fromId') ? `list${R}Reverse` : `list${R}`;
      push({ method: api.method, path: api.path, resource: r.id, operation: api.operation, handler });
    }
  }

  // Deterministic: sorted by path then method, so reordering the definition cannot reorder the file.
  routes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.method < y.method ? -1 : x.method > y.method ? 1 : 0));
  const js =
    '// Ion api-rest. Deterministic: same specs => same output. Generated, do not edit.\n' +
    '// Path parameters: :id for entity routes; :fromId and :toId for relationship routes.\n' +
    `export const routes = Object.freeze([\n${routes.map((r) => '  ' + JSON.stringify(r) + ',').join('\n')}\n]);\n`;
  return { 'routes.js': js };
}
