import { Client } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
  }
}

loadEnv();

async function main() {
  const url = process.env.DATABASE_URL?.split('?')[0];
  if (!url) throw new Error('DATABASE_URL missing');
  const client = new Client({ connectionString: url });
  await client.connect();

  const enums = await client.query(
    `SELECT n.nspname, t.typname
     FROM pg_type t
     JOIN pg_namespace n ON t.typnamespace = n.oid
     WHERE t.typtype = 'e' AND n.nspname IN ('public', 'sde')
     ORDER BY t.typname, n.nspname`,
  );
  console.log('All enums:', enums.rows);

  const childStatus = await client.query(
    `SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS col_type
     FROM pg_attribute a
     JOIN pg_class c ON a.attrelid = c.oid
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = 'sde' AND c.relname = 'child' AND a.attname = 'status' AND NOT a.attisdropped`,
  );
  console.log('child.status column type:', childStatus.rows);

  await client.end();
}

main();
