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

  const blocked = await c.query<{ pid: number; state: string; query: string }>(`
    SELECT pid, state, left(query, 100) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND (
        state = 'idle in transaction'
        OR (state = 'active' AND wait_event = 'transactionid')
      )
      AND query ILIKE '%administrative_unit%'
  `);

  for (const row of blocked.rows) {
    console.log(`Terminating pid ${row.pid} (${row.state}): ${row.query}`);
    await c.query('SELECT pg_terminate_backend($1)', [row.pid]);
  }

  console.log(`Terminated ${blocked.rows.length} session(s).`);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
