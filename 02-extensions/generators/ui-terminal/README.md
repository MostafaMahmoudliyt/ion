# ui-terminal

Terminal Renderer (kind `ui`). Reads `ui_spec`; writes `tui.cjs` (Node >= 18, no dependencies) and `package.json`.

`node tui.cjs --demo` runs on in-memory data with every permission. `node tui.cjs --api <base-url>` talks to the REST routes of `api-rest` and is **secure by default**:
nothing is listed until `ION_PERMISSIONS` holds keys from `ui_spec.permissions` (comma separated, or `*`). `ION_TOKEN` is sent as a bearer token. `--locale ar|en`, `--no-color`.

Screens: menu, list (paging, `/search`), detail, create, edit, archive. Input is line based (works over pipes and in scripts). Not in this renderer: filters, related items, notifications, activity (the web renderer has them).
Control characters in stored values are replaced by spaces, so data can never inject escape sequences into the terminal. Arabic text is printed as is; right-to-left shaping depends on your terminal.
