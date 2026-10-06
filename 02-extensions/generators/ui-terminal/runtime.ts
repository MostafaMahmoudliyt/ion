// The fixed runtime of the terminal renderer (constitution section 66). Plain CommonJS, Node >= 18, no dependencies.
// It is a string because the generator ships it verbatim next to the spec; it contains no template literals.
export const RUNTIME_JS = String.raw`
  var readline = require('node:readline');
  var args = process.argv.slice(2);
  function opt(n) { var i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; }
  var DEMO = args.indexOf('--demo') >= 0;
  var API = opt('--api');
  var COLOR = process.stdout.isTTY && !process.env.NO_COLOR && args.indexOf('--no-color') < 0;
  var locale = opt('--locale') || SPEC.default_locale;
  if (SPEC.locales.indexOf(locale) < 0) locale = SPEC.default_locale;

  var TEXT = {
    en: { home: 'Menu', quit: 'q quit', pick: 'Choose', list: '# open | n next | p prev | /text search | c create | b back', detail: 'e edit | d archive | b back',
      none: 'Nothing here.', page: 'Page', of: 'of', total: 'total', saved: 'Saved.', archived: 'Archived.', confirm: 'Archive this item? (y/N)', required: 'is required',
      invalid: 'is not valid', denied: 'You do not have permission to do this.', noperm: 'No permissions granted. Set ION_PERMISSIONS (comma separated keys, or *) or run with --demo.',
      error: 'Error', keep: 'Enter keeps', bye: 'Bye.', create: 'New', related: 'Related' },
    ar: { home: 'القائمة', quit: 'q خروج', pick: 'اختر', list: '# فتح | n التالي | p السابق | /نص بحث | c جديد | b رجوع', detail: 'e تعديل | d أرشفة | b رجوع',
      none: 'لا يوجد شيء هنا.', page: 'الصفحة', of: 'من', total: 'الإجمالي', saved: 'تم الحفظ.', archived: 'تمت الأرشفة.', confirm: 'أرشفة هذا العنصر؟ (y/N)', required: 'مطلوب',
      invalid: 'غير صالح', denied: 'ليس لديك صلاحية لهذا الإجراء.', noperm: 'لا توجد صلاحيات. اضبط ION_PERMISSIONS أو شغّل مع --demo.',
      error: 'خطأ', keep: 'Enter يُبقي', bye: 'إلى اللقاء.', create: 'جديد', related: 'المرتبطة' }
  };
  function t(k) { return (TEXT[locale] || TEXT.en)[k] || TEXT.en[k]; }
  function label(l) { return (l && (l[locale] || l.en)) || ''; }

  // Terminal safety: stored values are data, never escape sequences.
  function clean(v) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' '); }
  function paint(code, s) { return COLOR ? '\u001b[' + code + 'm' + s + '\u001b[0m' : s; }
  var bold = function (s) { return paint('1', s); };
  var dim = function (s) { return paint('2', s); };
  var accent = function (s) { return paint('36', s); };
  var bad = function (s) { return paint('31', s); };
  function say(s) { process.stdout.write(s + '\n'); }

  // ---- permissions (secure by default, like the web renderer)
  var PERMS = DEMO ? '*' : (process.env.ION_PERMISSIONS || '');
  function can(key) { return PERMS === '*' || PERMS.split(',').map(function (x) { return x.trim(); }).indexOf(key) >= 0; }

  // ---- data sources: memory (--demo) or REST (--api <base-url>); same interface
  function fill(tpl, vars) { return tpl.replace(/:(id|fromId|toId)/g, function (_, k) { return encodeURIComponent(vars[k]); }); }
  function rest(base) {
    function call(method, path, body, query) {
      var url = base.replace(/\/$/, '') + path;
      var parts = [];
      Object.keys(query || {}).forEach(function (k) { var v = query[k]; if (v !== undefined && v !== null && v !== '') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v))); });
      if (parts.length) url += '?' + parts.join('&');
      var headers = {};
      if (process.env.ION_TOKEN) headers.Authorization = 'Bearer ' + process.env.ION_TOKEN;
      var init = { method: method, headers: headers };
      if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      return fetch(url, init).then(function (res) {
        if (!res.ok) return res.json().catch(function () { return null; }).then(function (j) { throw new Error(j && j.error ? String(j.error) : res.status + ' ' + res.statusText); });
        return res.status === 204 ? null : res.json();
      });
    }
    return {
      list: function (src, q) { return call('GET', src.api.list.path, undefined, { page: q.page, pageSize: q.pageSize, q: q.q }); },
      get: function (src, id) { return call('GET', fill(src.api.read.path, { id: id })); },
      create: function (src, v) { return call('POST', src.api.create.path, v); },
      update: function (src, id, v) { return call('PATCH', fill(src.api.update.path, { id: id }), v); },
      archive: function (src, id) { return call('DELETE', fill(src.api.archive.path, { id: id })); }
    };
  }
  function memory() {
    var rows = {}, n = 0;
    SPEC.data_sources.forEach(function (d) { rows[d.id] = []; });
    function live(src) { return rows[src.id].filter(function (r) { return !r.archived_at; }); }
    function find(src, id) { var r = live(src).filter(function (x) { return x.id === id; })[0]; if (!r) return Promise.reject(new Error('Not found')); return Promise.resolve(r); }
    return {
      list: function (src, q) {
        var items = live(src);
        if (q.q) { var needle = String(q.q).toLowerCase(); items = items.filter(function (r) { return src.search_fields.some(function (f) { return clean(r[f]).toLowerCase().indexOf(needle) >= 0; }); }); }
        var start = (q.page - 1) * q.pageSize;
        return Promise.resolve({ items: items.slice(start, start + q.pageSize).map(function (r) { return Object.assign({}, r); }), total: items.length });
      },
      get: function (src, id) { return find(src, id).then(function (r) { return Object.assign({}, r); }); },
      create: function (src, v) { n++; var row = Object.assign({ id: 'm' + n, created_at: 'demo', archived_at: null }, v); rows[src.id].push(row); return Promise.resolve(Object.assign({}, row)); },
      update: function (src, id, v) { return find(src, id).then(function (r) { Object.assign(r, v); return Object.assign({}, r); }); },
      archive: function (src, id) { return find(src, id).then(function (r) { r.archived_at = 'archived'; return null; }); }
    };
  }
  var data = API ? rest(API) : memory();

  // ---- input: one line at a time from stdin; EOF ends the program cleanly
  var lines = readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  async function ask(prompt) {
    process.stdout.write(prompt + ' ');
    var r = await lines.next();
    if (r.done) { process.stdout.write('\n'); return null; }
    return r.value.trim();
  }

  // ---- spec lookups
  function srcById(id) { return SPEC.data_sources.filter(function (d) { return d.id === id; })[0]; }
  function pageOf(src, type, mode) { return SPEC.pages.filter(function (p) { return p.data_source === src.id && p.type === type && (!mode || p.mode === mode); })[0]; }
  function field(src, name) { return src.fields.filter(function (f) { return f.name === name; })[0]; }
  function entityName(src, plural) { var l = src.labels[locale] || src.labels.en; return plural ? l.plural : l.singular; }
  // money: the stored value is whole minor units; text <-> units uses string math, never a float
  function moneyShow(v, scale) {
    var n = Number(v); if (!isFinite(n)) return String(v);
    var s = String(Math.abs(n)); scale = scale === undefined ? 2 : scale;
    if (scale > 0) { while (s.length <= scale) s = '0' + s; s = s.slice(0, s.length - scale) + '.' + s.slice(s.length - scale); }
    return (n < 0 ? '-' : '') + s;
  }
  function moneyParse(text, scale) {
    var m = /^(-?)([0-9]+)(?:[.]([0-9]*))?$/.exec(String(text).trim()); scale = scale === undefined ? 2 : scale;
    if (!m) return null;
    var frac = m[3] || ''; if (frac.length > scale) return null;
    while (frac.length < scale) frac += '0';
    var n = Number(m[2] + frac); if (!isFinite(n) || n > 9007199254740991) return null;
    return m[1] ? -n : n;
  }
  function fmt(v, f) {
    if (v === undefined || v === null || v === '') return '-';
    if (f && f.widget === 'checkbox') return v ? 'yes' : 'no';
    if (f && f.widget === 'money') return moneyShow(v, f.scale);
    if (typeof v === 'object') return clean(JSON.stringify(v));
    return clean(v);
  }
  function cut(s, n) { return s.length > n ? s.slice(0, n - 1) + '~' : s; }
  function pad(s, n) { return s + new Array(Math.max(0, n - s.length) + 1).join(' '); }

  // ---- form input -> typed value (null = invalid)
  function coerce(f, text) {
    switch (f.widget) {
      case 'number': { var x = Number(text); return isFinite(x) ? x : null; }
      case 'integer': { var i = Number(text); return Number.isInteger(i) ? i : null; }
      case 'money': return moneyParse(text, f.scale);
      case 'checkbox': { var l = text.toLowerCase(); return ['y', 'yes', 'true', '1'].indexOf(l) >= 0 ? true : ['n', 'no', 'false', '0'].indexOf(l) >= 0 ? false : null; }
      case 'select': return f.values && f.values.indexOf(text) >= 0 ? text : null;
      case 'json': try { return JSON.parse(text); } catch (e) { return null; }
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
      case 'url': return /^https?:\/\/\S+$/.test(text) ? text : null;
      default: return text;
    }
  }

  async function fail(e) { say(bad(t('error') + ': ' + clean(e && e.message ? e.message : e))); }

  async function formScreen(src, mode, row) {
    var page = pageOf(src, 'form', mode);
    if (!page || !can(page.permission)) { say(bad(t('denied'))); return row; }
    say('\n' + bold(label(page.labels)));
    var values = {};
    for (var k = 0; k < page.fields.length; k++) {
      var f = field(src, page.fields[k]);
      if (!f || f.auto) continue;
      for (;;) {
        var hint = f.widget === 'select' ? ' (' + f.values.join('/') + ')' : f.widget === 'checkbox' ? ' (y/n)' : '';
        var cur = row && row[f.name] !== undefined && row[f.name] !== null ? ' [' + fmt(row[f.name], f) + ']' : '';
        var text = await ask(label(f.labels) + (f.required && mode === 'create' ? ' *' : '') + hint + cur + ':');
        if (text === null) return null;
        if (text === '') {
          if (mode === 'create' && f.required) { say(bad(label(f.labels) + ' ' + t('required'))); continue; }
          break;
        }
        var v = coerce(f, text);
        if (v === null) { say(bad(label(f.labels) + ' ' + t('invalid'))); continue; }
        values[f.name] = v;
        break;
      }
    }
    try {
      var saved = mode === 'create' ? await data.create(src, values) : await data.update(src, row.id, values);
      say(accent(t('saved')));
      return saved;
    } catch (e) { await fail(e); return row; }
  }

  async function detailScreen(src, id) {
    var page = pageOf(src, 'detail');
    for (;;) {
      var row;
      try { row = await data.get(src, id); } catch (e) { await fail(e); return; }
      say('\n' + bold(label(page.labels) + (src.display && row[src.display] ? ': ' + clean(row[src.display]) : '')));
      page.fields.forEach(function (n) { var f = field(src, n); if (f) say('  ' + pad(label(f.labels), 18) + ' ' + fmt(row[n], f)); });
      var canEdit = can('entity:' + src.entity + ':update'), canArchive = can('entity:' + src.entity + ':archive');
      var cmd = await ask(dim(t('detail')) + '>');
      if (cmd === null || cmd === 'b' || cmd === '') return;
      if (cmd === 'e' && canEdit) { var r = await formScreen(src, 'edit', row); if (r === null) return; }
      else if (cmd === 'd' && canArchive) {
        var yes = await ask(t('confirm'));
        if (yes === null) return;
        if (yes.toLowerCase() === 'y') { try { await data.archive(src, id); say(accent(t('archived'))); return; } catch (e) { await fail(e); } }
      } else if (cmd === 'e' || cmd === 'd') say(bad(t('denied')));
    }
  }

  async function listScreen(src) {
    var page = pageOf(src, 'list');
    var size = (page.pagination && page.pagination.size) || 20;
    var q = '', n = 1;
    for (;;) {
      var res;
      try { res = await data.list(src, { page: n, pageSize: size, q: q }); } catch (e) { await fail(e); return; }
      var pages = Math.max(1, Math.ceil(res.total / size));
      say('\n' + bold(entityName(src, true)) + dim('  ' + t('page') + ' ' + n + ' ' + t('of') + ' ' + pages + ' | ' + res.total + ' ' + t('total') + (q ? ' | /' + clean(q) : '')));
      var cols = page.columns.map(function (c) { return field(src, c); }).filter(Boolean);
      if (!res.items.length) say(dim(t('none')));
      else {
        var cells = res.items.map(function (r) { return cols.map(function (f) { return cut(fmt(r[f.name], f), 24); }); });
        var widths = cols.map(function (f, i) { return Math.max(label(f.labels).length, Math.min(24, cells.reduce(function (m, r) { return Math.max(m, r[i].length); }, 0))); });
        say(dim('  # ' + cols.map(function (f, i) { return pad(cut(label(f.labels), 24), widths[i]); }).join('  ')));
        cells.forEach(function (r, ri) { say(pad(String(ri + 1), 4) + r.map(function (c, i) { return pad(c, widths[i]); }).join('  ')); });
      }
      var cmd = await ask(dim(t('list')) + '>');
      if (cmd === null || cmd === 'b') return;
      if (cmd === 'n') { if (n < pages) n++; }
      else if (cmd === 'p') { if (n > 1) n--; }
      else if (cmd[0] === '/') { q = cmd.slice(1).trim(); n = 1; }
      else if (cmd === 'c') { if (can('entity:' + src.entity + ':create')) { var made = await formScreen(src, 'create'); if (made === null) return; } else say(bad(t('denied'))); }
      else if (/^\d+$/.test(cmd) && res.items[Number(cmd) - 1]) await detailScreen(src, res.items[Number(cmd) - 1].id);
    }
  }

  async function main() {
    if (!DEMO && !API) { say('Usage: node tui.cjs --demo | --api <base-url> [--locale ar|en] [--no-color]'); process.exitCode = 2; lines.return && lines.return(); return; }
    for (;;) {
      var items = SPEC.navigation.items.map(srcById).filter(function (s) { return s && can('entity:' + s.entity + ':list'); });
      say('\n' + bold(t('home')));
      if (!items.length) { say(bad(t('noperm'))); break; }
      items.forEach(function (s, i) { say('  ' + (i + 1) + '. ' + entityName(s, true)); });
      var c = await ask(dim(t('quit')) + ' | ' + t('pick') + '>');
      if (c === null || c === 'q') break;
      if (/^\d+$/.test(c) && items[Number(c) - 1]) await listScreen(items[Number(c) - 1]);
    }
    say(t('bye'));
    lines.return && lines.return();
  }
  main().catch(function (e) { console.error(e); process.exitCode = 1; });
`;
