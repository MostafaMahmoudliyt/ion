import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from './index.ts';
import { mit, specsOf } from '../../../test/helpers.ts';

const files = generate(specsOf());
const dir = mkdtempSync(join(tmpdir(), 'ion-tui-'));
writeFileSync(join(dir, 'tui.cjs'), files['tui.cjs']);

function run(args: string[], input: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn('node', [join(dir, 'tui.cjs'), '--no-color', '--locale', 'en', ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.end(input.join('\n') + (input.length ? '\n' : ''));
  });
}

test('ui-terminal: deterministic, two files, spec embedded as data, no eval', () => {
  assert.deepEqual(Object.keys(files), ['tui.cjs', 'package.json']);
  assert.deepEqual(generate(specsOf(JSON.parse(JSON.stringify(mit)))), files);
  assert.doesNotMatch(files['tui.cjs'], /\beval\s*\(|new Function|child_process/);
  assert.match(files['tui.cjs'], /"data_sources"/);
});

test('ui-terminal: demo creates, lists, searches, opens, edits and archives (stdin scripted)', async () => {
  const r = await run(['--demo'], [
    '1', 'c', 'Ada Lovelace', 'ada@example.org', '3.9', 'active', // students -> create
    'c', 'Bob Stone', 'bob@example.org', '', '',
    '/ada', '1',            // search, open the first match
    'e', '', '', '3.5', '', // edit gpa, keep the rest
    'd', 'y',               // archive
    'b', 'q',
  ]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Students/);
  assert.match(r.out, /Saved\./);
  assert.match(r.out, /Ada Lovelace/);
  assert.match(r.out, /3\.5/); // the edit is visible on the detail screen
  assert.match(r.out, /Archived\./);
  assert.match(r.out, /Bye\./);
});

test('ui-terminal: validation re-asks (required, number, enum, email) and never creates an invalid row', async () => {
  const r = await run(['--demo'], ['1', 'c', '', 'Zed', 'not-an-email', 'z@e.org', 'abc', '2', 'bogus', 'active', 'q']);
  assert.match(r.out, /Name is required/);
  assert.match(r.out, /Email is not valid/);
  assert.match(r.out, /Gpa is not valid/);
  assert.match(r.out, /Status is not valid/);
  assert.match(r.out, /Saved\./);
});

test('ui-terminal: secure by default without --demo; usage without any mode; clean exit at EOF', async () => {
  assert.equal((await run([], [])).code, 2);
  const none = await run(['--api', 'http://127.0.0.1:9'], []);
  assert.match(none.out, /No permissions granted/);
  const some = await run(['--demo'], ['1']); // EOF inside a screen
  assert.equal(some.code, 0, some.err);
});

test('ui-terminal: terminal escape sequences in data are neutralised', async () => {
  const r = await run(['--demo'], ['1', 'c', 'Evil\u001b[2J\u001b]0;pwned\u0007Name', 'e@e.org', '', '', 'q']);
  assert.ok(!r.out.includes('\u001b'), 'no ESC byte may reach the terminal');
  assert.ok(!r.out.includes('\u0007'));
  assert.match(r.out, /Evil/);
});

test('ui-terminal: REST mode sends the documented requests with the token and permission keys', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url!.startsWith('/api/students?')) res.end(JSON.stringify({ items: [{ id: 's1', name: 'Rest Row', email: 'r@e.org', gpa: 4 }], total: 1 }));
      else if (req.method === 'GET' && req.url === '/api/students/s1') res.end(JSON.stringify({ id: 's1', name: 'Rest Row', email: 'r@e.org' }));
      else if (req.method === 'POST') { seen.push('BODY ' + body); res.end(JSON.stringify({ id: 's2' })); }
      else { res.statusCode = 403; res.end(JSON.stringify({ error: 'forbidden here' })); }
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const r = await run(['--api', base], ['1', '/rest', '1', 'b', 'c', 'q'], { ION_PERMISSIONS: 'entity:student:list,entity:student:read', ION_TOKEN: 'tok123' });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Rest Row/);
    assert.ok(seen.some((s) => s.startsWith('GET /api/students?') && s.includes('q=rest') && s.endsWith('Bearer tok123')), seen.join('\n'));
    assert.ok(seen.some((s) => s.startsWith('GET /api/students/s1 ')));
    assert.match(r.out, /You do not have permission/); // create was not granted: no request is made
    assert.ok(!seen.some((s) => s.startsWith('POST')));
    // with create granted the body is typed JSON
    const w = await run(['--api', base], ['1', 'c', 'New One', 'n@e.org', '3.2', '', 'b', 'q'], { ION_PERMISSIONS: 'entity:student:list,entity:student:create' });
    assert.match(w.out, /Saved\./);
    assert.ok(seen.includes('BODY ' + JSON.stringify({ name: 'New One', email: 'n@e.org', gpa: 3.2 })), seen.join('\n'));
  } finally { server.close(); }
});
