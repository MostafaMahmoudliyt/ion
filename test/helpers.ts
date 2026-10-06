// Shared by extension tests. Not part of Core.
import { readFileSync } from 'node:fs';
import { buildSpecs } from '../src/index.ts';
import type { SpecSet } from '../src/index.ts';

export const mit = JSON.parse(readFileSync(new URL('../examples/mit.json', import.meta.url), 'utf8'));
export const specsOf = (def: unknown = mit): SpecSet => buildSpecs(def).specs;
export const entity = (id: string, attributes: unknown[] = [{ name: 'name', type: 'string' }]) =>
  ({ id, name: id[0].toUpperCase() + id.slice(1), type: 'custom', attributes });

// Real PostgreSQL is optional: set ION_PG_URI to run the integration tests.
export const PG_URI = process.env.ION_PG_URI;

export async function freshDatabase(name: string): Promise<{ pool: any; close(): Promise<void> }> {
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: PG_URI });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  // Swap the database name in the URI (also works for the socket form postgresql://user:@/db?host=/dir).
  const pool = new pg.Pool({ connectionString: PG_URI!.replace(/^(postgres(?:ql)?:\/\/[^/]*\/)[^?]*/, `$1${name}`) });
  return { pool, close: () => pool.end() };
}
