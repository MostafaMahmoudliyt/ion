# ui-desktop

Desktop Renderer (kind `ui`). Reads `ui_spec`; writes a Tauri 2 project (`package.json`, `src-tauri/`).
It does **not** duplicate the web UI: `frontendDist` is `../../web`, the folder `ui-web` writes in the same `.uapp`, so keep `ui-web` in the build.
The window opens `demo.html` (in-memory data, every permission); switch to `index.html` and add your backend to the CSP `connect-src` for production. The window has core capabilities only (no filesystem, no shell).
Bundling needs icons: run `npx tauri icon <png>` once (binary files are not generated). Each OS builds its own installer (DMG, MSI/EXE, AppImage).

**Status: built by CI** for Linux, macOS and Windows; the installers are uploaded as workflow artifacts. Tests also check the generated structure and that `../../web` resolves to the web output inside a real `.uapp`.
