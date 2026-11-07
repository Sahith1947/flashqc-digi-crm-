// Applies supabase/migrations/*.sql to the hosted database during `npm run build`.
// On Vercel, the Supabase integration provides POSTGRES_URL_NON_POOLING. Locally (no such
// variable) this does nothing — use `supabase db reset` instead.
// Each file runs once, in its own transaction, and is recorded in crm_meta.migrations.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  console.log('[migrate] No database URL in the environment; skipping (local build).');
  process.exit(0);
}

const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query('select pg_advisory_lock(hashtext($1))', ['flashqc_crm_migrations']);
  await client.query('create schema if not exists crm_meta; create table if not exists crm_meta.migrations (name text primary key, applied_at timestamptz not null default now())');
  const { rows } = await client.query('select name from crm_meta.migrations');
  const done = new Set(rows.map((r) => r.name));
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into crm_meta.migrations (name) values ($1)', [f]);
      await client.query('commit');
      applied++;
      console.log(`[migrate] applied ${f}`);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
  console.log(`[migrate] database up to date (${applied} applied, ${files.length} total).`);
} catch (e) {
  console.error('[migrate] ' + e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
