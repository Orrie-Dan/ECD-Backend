import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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
  const c = new Client({ connectionString: url });
  await c.connect();
  const locks = await c.query(`
    SELECT pid, state, wait_event_type, wait_event, query_start, left(query, 120) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
    ORDER BY query_start NULLS LAST
  `);
  console.log(JSON.stringify(locks.rows, null, 2));
  await c.end();
}

main();
