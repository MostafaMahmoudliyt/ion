// Emits types/index.d.ts (+ one .d.ts per module) from src/, then rewrites "./x.ts" imports to "./x.js"
// so consumers do not need allowImportingTsExtensions. Run: npm run build:types
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

rmSync('types', { recursive: true, force: true });
execFileSync('npx', ['tsc', '-p', 'tsconfig.types.json', ...process.argv.slice(2)], { stdio: 'inherit' });
for (const f of readdirSync('types')) {
  if (!f.endsWith('.d.ts')) continue;
  const p = join('types', f);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/(from\s+'\.\/[^']+)\.ts'/g, "$1.js'"));
}
console.log('types/index.d.ts ready');
