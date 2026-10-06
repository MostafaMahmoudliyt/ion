import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, WEB_DIR, COMPATIBILITY_DATE } from './index.ts';
import { mit, specsOf } from '../../../test/helpers.ts';

const out = generate(specsOf());

test('cloud-cloudflare: wrangler.toml serves the sibling web output; deterministic; configuration only', () => {
  assert.deepEqual(Object.keys(out), ['wrangler.toml', 'README.md']);
  assert.deepEqual(generate(specsOf(JSON.parse(JSON.stringify(mit)))), out);
  const t = out['wrangler.toml'];
  assert.match(t, /^name = "ion-app"$/m);
  assert.ok(t.includes(`compatibility_date = "${COMPATIBILITY_DATE}"`));
  assert.match(t, /^\[assets\]\ndirectory = "\.\.\/\.\.\/web"$/m);
  assert.equal(WEB_DIR, '../../web');
  assert.doesNotMatch(t, /main\s*=|account_id|api[_-]?key|secret|token/i);
});
