# ui-web

UI Generator / Web Renderer (kind `ui`). Reads `ui_spec`; writes a dependency-free web app.

| File | Purpose |
|---|---|
| `app.js` | classic script (no build step, no modules): the spec as data + a fixed runtime |
| `styles.css` | system fonts, logical properties (one stylesheet for RTL and LTR), theme colour from the spec |
| `index.html` | REST data source, **no permissions** until you pass them (secure by default) |
| `demo.html` | in-memory data, every permission granted: for looking at the UI, not for production |

`Ion.start({ root, dataSource, permissions, locale })`; `permissions` is `'*'`, a list of keys from `ui_spec.permissions`, or `(key) => boolean`.
A data source is any object with `list, get, create, update, archive, related, link, unlink, notifications, markRead, activity` (see `createRestDataSource` in `app.js`).

Pages: list (paging, sort, search, filters), detail (related items, notifications, activity), create, edit. Arabic is RTL and the default; English is LTR. Labels come only from the definition; a missing Arabic label falls back to English.
The DOM is built with `createElement` + `textContent` only, so a stored value can never become markup.

Tests: `node --test tests.ts` (needs the `jsdom` dev dependency; skipped when absent).
