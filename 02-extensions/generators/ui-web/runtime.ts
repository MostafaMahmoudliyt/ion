// The fixed half of app.js: identical in every build. Dependency-free, builds the DOM with
// createElement and textContent only (never innerHTML), so no value from a data source can inject markup.
// Written without template literals so it can be embedded as a string.
export const RUNTIME_JS = String.raw`
  // ---------------------------------------------------------------- i18n
  var DICT = {
    en: {
      create: 'Create', edit: 'Edit', save: 'Save', cancel: 'Cancel', archive: 'Archive', search: 'Search', filters: 'Filters',
      any: 'Any', yes: 'Yes', no: 'No', from: 'From', to: 'To', previous: 'Previous', next: 'Next', page: 'Page {page} of {pages}',
      total: '{total} items', empty: 'Nothing here yet.', loading: 'Loading…', error: 'Something went wrong', add: 'Add',
      remove: 'Remove', notifications: 'Notifications', activity: 'Activity', markRead: 'Mark as read',
      noAccess: 'You do not have access to this page.', noPermissions: 'No permissions were given to this app.',
      confirmArchive: 'Archive this item? It can be restored later.', required: 'Required', invalidNumber: 'Enter a valid number',
      invalidInteger: 'Enter a whole number', invalidMoney: 'Enter an amount such as 120.50', invalidJson: 'Enter valid JSON', invalidArray: 'Enter a JSON array',
      select: 'Select…', back: 'Back', language: 'العربية', apply: 'Apply', clear: 'Clear', reverse: 'reverse',
      home: 'Home', notFound: 'Page not found', view: 'View', delete: 'Archive', step: 'Step {n} of {total}', review: 'Review'
    },
    ar: {
      create: 'إنشاء', edit: 'تعديل', save: 'حفظ', cancel: 'إلغاء', archive: 'أرشفة', search: 'بحث', filters: 'عوامل التصفية',
      any: 'الكل', yes: 'نعم', no: 'لا', from: 'من', to: 'إلى', previous: 'السابق', next: 'التالي', page: 'صفحة {page} من {pages}',
      total: '{total} عنصر', empty: 'لا يوجد شيء هنا بعد.', loading: 'جارٍ التحميل…', error: 'حدث خطأ ما', add: 'إضافة',
      remove: 'إزالة', notifications: 'الإشعارات', activity: 'النشاط', markRead: 'تعليم كمقروء',
      noAccess: 'ليست لديك صلاحية للوصول إلى هذه الصفحة.', noPermissions: 'لم تُمنح هذا التطبيق أي صلاحيات.',
      confirmArchive: 'هل تريد أرشفة هذا العنصر؟ يمكن استعادته لاحقًا.', required: 'حقل مطلوب', invalidNumber: 'أدخل رقمًا صحيحًا',
      invalidInteger: 'أدخل عددًا صحيحًا', invalidMoney: 'أدخل مبلغًا مثل 120.50', invalidJson: 'أدخل JSON صالحًا', invalidArray: 'أدخل مصفوفة JSON',
      select: 'اختر…', back: 'رجوع', language: 'English', apply: 'تطبيق', clear: 'مسح', reverse: 'عكسي',
      home: 'الرئيسية', notFound: 'الصفحة غير موجودة', view: 'عرض', delete: 'أرشفة', step: 'الخطوة {n} من {total}', review: 'مراجعة'
    }
  };

  // Optional overlay from the ui-advanced extension (ui_advanced.js sets window.ION_ADVANCED). Absent = plain UI.
  var ADV = (typeof window !== 'undefined' && window.ION_ADVANCED) || null;
  function advEntity(entity) { return (ADV && ADV.entities && ADV.entities[entity]) || null; }
  function advFlow(pageId) { return (ADV && ADV.flows && ADV.flows[pageId]) || null; }

  var state = null;

  function t(key, vars) {
    var s = (DICT[state.locale] && DICT[state.locale][key]) || DICT.en[key] || key;
    return s.replace(/\{(\w+)\}/g, function (_, k) { return vars && k in vars ? String(vars[k]) : '{' + k + '}'; });
  }
  // Missing Arabic labels fall back to English: nothing is machine-translated.
  function pick(labels) { return (labels && (labels[state.locale] || labels.en)) || ''; }

  // ---------------------------------------------------------------- DOM helper (textContent only)
  function el(tag, props) {
    var n = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else if (k === 'checked') n.checked = !!v;
        else if (k === 'disabled' && v) n.disabled = true;
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { add(parent, c); }); return; }
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }

  // Replaces host's content with the result of an async load; late answers from superseded loads are dropped.
  function mount(host, load, render) {
    host.__token = (host.__token || 0) + 1;
    var mine = host.__token;
    host.replaceChildren(el('p', { class: 'muted', 'aria-live': 'polite' }, t('loading')));
    Promise.resolve().then(load).then(function (data) {
      if (host.__token !== mine) return;
      host.replaceChildren(render(data));
    }).catch(function (err) {
      if (host.__token !== mine) return;
      host.replaceChildren(el('p', { class: 'error', role: 'alert' }, t('error') + ': ' + (err && err.message ? err.message : '')));
    });
  }

  // ---------------------------------------------------------------- spec helpers
  function srcById(id) { return SPEC.data_sources.filter(function (d) { return d.id === id; })[0]; }
  function srcByEntity(e) { return SPEC.data_sources.filter(function (d) { return d.entity === e; })[0]; }
  function pageOf(entity, kind) { return SPEC.pages.filter(function (p) { return p.id === entity + '_' + kind; })[0]; }
  function entityLabel(src, plural) { var l = src.labels[state.locale] || src.labels.en; return plural ? l.plural : l.singular; }
  function fieldLabel(f) {
    if (f.labels[state.locale]) return f.labels[state.locale];
    if (f.label_entity) { var s = srcByEntity(f.label_entity); if (s) return entityLabel(s, false); }
    return f.labels.en;
  }
  function fieldOf(src, name) { return src.fields.filter(function (f) { return f.name === name; })[0]; }
  function displayOf(src, row) {
    var v = src.display && row ? row[src.display] : null;
    return v === null || v === undefined || v === '' ? String(row && row.id ? row.id : '') : String(v);
  }
  function hrefTo(entity, id, suffix) {
    var base = pageOf(entity, 'list').path;
    return '#' + base + (id ? '/' + encodeURIComponent(id) : '') + (suffix || '');
  }
  function can(key) { return state.can(key); }
  function normalizePermissions(p) {
    if (typeof p === 'function') return p;
    if (p === '*') return function () { return true; };
    if (Array.isArray(p)) { var set = {}; p.forEach(function (k) { set[k] = true; }); return function (k) { return !!(set['*'] || set[k]); }; }
    return function () { return false; }; // secure by default: no permissions given, nothing is shown
  }
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
  function safeUrl(v) { return /^https?:\/\//i.test(String(v)) ? String(v) : null; }

  function valueNode(f, v) {
    if (v === null || v === undefined || v === '') return el('span', { class: 'muted' }, '—');
    switch (f.type) {
      case 'boolean': return t(v ? 'yes' : 'no');
      case 'money': return el('span', { dir: 'ltr' }, moneyShow(v, f.scale));
      case 'timestamp': { var d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toLocaleString(state.locale); }
      case 'json': case 'array': return el('code', null, JSON.stringify(v));
      case 'url': { var u = safeUrl(v); return u ? el('a', { href: u, rel: 'noopener noreferrer', target: '_blank' }, u) : String(v); }
      case 'email': return el('a', { href: 'mailto:' + String(v) }, String(v));
      default: return String(v);
    }
  }

  // ---------------------------------------------------------------- form widgets
  var INPUT_TYPES = { text: 'text', number: 'number', integer: 'number', date: 'date', datetime: 'datetime-local', email: 'email', url: 'url', tel: 'tel' };

  function initialOf(f, v) {
    if (v === null || v === undefined) return f.widget === 'checkbox' ? false : '';
    if (f.widget === 'json') return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    if (f.widget === 'datetime') return String(v).slice(0, 16);
    if (f.widget === 'date') return String(v).slice(0, 10);
    if (f.widget === 'money') return moneyShow(v, f.scale);
    return v;
  }

  // -> { empty } | { value } | { error: dictionaryKey }
  function convert(f, raw) {
    if (f.widget === 'checkbox') return { value: !!raw };
    if (raw === '' || raw === null || raw === undefined) return f.required ? { error: 'required' } : { empty: true };
    switch (f.widget) {
      case 'number': { var n = Number(raw); return isFinite(n) ? { value: n } : { error: 'invalidNumber' }; }
      case 'integer': return /^-?\d+$/.test(String(raw)) ? { value: Number(raw) } : { error: 'invalidInteger' };
      case 'money': { var mv = moneyParse(raw, f.scale); return mv === null ? { error: 'invalidMoney' } : { value: mv }; }
      case 'json': {
        var parsed;
        try { parsed = JSON.parse(raw); } catch (e) { return { error: 'invalidJson' }; }
        if (f.type === 'array' && !Array.isArray(parsed)) return { error: 'invalidArray' };
        return { value: parsed };
      }
      default: return { value: String(raw) };
    }
  }

  function relationSelect(targetEntity, id, initial) {
    var sel = el('select', { id: id }, el('option', { value: '' }, t('select')));
    var target = srcByEntity(targetEntity);
    if (target && can('entity:' + targetEntity + ':list')) {
      Promise.resolve(state.ds.list(target, { page: 1, pageSize: 200, q: '', sort: '', filters: {} })).then(function (res) {
        (res.items || []).forEach(function (row) { sel.appendChild(el('option', { value: row.id }, displayOf(target, row))); });
        if (initial) sel.value = initial;
      }).catch(function () { /* the select simply stays empty; the page reports its own errors */ });
    }
    return sel;
  }

  // -> { node, get() }
  function widget(f, id, initial) {
    var node;
    if (f.widget === 'checkbox') { node = el('input', { id: id, type: 'checkbox', checked: !!initial }); return { node: node, get: function () { return node.checked; } }; }
    if (f.widget === 'select') {
      node = el('select', { id: id }, el('option', { value: '' }, t('select')), (f.values || []).map(function (v) { return el('option', { value: v }, v); }));
      node.value = initial || '';
    } else if (f.widget === 'relation') {
      node = relationSelect(f.target, id, initial);
    } else if (f.widget === 'json') {
      node = el('textarea', { id: id, rows: 4, dir: 'ltr' }); node.value = initial === undefined ? '' : String(initial);
    } else {
      node = el('input', { id: id, type: INPUT_TYPES[f.widget] || 'text' });
      if (f.widget === 'number') node.step = 'any';
      if (f.widget === 'integer') node.step = '1';
      if (f.widget === 'money') { node.inputMode = 'decimal'; node.dir = 'ltr'; }
      if (f.widget === 'email' || f.widget === 'url' || f.widget === 'tel') node.dir = 'ltr';
      node.value = initial === undefined ? '' : String(initial);
    }
    return { node: node, get: function () { return node.value; } };
  }

  // ---------------------------------------------------------------- list page
  function guard(perm, build) { return can(perm) ? build() : el('p', { class: 'error', role: 'alert' }, t('noAccess')); }

  // First-use empty state (ui-advanced): only when nothing is filtered or searched; otherwise the plain message.
  function emptyNode(src, q, createPage) {
    var adv = advEntity(src.entity);
    var filtered = !!q.q || Object.keys(q.filters || {}).length > 0;
    if (!adv || !adv.empty || filtered) return el('p', { class: 'muted' }, t('empty'));
    var canAdd = createPage && can('entity:' + src.entity + ':create');
    return el('div', { class: 'empty', role: 'status' }, el('p', null, pick(adv.empty.message)),
      canAdd ? el('a', { class: 'button', href: '#' + createPage.path }, pick(adv.empty.action)) : null);
  }
  function listPage(page) {
    var src = srcById(page.data_source);
    var q = { page: 1, pageSize: page.pagination.size, q: '', sort: '', filters: {} };
    var box = el('div');
    var createPage = pageOf(src.entity, 'create');
    var editPage = pageOf(src.entity, 'edit');
    var searchInput = el('input', { type: 'search', 'aria-label': t('search') });

    function load() {
      mount(box, function () { return state.ds.list(src, q); }, function (data) {
        var items = (data && data.items) || [];
        var total = (data && data.total) || 0;
        var pages = Math.max(1, Math.ceil(total / q.pageSize));
        if (!items.length) return emptyNode(src, q, createPage);
        var cols = page.columns.map(function (n) { return fieldOf(src, n); });
        var showEdit = page.actions.indexOf('edit') >= 0 && can('entity:' + src.entity + ':update');
        var showDelete = page.actions.indexOf('delete') >= 0 && can('entity:' + src.entity + ':archive');
        var canRead = can('entity:' + src.entity + ':read');
        function sortBy(name) { q.page = 1; q.sort = q.sort === name ? '-' + name : name; load(); }
        var head = el('tr', null, cols.map(function (f) {
          return el('th', { 'aria-sort': q.sort === f.name ? 'ascending' : q.sort === '-' + f.name ? 'descending' : 'none' },
            el('button', { type: 'button', class: 'link', onclick: function () { sortBy(f.name); } }, fieldLabel(f)));
        }), (showEdit || showDelete) ? el('th', null) : null);
        var body = items.map(function (row) {
          return el('tr', null, cols.map(function (f, i) {
            var v = valueNode(f, row[f.name]);
            return el('td', null, i === 0 && canRead && page.actions.indexOf('view') >= 0 ? el('a', { href: hrefTo(src.entity, row.id) }, v) : v);
          }), (showEdit || showDelete) ? el('td', null,
            showEdit ? el('a', { href: hrefTo(src.entity, row.id, '/edit') }, t('edit')) : null, ' ',
            showDelete ? el('button', { type: 'button', class: 'link', onclick: function () {
              if (!window.confirm(t('confirmArchive'))) return;
              Promise.resolve(state.ds.archive(src, row.id)).then(load).catch(function (e) { window.alert(e.message); });
            } }, t('archive')) : null) : null);
        });
        return el('div', null,
          el('div', { class: 'scroll' }, el('table', null, el('thead', null, head), el('tbody', null, body))),
          el('p', { class: 'muted' }, t('total', { total: total })),
          pages > 1 ? el('nav', { class: 'pager', 'aria-label': 'pagination' },
            el('button', { type: 'button', disabled: q.page <= 1, onclick: function () { q.page--; load(); } }, t('previous')),
            el('span', null, t('page', { page: q.page, pages: pages })),
            el('button', { type: 'button', disabled: q.page >= pages, onclick: function () { q.page++; load(); } }, t('next'))) : null);
      });
    }

    // filters (draft values are applied together)
    var draft = {};
    var filterNode = null;
    if (page.filters.length) {
      var rows = page.filters.map(function (name) {
        var flt = src.filters.filter(function (x) { return x.field === name; })[0];
        var f = fieldOf(src, name);
        var id = 'f_' + name;
        var control;
        if (flt.kind === 'select' || flt.kind === 'boolean') {
          control = el('select', { id: id, onchange: function (e) { if (e.target.value === '') delete draft[name]; else draft[name] = e.target.value; } },
            el('option', { value: '' }, t('any')),
            flt.kind === 'boolean' ? [el('option', { value: 'true' }, t('yes')), el('option', { value: 'false' }, t('no'))]
              : flt.values.map(function (v) { return el('option', { value: v }, v); }));
        } else {
          var type = flt.type === 'date' ? 'date' : flt.type === 'timestamp' ? 'datetime-local' : 'number';
          var setSide = function (side) { return function (e) {
            var cur = typeof draft[name] === 'object' ? draft[name] : {};
            if (e.target.value === '') delete cur[side]; else cur[side] = e.target.value;
            if (Object.keys(cur).length) draft[name] = cur; else delete draft[name];
          }; };
          control = el('span', { class: 'range' },
            el('input', { id: id, type: type, 'aria-label': fieldLabel(f) + ' ' + t('from'), onchange: setSide('gte') }),
            el('input', { type: type, 'aria-label': fieldLabel(f) + ' ' + t('to'), onchange: setSide('lte') }));
        }
        return el('div', { class: 'row' }, el('label', { for: id }, fieldLabel(f)), control);
      });
      filterNode = el('details', { class: 'filters' }, el('summary', null, t('filters')), rows,
        el('div', { class: 'actions' },
          el('button', { type: 'button', onclick: function () { q.filters = JSON.parse(JSON.stringify(draft)); q.page = 1; load(); } }, t('apply')),
          el('button', { type: 'button', onclick: function () { draft = {}; q.filters = {}; q.page = 1; filterNode.querySelectorAll('select').forEach(function (s) { s.value = ''; }); filterNode.querySelectorAll('input').forEach(function (i) { i.value = ''; }); load(); } }, t('clear'))));
    }

    var root = el('section', null,
      el('header', { class: 'bar' }, el('h1', null, pick(page.labels)),
        can('entity:' + src.entity + ':create') && createPage ? el('a', { class: 'button', href: '#' + createPage.path }, t('create')) : null),
      page.search ? el('form', { role: 'search', class: 'search', onsubmit: function (e) { e.preventDefault(); q.q = searchInput.value; q.page = 1; load(); } }, searchInput, el('button', { type: 'submit' }, t('search'))) : null,
      filterNode, box);
    void editPage;
    load();
    return root;
  }

  // ---------------------------------------------------------------- detail page
  function relatedSection(rel, src, id) {
    var other = srcByEntity(rel.other);
    var host = el('div');
    var title = rel.title.entity ? entityLabel(srcByEntity(rel.title.entity), rel.many) + (rel.title.suffix ? ' · ' + rel.title.suffix : '') : rel.title.text + (rel.title.reverse ? ' · ' + t('reverse') : '');
    var canLink = can('relationship:' + rel.relationship + ':link');
    var canUnlink = can('relationship:' + rel.relationship + ':unlink');
    var err = el('p', { class: 'error', role: 'alert' });
    var linkAttrs = rel.attributes.filter(function (a) { return !a.auto; });

    function reload() {
      mount(host, function () { return state.ds.related(src, rel, id); }, function (items) {
        var list = items || [];
        var adding = el('div', { class: 'link-form' });
        adding.hidden = true;
        var select = relationSelect(rel.other, 'link_' + rel.relationship + '_' + rel.side, '');
        var inputs = linkAttrs.map(function (a) { return { f: a, w: widget(a, 'la_' + rel.relationship + '_' + a.name, initialOf(a, null)) }; });
        add(adding, [select, inputs.map(function (i) { return el('div', { class: 'row' }, el('label', { for: i.w.node.id }, fieldLabel(i.f)), i.w.node); }),
          el('div', { class: 'actions' },
            el('button', { type: 'button', onclick: function () {
              err.textContent = '';
              if (!select.value) return;
              var values = {};
              for (var k = 0; k < inputs.length; k++) {
                var r = convert(inputs[k].f, inputs[k].w.get());
                if (r.error) { err.textContent = fieldLabel(inputs[k].f) + ': ' + t(r.error); return; }
                if (!r.empty) values[inputs[k].f.name] = r.value;
              }
              Promise.resolve(state.ds.link(src, rel, id, select.value, values)).then(reload).catch(function (e) { err.textContent = e.message; });
            } }, t('save')),
            el('button', { type: 'button', onclick: function () { adding.hidden = true; } }, t('cancel')))]);
        return el('div', null,
          list.length ? el('ul', null, list.map(function (row) {
            return el('li', null,
              can('entity:' + rel.other + ':read') ? el('a', { href: hrefTo(rel.other, row.id) }, displayOf(other, row)) : displayOf(other, row),
              row.link ? rel.attributes.map(function (a) {
                var v = row.link[a.name];
                return v === undefined || v === null ? null : el('span', { class: 'badge' }, fieldLabel(a) + ': ', valueNode(a, v));
              }) : null,
              canUnlink ? el('button', { type: 'button', class: 'link', onclick: function () {
                Promise.resolve(state.ds.unlink(src, rel, id, row.id)).then(reload).catch(function (e) { err.textContent = e.message; });
              } }, t('remove')) : null);
          })) : el('p', { class: 'muted' }, t('empty')),
          canLink && (rel.many || !list.length) ? el('button', { type: 'button', onclick: function () { adding.hidden = false; } }, t('add')) : null,
          adding, err);
      });
    }
    reload();
    return el('section', { class: 'related', 'aria-label': title }, el('h2', null, title), host);
  }

  function notificationArea(src, id) {
    var host = el('div');
    function reload() {
      mount(host, function () { return state.ds.notifications(src, id); }, function (items) {
        if (!items || !items.length) return el('p', { class: 'muted' }, t('empty'));
        return el('ul', null, items.map(function (n) {
          return el('li', { class: n.read_at ? 'read' : 'unread' }, el('span', null, n.message), ' ',
            el('time', { class: 'muted' }, new Date(n.created_at).toLocaleString(state.locale)),
            n.read_at ? null : el('button', { type: 'button', class: 'link', onclick: function () { Promise.resolve(state.ds.markRead(n.id)).then(reload); } }, t('markRead')));
        }));
      });
    }
    reload();
    return el('section', { class: 'notifications', 'aria-label': t('notifications') }, el('h2', null, t('notifications')), host);
  }

  function activityArea(src, id) {
    var host = el('div');
    mount(host, function () { return state.ds.activity(src, id); }, function (items) {
      if (!items || !items.length) return el('p', { class: 'muted' }, t('empty'));
      return el('ol', null, items.map(function (a) {
        var ev = SPEC.events.filter(function (e) { return e.id === a.event_id; })[0];
        return el('li', null, (ev ? pick(ev.labels) : a.event_id) + ' ', el('time', { class: 'muted' }, new Date(a.created_at).toLocaleString(state.locale)));
      }));
    });
    return el('section', { class: 'activity', 'aria-label': t('activity') }, el('h2', null, t('activity')), host);
  }

  function detailPage(page, params) {
    var src = srcById(page.data_source);
    var id = params.id;
    var host = el('div');
    var err = el('p', { class: 'error', role: 'alert' });
    var editPage = pageOf(src.entity, 'edit');
    mount(host, function () { return state.ds.get(src, id); }, function (row) {
      return el('div', null,
        el('header', { class: 'bar' }, el('h1', null, displayOf(src, row)),
          el('span', { class: 'actions' },
            can('entity:' + src.entity + ':update') && editPage ? el('a', { class: 'button', href: hrefTo(src.entity, id, '/edit') }, t('edit')) : null,
            can('entity:' + src.entity + ':archive') ? el('button', { type: 'button', onclick: function () {
              if (!window.confirm(t('confirmArchive'))) return;
              Promise.resolve(state.ds.archive(src, id)).then(function () { navigate(pageOf(src.entity, 'list').path); }).catch(function (e) { err.textContent = e.message; });
            } }, t('archive')) : null)),
        err,
        el('dl', null, page.fields.map(function (n) {
          var f = fieldOf(src, n);
          var v = row[n];
          var node = f.widget === 'relation' && v ? el('a', { href: hrefTo(f.target, v) }, String(v)) : valueNode(f, v);
          return [el('dt', null, fieldLabel(f)), el('dd', null, node)];
        })),
        src.relations.filter(function (r) { return can('relationship:' + r.relationship + ':read'); }).map(function (r) { return relatedSection(r, src, id); }),
        src.surfaces.notifications ? notificationArea(src, id) : null,
        src.surfaces.activity ? activityArea(src, id) : null,
        el('p', null, el('a', { href: hrefTo(src.entity) }, t('back'))));
    });
    return el('article', null, host);
  }

  // ---------------------------------------------------------------- form page (create / edit)
  function formPage(page, params) {
    var src = srcById(page.data_source);
    var host = el('div');
    var editing = page.mode === 'edit';
    function build(row) {
      var fields = page.fields.map(function (n) { return fieldOf(src, n); });
      var inputs = {};
      var errors = {};
      var formErr = el('p', { class: 'error', role: 'alert' });
      var rows = fields.map(function (f) {
        var id = 'fld_' + f.name;
        inputs[f.name] = widget(f, id, initialOf(f, row ? row[f.name] : null));
        errors[f.name] = el('span', { class: 'error', role: 'alert' });
        return el('div', { class: 'row' }, el('label', { for: id }, fieldLabel(f), f.required ? ' *' : ''), inputs[f.name].node, errors[f.name]);
      });
      var flow = editing ? null : advFlow(page.id);
      var step = 0;
      var stepNote = el('p', { class: 'muted', role: 'status' });
      var reviewList = el('dl', { class: 'review' });
      var backBtn = el('button', { type: 'button', onclick: function () { step--; show(); } }, t('previous'));
      var nextBtn = el('button', { type: 'button', onclick: function () { goNext(); } }, t('next'));
      var saveBtn = el('button', { type: 'submit' }, t('save'));
      function stepNames() { return flow.steps[step].fields; }
      function stepValid() {
        var ok = true;
        fields.forEach(function (f) {
          if (stepNames().indexOf(f.name) < 0) return;
          var r = convert(f, inputs[f.name].get());
          errors[f.name].textContent = r.error ? t(r.error) : '';
          if (r.error) ok = false;
        });
        return ok;
      }
      function goNext() { if (stepValid()) { step++; show(); } }
      function shown(f) {
        var n = inputs[f.name].node;
        if (n.tagName === 'SELECT') return n.options[n.selectedIndex] ? n.options[n.selectedIndex].text : '';
        if (n.type === 'checkbox') return n.checked ? t('yes') : t('no');
        var v = inputs[f.name].get();
        return v === null || v === undefined ? '' : String(v);
      }
      function show() {
        var last = step === flow.steps.length - 1;
        fields.forEach(function (f, i) { rows[i].hidden = stepNames().indexOf(f.name) < 0; });
        stepNote.textContent = t('step', { n: step + 1, total: flow.steps.length }) + ' — ' + pick(flow.steps[step].labels);
        backBtn.hidden = step === 0; nextBtn.hidden = last; saveBtn.hidden = !last; reviewList.hidden = !last;
        if (last) {
          reviewList.replaceChildren();
          fields.forEach(function (f) { reviewList.appendChild(el('dt', null, fieldLabel(f))); reviewList.appendChild(el('dd', null, shown(f))); });
        }
      }
      if (flow) show(); else { stepNote.hidden = true; reviewList.hidden = true; backBtn.hidden = true; nextBtn.hidden = true; }
      return el('form', { novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        if (flow && step < flow.steps.length - 1) { goNext(); return; }
        var out = {};
        var bad = false;
        formErr.textContent = '';
        fields.forEach(function (f) {
          var r = convert(f, inputs[f.name].get());
          errors[f.name].textContent = r.error ? t(r.error) : '';
          if (r.error) bad = true;
          else if (r.empty) { if (editing) out[f.name] = null; }
          else out[f.name] = r.value;
        });
        if (bad) return;
        var done = editing ? state.ds.update(src, params.id, out) : state.ds.create(src, out);
        Promise.resolve(done).then(function (saved) {
          navigate(pageOf(src.entity, 'list').path + '/' + encodeURIComponent((saved && saved.id) || params.id));
        }).catch(function (er) { formErr.textContent = er.message; });
      } },
        el('h1', null, pick(page.labels)), stepNote, rows, reviewList, formErr,
        el('div', { class: 'actions' }, backBtn, nextBtn, saveBtn, el('a', { class: 'button', href: hrefTo(src.entity) }, t('cancel'))));
    }
    if (editing) mount(host, function () { return state.ds.get(src, params.id); }, build);
    else host.appendChild(build(null));
    return host;
  }

  // ---------------------------------------------------------------- shell and router
  function matchRoute(path) {
    var parts = path.split('/').filter(Boolean);
    for (var i = 0; i < SPEC.pages.length; i++) {
      var want = SPEC.pages[i].path.split('/').filter(Boolean);
      if (want.length !== parts.length) continue;
      var params = {};
      var ok = true;
      for (var j = 0; j < want.length; j++) {
        if (want[j][0] === ':') params[want[j].slice(1)] = decodeURIComponent(parts[j]);
        else if (want[j] !== parts[j]) { ok = false; break; }
      }
      if (ok) return { page: SPEC.pages[i], params: params };
    }
    return null;
  }
  function navigate(path) { window.location.hash = path; }
  function readPath() { return window.location.hash.length > 1 ? window.location.hash.slice(1) : '/'; }

  function renderApp() {
    var dir = state.locale === 'ar' ? 'rtl' : 'ltr';
    var path = readPath();
    var hit = matchRoute(path);
    var body;
    if (hit) {
      body = guard(hit.page.permission, function () {
        return hit.page.type === 'list' ? listPage(hit.page) : hit.page.type === 'detail' ? detailPage(hit.page, hit.params) : formPage(hit.page, hit.params);
      });
    } else if (path === '/' || path === '') {
      var any = SPEC.data_sources.some(function (d) { return can('entity:' + d.entity + ':list'); });
      body = any ? el('h1', null, t('home')) : el('p', { class: 'error', role: 'alert' }, t('noPermissions'));
    } else body = el('p', { class: 'error', role: 'alert' }, t('notFound'));

    var nav = el('nav', { 'aria-label': 'main' }, el('a', { href: '#/' }, t('home')),
      SPEC.navigation.items.map(function (sid) {
        var s = srcById(sid);
        return can('entity:' + s.entity + ':list') ? el('a', { href: '#' + pageOf(s.entity, 'list').path }, entityLabel(s, true)) : null;
      }));
    var sw = el('button', { type: 'button', class: 'link', onclick: function () {
      state.locale = state.locale === 'ar' ? 'en' : 'ar';
      if (state.onLocaleChange) state.onLocaleChange(state.locale);
      renderApp();
    } }, t('language'));
    state.root.replaceChildren(el('div', { class: 'ion', dir: dir, lang: state.locale }, el('aside', null, nav, sw), el('main', null, body)));
  }

  // ---------------------------------------------------------------- data sources
  function fill(tpl, vars) { return tpl.replace(/:(id|fromId|toId)/g, function (_, k) { return encodeURIComponent(vars[k]); }); }

  function createRestDataSource(opts) {
    opts = opts || {};
    var base = opts.baseUrl || '';
    var doFetch = opts.fetch || window.fetch.bind(window);
    function call(method, path, body, query) {
      var url = base + path;
      if (query) {
        var parts = [];
        Object.keys(query).forEach(function (k) { var v = query[k]; if (v !== undefined && v !== null && v !== '') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v))); });
        if (parts.length) url += '?' + parts.join('&');
      }
      var init = { method: method, credentials: 'same-origin' };
      if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
      return doFetch(url, init).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return null; }).then(function (j) {
            throw new Error(j && j.error ? String(j.error) : res.status + ' ' + (res.statusText || ''));
          });
        }
        return res.status === 204 ? null : res.json();
      });
    }
    return {
      list: function (src, q) {
        var query = { page: q.page, pageSize: q.pageSize, q: q.q, sort: q.sort };
        Object.keys(q.filters || {}).forEach(function (n) {
          var f = q.filters[n];
          if (typeof f === 'object') { query['filter[' + n + '][gte]'] = f.gte; query['filter[' + n + '][lte]'] = f.lte; } else query['filter[' + n + ']'] = f;
        });
        return call('GET', src.api.list.path, undefined, query);
      },
      get: function (src, id) { return call('GET', fill(src.api.read.path, { id: id })); },
      create: function (src, v) { return call('POST', src.api.create.path, v); },
      update: function (src, id, v) { return call('PATCH', fill(src.api.update.path, { id: id }), v); },
      archive: function (src, id) { return call('DELETE', fill(src.api.archive.path, { id: id })); },
      related: function (src, rel, id) { return call('GET', fill(rel.paths.list, rel.side === 'from' ? { fromId: id } : { toId: id })); },
      link: function (src, rel, id, otherId, attrs) {
        var fromId = rel.side === 'from' ? id : otherId;
        var toId = rel.side === 'from' ? otherId : id;
        return call('POST', fill(rel.paths.create, { fromId: fromId }), Object.assign({ toId: toId }, attrs));
      },
      unlink: function (src, rel, id, otherId) {
        return call('DELETE', fill(rel.paths.delete, rel.side === 'from' ? { fromId: id, toId: otherId } : { fromId: otherId, toId: id }));
      },
      notifications: function (src, id) { return call('GET', fill(src.api.notifications.path, { id: id })); },
      markRead: function (nid) { return call('PATCH', '/api/notifications/' + encodeURIComponent(nid) + '/read'); },
      activity: function (src, id) { return call('GET', fill(src.api.activity.path, { id: id })); }
    };
  }

  // In-memory data source: powers demo.html and the tests. Same interface as the REST one.
  function createMemoryDataSource() {
    var rows = {};        // source id -> array of rows
    var links = [];       // junction links: { relationship, fromId, toId, attrs }
    var notes = {};       // entity row id -> notifications
    var counter = 0;
    SPEC.data_sources.forEach(function (d) { rows[d.id] = []; });
    function ensure(src, id) { var r = rows[src.id].filter(function (x) { return x.id === id && !x.archived_at; })[0]; if (!r) throw new Error('Not found'); return r; }
    function fkHolder(rel) {
      for (var i = 0; i < SPEC.data_sources.length; i++) {
        var f = SPEC.data_sources[i].fields.filter(function (x) { return x.relationship === rel.relationship; })[0];
        if (f) return { src: SPEC.data_sources[i], field: f };
      }
      return null;
    }
    function cmp(a, b) { return a === b ? 0 : a === undefined || a === null ? 1 : b === undefined || b === null ? -1 : a < b ? -1 : 1; }
    return {
      list: function (src, q) {
        var items = rows[src.id].filter(function (r) { return !r.archived_at; });
        if (q.q) {
          var needle = String(q.q).toLowerCase();
          items = items.filter(function (r) { return src.search_fields.some(function (n) { return String(r[n] === undefined || r[n] === null ? '' : r[n]).toLowerCase().indexOf(needle) >= 0; }); });
        }
        Object.keys(q.filters || {}).forEach(function (n) {
          var f = q.filters[n];
          items = items.filter(function (r) {
            var v = r[n];
            if (typeof f === 'object') {
              var num = typeof v === 'number';
              if (f.gte !== undefined && (v === undefined || v === null || (num ? v < Number(f.gte) : String(v) < f.gte))) return false;
              if (f.lte !== undefined && (v === undefined || v === null || (num ? v > Number(f.lte) : String(v) > f.lte))) return false;
              return true;
            }
            return String(v) === String(f);
          });
        });
        if (q.sort) {
          var desc = q.sort[0] === '-';
          var key = desc ? q.sort.slice(1) : q.sort;
          items = items.slice().sort(function (a, b) { return (desc ? -1 : 1) * cmp(a[key], b[key]); });
        }
        var start = (q.page - 1) * q.pageSize;
        return { items: items.slice(start, start + q.pageSize).map(function (r) { return Object.assign({}, r); }), total: items.length };
      },
      get: function (src, id) { return Object.assign({}, ensure(src, id)); },
      create: function (src, v) {
        counter++;
        var row = Object.assign({ id: 'm' + counter, created_at: '2026-01-01T00:00:00Z', archived_at: null }, v);
        rows[src.id].push(row);
        return Object.assign({}, row);
      },
      update: function (src, id, v) { var r = ensure(src, id); Object.assign(r, v); return Object.assign({}, r); },
      archive: function (src, id) { ensure(src, id).archived_at = 'archived'; return null; },
      related: function (src, rel, id) {
        var other = srcByEntity(rel.other);
        var fk = fkHolder(rel);
        if (fk) {
          var holderIsThis = fk.src.id === src.id && !(rel.type === 'self' && rel.side === 'to');
          if (holderIsThis) { var me = ensure(src, id); var pid = me[fk.field.name]; return rows[other.id].filter(function (r) { return r.id === pid && !r.archived_at; }).map(function (r) { return Object.assign({}, r); }); }
          return rows[fk.src.id].filter(function (r) { return r[fk.field.name] === id && !r.archived_at; }).map(function (r) { return Object.assign({}, r); });
        }
        return links.filter(function (l) { return l.relationship === rel.relationship && (rel.side === 'from' ? l.fromId === id : l.toId === id); }).map(function (l) {
          var oid = rel.side === 'from' ? l.toId : l.fromId;
          var row = rows[other.id].filter(function (r) { return r.id === oid && !r.archived_at; })[0];
          return row ? Object.assign({}, row, { link: l.attrs }) : null;
        }).filter(Boolean);
      },
      link: function (src, rel, id, otherId, attrs) {
        var fk = fkHolder(rel);
        if (fk) {
          var holderIsThis = fk.src.id === src.id && !(rel.type === 'self' && rel.side === 'to');
          if (holderIsThis) ensure(src, id)[fk.field.name] = otherId; else ensure(fk.src, otherId)[fk.field.name] = id;
          return null;
        }
        var fromId = rel.side === 'from' ? id : otherId;
        var toId = rel.side === 'from' ? otherId : id;
        if (links.some(function (l) { return l.relationship === rel.relationship && l.fromId === fromId && l.toId === toId; })) throw new Error('Already linked');
        links.push({ relationship: rel.relationship, fromId: fromId, toId: toId, attrs: attrs || {} });
        return null;
      },
      unlink: function (src, rel, id, otherId) {
        var fk = fkHolder(rel);
        if (fk) {
          var holderIsThis = fk.src.id === src.id && !(rel.type === 'self' && rel.side === 'to');
          if (holderIsThis) ensure(src, id)[fk.field.name] = null; else ensure(fk.src, otherId)[fk.field.name] = null;
          return null;
        }
        var fromId = rel.side === 'from' ? id : otherId;
        var toId = rel.side === 'from' ? otherId : id;
        links = links.filter(function (l) { return !(l.relationship === rel.relationship && l.fromId === fromId && l.toId === toId); });
        return null;
      },
      notifications: function (src, id) { return (notes[id] || []).slice(); },
      markRead: function (nid) { Object.keys(notes).forEach(function (k) { notes[k].forEach(function (n) { if (n.id === nid) n.read_at = '2026-01-01T00:00:00Z'; }); }); return null; },
      activity: function () { return []; },
      // test/demo helper: pretend an event delivered a notification
      __notify: function (rowId, message) { counter++; (notes[rowId] = notes[rowId] || []).push({ id: 'n' + counter, message: message, created_at: '2026-01-01T00:00:00Z', read_at: null }); }
    };
  }

  function start(opts) {
    state = {
      root: opts.root, ds: opts.dataSource, can: normalizePermissions(opts.permissions),
      locale: opts.locale && SPEC.locales.indexOf(opts.locale) >= 0 ? opts.locale : SPEC.default_locale,
      onLocaleChange: opts.onLocaleChange
    };
    window.addEventListener('hashchange', renderApp);
    renderApp();
    return { rerender: renderApp, setLocale: function (l) { state.locale = l; renderApp(); } };
  }

  window.Ion = { start: start, createRestDataSource: createRestDataSource, createMemoryDataSource: createMemoryDataSource, spec: SPEC };
`;
