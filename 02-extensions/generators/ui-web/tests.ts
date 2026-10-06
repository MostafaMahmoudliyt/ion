import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from './index.ts';
import { mit, specsOf } from '../../../test/helpers.ts';

let JSDOM: any;
try { ({ JSDOM } = await import('jsdom')); } catch { /* jsdom is a dev dependency of these tests only */ }
const skip = JSDOM ? false : 'install jsdom (dev dependency of ui-web tests) to run';

const files = generate(specsOf());
const arDef = JSON.parse(JSON.stringify(mit));
arDef.entities[0].metadata = { i18n: { ar: { name: 'طالب', plural: 'الطلاب', attributes: { name: 'الاسم' } } } };

interface Opts { perms?: unknown; locale?: string; hash?: string; wrap?: (ds: any) => any; out?: Record<string, string> }

// Loads generated files from disk into jsdom and runs them as scripts: the page under test is exactly what a browser gets.
async function open(o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ion-ui-'));
  for (const [n, c] of Object.entries(o.out ?? files)) writeFileSync(join(dir, n), c);
  writeFileSync(join(dir, 'test.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div>
<script src="app.js"></script>
<script>
  var ds = Ion.createMemoryDataSource();
  if (window.__wrap) ds = window.__wrap(ds);
  window.__ds = ds;
  window.__app = Ion.start({ root: document.getElementById('app'), dataSource: ds, permissions: window.__perms, locale: window.__locale });
</script></body></html>`);
  const dom = await JSDOM.fromFile(join(dir, 'test.html'), {
    runScripts: 'dangerously', resources: 'usable', url: 'file://' + join(dir, 'test.html') + (o.hash ? '#' + o.hash : ''),
    beforeParse(w: any) {
      w.__perms = o.perms === undefined ? '*' : o.perms; w.__locale = o.locale ?? 'en'; w.__wrap = o.wrap;
      w.confirm = () => true; w.alert = (m: string) => { throw new Error('alert: ' + m); };
    },
  });
  await new Promise((r) => dom.window.addEventListener('load', r));
  const doc = dom.window.document;
  const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
  const go = async (hash: string) => { dom.window.location.hash = hash; await tick(); };
  const text = () => doc.body.textContent as string;
  const $ = (s: string) => doc.querySelector(s);
  const $$ = (s: string) => [...doc.querySelectorAll(s)] as any[];
  const click = async (el: any) => { el.click(); await tick(); };
  const btn = (label: string) => $$('button, a').find((b) => b.textContent.trim() === label);
  const spec = dom.window.Ion.spec;
  const src = (id: string) => spec.data_sources.find((d: any) => d.id === id);
  const seed = (id: string, rows: any[]) => rows.map((r) => dom.window.__ds.create(src(id), r));
  await tick();
  return { dom, doc, tick, go, text, $, $$, click, btn, src, seed, ds: dom.window.__ds, win: dom.window };
}

test('ui-web: output files, deterministic, embeds the spec as data, no external requests', () => {
  assert.deepEqual(Object.keys(files), ['app.js', 'styles.css', 'index.html', 'demo.html']);
  assert.deepEqual(files, generate(specsOf()));
  for (const f of ['index.html', 'demo.html']) assert.doesNotMatch(files[f], /https?:\/\//);
  assert.doesNotMatch(files['app.js'], /\beval\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write|import\s*\(|fetch\(['"]http/);
  assert.match(files['index.html'], /permissions: \[\]/); // secure by default
  assert.match(files['demo.html'], /permissions: '\*'/);
  assert.match(files['styles.css'], /--primary: #1E3A8A/);
  assert.match(files['index.html'], /<html lang="ar" dir="rtl">/);
});

test('ui-web: the embedded spec cannot break out of its script tag', () => {
  const def = JSON.parse(JSON.stringify(mit));
  def.entities[0].metadata = { i18n: { en: { name: '</script><script>alert(1)</script>' } } };
  const app = generate(specsOf(def))['app.js'];
  assert.doesNotMatch(app, /<\/script>/i);
});

test('ui-web: nothing is shown without permissions, and a page without permission never fetches data', { skip }, async () => {
  const calls: string[] = [];
  const t = await open({ perms: [], wrap: (ds: any) => new Proxy(ds, { get: (o, k: string) => (typeof o[k] === 'function' ? (...a: any[]) => { calls.push(k); return o[k](...a); } : o[k]) }) });
  assert.match(t.text(), /No permissions were given to this app\./);
  assert.equal(t.$$('nav a').length, 1); // Home only
  await t.go('/students');
  assert.match(t.text(), /You do not have access to this page\./);
  await t.go('/students/new');
  assert.match(t.text(), /You do not have access/);
  assert.deepEqual(calls, []);
});

test('ui-web: permissions as a list or a function filter navigation and actions', { skip }, async () => {
  const t = await open({ perms: ['entity:student:list', 'entity:student:read'] });
  assert.deepEqual(t.$$('nav a').map((a) => a.textContent), ['Home', 'Students']);
  await t.go('/students');
  assert.equal(t.btn('Create'), undefined);
  const t2 = await open({ perms: (k: string) => k.startsWith('entity:course:'), hash: '/courses' });
  assert.ok(t2.btn('Create'));
  assert.deepEqual(t2.$$('nav a').map((a) => a.textContent), ['Home', 'Courses']);
});

test('ui-web: create form validates by widget type, then saves and opens the detail page', { skip }, async () => {
  const t = await open({ hash: '/students/new' });
  assert.match(t.text(), /New Student/);
  assert.equal(t.$('#fld_email').type, 'email');
  assert.equal(t.$('#fld_gpa').step, 'any');
  assert.equal(t.$('#fld_enrolled_at'), null); // auto field is not a form field
  assert.deepEqual([...t.$('#fld_status').options].map((o: any) => o.value), ['', 'active', 'graduated']);
  await t.click(t.btn('Save'));
  assert.equal(t.$$('.row .error').filter((e) => e.textContent === 'Required').length, 2); // name + email
  t.$('#fld_name').value = 'Sara';
  t.$('#fld_email').value = 'sara@mit.test';
  t.$('#fld_gpa').value = '3.5';
  t.$('#fld_status').value = 'active';
  await t.click(t.btn('Save'));
  assert.equal(t.win.location.hash, '#/students/m1');
  assert.match(t.text(), /Sara/);
  assert.match(t.text(), /3\.5/);
  assert.equal(t.ds.get(t.src('students'), 'm1').gpa, 3.5);
});

test('ui-web: edit form loads the row, clears optional fields to null', { skip }, async () => {
  const t = await open();
  t.seed('students', [{ name: 'Sara', email: 's@x.co', gpa: 3.2, status: 'active' }]);
  await t.go('/students/m1/edit');
  assert.equal(t.$('#fld_name').value, 'Sara');
  assert.equal(t.$('#fld_gpa').value, '3.2');
  t.$('#fld_gpa').value = '';
  t.$('#fld_name').value = 'Sara B';
  await t.click(t.btn('Save'));
  const row = t.ds.get(t.src('students'), 'm1');
  assert.equal(row.name, 'Sara B');
  assert.equal(row.gpa, null);
});

test('ui-web: list paginates, sorts, searches and filters', { skip }, async () => {
  const t = await open();
  t.seed('students', Array.from({ length: 25 }, (_, i) => ({ name: `Stu ${String(i).padStart(2, '0')}`, email: `s${i}@x.co`, gpa: i, status: i % 2 ? 'active' : 'graduated' })));
  await t.go('/students');
  assert.equal(t.$$('tbody tr').length, 20);
  assert.match(t.text(), /25 items/);
  assert.match(t.text(), /Page 1 of 2/);
  assert.equal(t.btn('Previous').disabled, true);
  await t.click(t.btn('Next'));
  assert.equal(t.$$('tbody tr').length, 5);
  assert.match(t.text(), /Page 2 of 2/);
  // sort by gpa twice: ascending then descending
  await t.click(t.btn('Gpa'));
  assert.equal(t.$$('th')[2].getAttribute('aria-sort'), 'ascending');
  await t.click(t.btn('Gpa'));
  assert.equal(t.$$('th')[2].getAttribute('aria-sort'), 'descending');
  assert.match(t.$$('tbody tr')[0].textContent, /Stu 24/);
  // search
  t.$('input[type=search]').value = 'stu 07';
  await t.click(t.btn('Search'));
  assert.equal(t.$$('tbody tr').length, 1);
  assert.match(t.text(), /1 items/);
  t.$('input[type=search]').value = '';
  await t.click(t.btn('Search'));
  // enum filter + numeric range filter
  t.$('details summary').click();
  const status = t.$('#f_status');
  status.value = 'active'; status.dispatchEvent(new t.win.Event('change'));
  await t.click(t.btn('Apply'));
  assert.match(t.text(), /12 items/);
  const gte = t.$('#f_gpa'); gte.value = '10'; gte.dispatchEvent(new t.win.Event('change'));
  await t.click(t.btn('Apply'));
  assert.match(t.text(), /7 items/); // odd gpa >= 10: 11,13,...,23 = 7
  await t.click(t.btn('Clear'));
  assert.match(t.text(), /25 items/);
});

test('ui-web: archive from the list removes the row (nothing is deleted)', { skip }, async () => {
  const t = await open();
  t.seed('faculties', [{ name: 'Eng' }, { name: 'Sci' }]);
  await t.go('/faculties');
  assert.equal(t.$$('tbody tr').length, 2);
  await t.click(t.$$('tbody tr')[0].querySelector('button'));
  assert.equal(t.$$('tbody tr').length, 1);
  assert.equal(t.ds.list(t.src('faculties'), { page: 1, pageSize: 10, q: '', sort: '', filters: {} }).total, 1);
});

test('ui-web: relationship sections list, link (with attributes) and unlink on both sides', { skip }, async () => {
  const t = await open();
  const [stu] = t.seed('students', [{ name: 'Sara', email: 's@x.co' }]);
  t.seed('courses', [{ name: 'Algo', code: 'CS1', credits: 4 }]);
  await t.go(`/students/${stu.id}`);
  const section = () => t.$$('section.related').find((s) => /Courses/.test(s.getAttribute('aria-label')));
  assert.ok(section());
  assert.match(section().textContent, /Nothing here yet/);
  await t.click([...section().querySelectorAll('button')].find((b: any) => b.textContent === 'Add'));
  const select = section().querySelector('select');
  assert.deepEqual([...select.options].map((o: any) => o.textContent), ['Select…', 'Algo']);
  select.value = 'm2';
  assert.equal(section().querySelector('#la_enrollment_enrolled_on'), null); // auto attribute is not asked for
  section().querySelector('#la_enrollment_grade').value = '95';
  await t.click([...section().querySelectorAll('button')].find((b: any) => b.textContent === 'Save'));
  assert.match(section().textContent, /Algo/);
  assert.match(section().textContent, /Grade: 95/);
  // the other side sees the same link
  await t.go('/courses/m2');
  const students = t.$$('section.related').find((s) => /Students/.test(s.getAttribute('aria-label')));
  assert.match(students.textContent, /Sara/);
  // unlink from the course side
  await t.click([...students.querySelectorAll('button')].find((b: any) => b.textContent === 'Remove'));
  assert.match(t.$$('section.related').find((s) => /Students/.test(s.getAttribute('aria-label'))).textContent, /Nothing here yet/);
  await t.go(`/students/${stu.id}`);
  assert.match(section().textContent, /Nothing here yet/);
});

test('ui-web: foreign-key fields render as selects of the related entity and persist the choice', { skip }, async () => {
  const t = await open();
  t.seed('professors', [{ name: 'Dr X', email: 'x@x.co' }, { name: 'Dr Y', email: 'y@x.co' }]);
  await t.go('/courses/new');
  const sel = t.$('#fld_professor_id');
  assert.equal(sel.tagName, 'SELECT');
  assert.deepEqual([...sel.options].map((o: any) => o.textContent), ['Select…', 'Dr X', 'Dr Y']);
  assert.equal(t.doc.querySelector('label[for=fld_professor_id]').textContent, 'Professor'); // label from the related entity
  t.$('#fld_name').value = 'Algo'; t.$('#fld_code').value = 'CS1'; t.$('#fld_credits').value = '4.5';
  sel.value = 'm2';
  await t.click(t.btn('Save'));
  assert.match(t.text(), /Enter a whole number/);
  t.$('#fld_credits').value = '4';
  await t.click(t.btn('Save'));
  assert.equal(t.ds.get(t.src('courses'), 'm3').professor_id, 'm2');
});

test('ui-web: ar is the default direction (RTL), switching shows LTR, English fallback for missing Arabic', { skip }, async () => {
  const t = await open({ locale: 'ar', out: generate(specsOf(arDef)) });
  assert.equal(t.$('.ion').getAttribute('dir'), 'rtl');
  assert.match(t.text(), /الطلاب/); // from metadata.i18n
  assert.match(t.text(), /Professors/); // no Arabic supplied: English, not a guess
  assert.match(t.text(), /English/);
  await t.go('/students/new');
  assert.match(t.text(), /طالب جديد/);
  assert.equal(t.doc.querySelector('label[for=fld_name]').textContent.replace(' *', ''), 'الاسم');
  assert.equal(t.doc.querySelector('label[for=fld_email]').textContent.replace(' *', ''), 'Email');
  await t.click(t.btn('English'));
  assert.equal(t.$('.ion').getAttribute('dir'), 'ltr');
  assert.equal(t.$('.ion').getAttribute('lang'), 'en');
  await t.click(t.$$('aside button')[0]);
  assert.equal(t.$('.ion').getAttribute('dir'), 'rtl');
  await t.click(t.btn('إنشاء') ?? t.$$('aside button')[0]);
});

test('ui-web: values are rendered as text, never as markup', { skip }, async () => {
  const t = await open();
  const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  t.seed('students', [{ name: payload, email: 'a@b.co', gpa: 1 }]);
  await t.go('/students');
  await t.go('/students/m1');
  assert.equal(t.doc.querySelectorAll('img').length, 0);
  assert.equal(t.win.__pwned, undefined);
  assert.match(t.text(), /<img src=x/);
  t.seed('professors', [{ name: 'P', email: 'javascript:alert(1)' }]);
});

test('ui-web: notifications can be marked read, activity feed shows event labels', { skip }, async () => {
  const t = await open();
  const [stu] = t.seed('students', [{ name: 'Sara', email: 's@x.co' }]);
  t.ds.__notify(stu.id, 'You are enrolled');
  await t.go(`/students/${stu.id}`);
  const area = () => t.$('section.notifications');
  assert.match(area().textContent, /You are enrolled/);
  await t.click([...area().querySelectorAll('button')].find((b: any) => b.textContent === 'Mark as read'));
  assert.equal([...area().querySelectorAll('button')].filter((b: any) => b.textContent === 'Mark as read').length, 0);
  assert.ok(t.$('section.activity'));
  await t.go('/faculties/none');
  assert.equal(t.$('section.notifications'), null);
  assert.equal(t.$('section.activity'), null);
});

test('ui-web: detail page archives and returns to the list; unknown routes say so', { skip }, async () => {
  const t = await open();
  t.seed('faculties', [{ name: 'Eng' }]);
  await t.go('/faculties/m1');
  assert.match(t.text(), /Eng/);
  await t.click(t.btn('Archive'));
  assert.equal(t.win.location.hash, '#/faculties');
  assert.match(t.text(), /Nothing here yet/);
  await t.go('/nowhere/at/all');
  assert.match(t.text(), /Page not found/);
  await t.go('/faculties/m1');
  assert.match(t.text(), /Something went wrong: Not found/);
});

test('ui-web: REST data source builds the documented requests and surfaces server errors', { skip }, async () => {
  const t = await open();
  const log: any[] = [];
  const respond = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'X', json: async () => body });
  let next: any = respond(200, { items: [], total: 0 });
  const rest = t.win.Ion.createRestDataSource({ baseUrl: 'https://api.test', fetch: async (url: string, init: any) => { log.push([init.method, url, init.body]); return next; } });
  const students = t.src('students');
  const enrollment = students.relations.find((r: any) => r.relationship === 'enrollment');
  const courseSide = t.src('courses').relations.find((r: any) => r.relationship === 'enrollment');
  await rest.list(students, { page: 2, pageSize: 20, q: 'ann & bob', sort: '-gpa', filters: { status: 'active', gpa: { gte: '2', lte: '4' } } });
  assert.deepEqual(log[0], ['GET', 'https://api.test/api/students?page=2&pageSize=20&q=ann%20%26%20bob&sort=-gpa&filter%5Bstatus%5D=active&filter%5Bgpa%5D%5Bgte%5D=2&filter%5Bgpa%5D%5Blte%5D=4', undefined]);
  await rest.get(students, 'a/b');
  assert.equal(log[1][1], 'https://api.test/api/students/a%2Fb');
  await rest.update(students, 'u1', { name: 'N' });
  assert.deepEqual(log[2], ['PATCH', 'https://api.test/api/students/u1', '{"name":"N"}']);
  await rest.archive(students, 'u1');
  assert.deepEqual(log[3].slice(0, 2), ['DELETE', 'https://api.test/api/students/u1']);
  await rest.related(students, enrollment, 's1');
  assert.equal(log[4][1], 'https://api.test/api/students/s1/enrollments');
  await rest.related(t.src('courses'), courseSide, 'c1');
  assert.equal(log[5][1], 'https://api.test/api/courses/c1/enrollments');
  await rest.link(students, enrollment, 's1', 'c1', { grade: 90 });
  assert.deepEqual(log[6], ['POST', 'https://api.test/api/students/s1/enrollments', '{"toId":"c1","grade":90}']);
  await rest.link(t.src('courses'), courseSide, 'c1', 's1', {}); // linking from the "to" side posts to the "from" entity
  assert.deepEqual(log[7], ['POST', 'https://api.test/api/students/s1/enrollments', '{"toId":"c1"}']);
  await rest.unlink(t.src('courses'), courseSide, 'c1', 's1');
  assert.equal(log[8][1], 'https://api.test/api/students/s1/enrollments/c1');
  next = respond(400, { error: 'name is required' });
  await assert.rejects(rest.create(students, {}), /name is required/);
  next = { ok: false, status: 500, statusText: 'Boom', json: async () => { throw new Error('not json'); } };
  await assert.rejects(rest.get(students, 'x'), /500 Boom/);
  next = respond(204, null);
  assert.equal(await rest.archive(students, 'x'), null);
});
