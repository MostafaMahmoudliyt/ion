// Desktop Renderer (constitution sections 6, 65). An Extension, not Core.
// ui_spec -> a Tauri 2 project. The window loads the web renderer's output from the same .uapp
// (desktop/src-tauri/../../web = <app>.uapp/web), so ui-web must be part of the build. Deterministic.

type Obj = Record<string, any>; // validated spec JSON

export const IDENTIFIER = 'com.ion.app';
export const FRONTEND_DIST = '../../web'; // relative to desktop/src-tauri/

export function generate(specs: Obj): Record<string, string> {
  const ui = specs.ui_spec.ui_spec;
  const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';
  return {
    'package.json': json({ name: 'ion-desktop', private: true, version: '1.0.0', scripts: { dev: 'tauri dev', build: 'tauri build' }, devDependencies: { '@tauri-apps/cli': '^2' } }),
    'src-tauri/tauri.conf.json': json({
      $schema: 'https://schema.tauri.app/config/2',
      productName: 'Ion App',
      version: '1.0.0',
      identifier: IDENTIFIER,
      build: { frontendDist: FRONTEND_DIST },
      app: {
        // demo.html = in-memory data with every permission. Point "url" at index.html (plus your backend and permissions) for production.
        windows: [{ label: 'main', title: 'Ion App', width: 1100, height: 760, url: 'demo.html' }],
        // Own files only. Add your backend origin to connect-src to use index.html with a real API.
        security: { csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" },
      },
      bundle: { active: true, targets: 'all', icon: ['icons/icon.png'] },
    }),
    'src-tauri/Cargo.toml': ['[package]', 'name = "ion-desktop"', 'version = "1.0.0"', 'edition = "2021"', '', '[build-dependencies]', 'tauri-build = { version = "2", features = [] }', '', '[dependencies]', 'tauri = { version = "2", features = [] }', ''].join('\n'),
    'src-tauri/build.rs': 'fn main() {\n    tauri_build::build()\n}\n',
    'src-tauri/src/main.rs': '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nfn main() {\n    tauri::Builder::default()\n        .run(tauri::generate_context!())\n        .expect("error while running Ion App");\n}\n',
    'src-tauri/capabilities/default.json': json({ $schema: '../gen/schemas/desktop-schema.json', identifier: 'default', description: 'Main window: core defaults only, no filesystem or shell access.', windows: ['main'], permissions: ['core:default'] }),
    'README.md': [
      '# Desktop (Tauri 2)', '',
      `Wraps \`${FRONTEND_DIST}\` (the ui-web output of this .uapp; default locale: ${ui.default_locale}).`,
      '```bash', 'npm install', 'npx tauri icon path/to/icon.png   # required once: creates src-tauri/icons (binary files are not generated)', 'npm run dev', 'npm run build               # DMG / EXE(MSI) / AppImage for the OS you build on', '```',
      'Needs Rust and the Tauri 2 prerequisites for your OS. Not compiled where this was generated.', '',
    ].join('\n'),
  };
}
