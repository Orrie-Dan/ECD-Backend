/**
 * Recreate the ECD schema on a target Postgres database (new testing env).
 *
 * Applies every committed migration under prisma/migrations via
 * `prisma migrate deploy`. Schema + Prisma migration history only —
 * no application row data is copied.
 *
 * Usage (from repo root):
 *   npx ts-node scripts/recreate-schema.ts --url "postgresql://user:pass@host:5432/ecd_test"
 *   npm run prisma:recreate-schema -- --url "postgresql://..."
 *
 * If --url is omitted, DATABASE_URL from the environment or .env is used.
 *
 * Options:
 *   --url <DATABASE_URL>   Target database
 *   --reset                Drop public schema first (test DBs only; data loss)
 *   --yes                  Skip the --reset confirmation prompt
 *   --seed                 Seed the NCDA admin user after migrations
 *   --dump-sql [path]      Write CREATE SQL from schema.prisma and exit
 *                          (does not apply; prefer migrate deploy for Prisma DBs)
 *
 * Examples:
 *   npx ts-node scripts/recreate-schema.ts --url "postgresql://ecd:secret@new-host:5432/ecd" --seed
 *   npx ts-node scripts/recreate-schema.ts --url "postgresql://..." --reset --yes
 *   npx ts-node scripts/recreate-schema.ts --dump-sql prisma/schema.sql
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { Client } from 'pg';

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const args = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function getOption(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = args[i + 1];
  if (!next || next.startsWith('--')) return '';
  return next;
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/:[^:@/]+@/, ':***@');
  }
}

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const db = parsed.pathname.replace(/^\//, '') || '(none)';
    const schema = parsed.searchParams.get('schema') ?? 'public';
    return `${parsed.hostname}:${parsed.port || '5432'}/${db} (schema=${schema})`;
  } catch {
    return redactUrl(url);
  }
}

function runPrisma(prismaArgs: string[], databaseUrl: string): string {
  const result = spawnSync('npx', ['prisma', ...prismaArgs], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `prisma ${prismaArgs.join(' ')} failed (exit ${result.status})${detail ? `\n${detail}` : ''}`,
    );
  }
  return result.stdout ?? '';
}

function runPrismaInherit(prismaArgs: string[], databaseUrl: string): void {
  const result = spawnSync('npx', ['prisma', ...prismaArgs], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${prismaArgs.join(' ')} failed (exit ${result.status})`);
  }
}

async function confirmReset(target: string): Promise<boolean> {
  if (hasFlag('yes')) return true;
  if (!process.stdin.isTTY) {
    throw new Error('Refusing --reset without a TTY. Re-run with --yes to confirm.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolveAnswer) => {
    rl.question(
      `This will DROP SCHEMA public CASCADE on ${target}. Type YES to continue: `,
      resolveAnswer,
    );
  });
  rl.close();
  return answer.trim() === 'YES';
}

async function resetPublicSchema(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO public');
    console.log('Dropped and recreated schema public.');
  } finally {
    await client.end();
  }
}

async function ping(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ version: string }>('SELECT version()');
    console.log(`Connected: ${rows[0]?.version?.split(',')[0] ?? 'PostgreSQL'}`);
  } finally {
    await client.end();
  }
}

async function main() {
  const dumpSql = hasFlag('dump-sql') || getOption('dump-sql') !== undefined;
  const dumpPath = getOption('dump-sql');
  const targetUrl = getOption('url') || process.env.DATABASE_URL;

  if (dumpSql) {
    const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
    if (!existsSync(schemaPath)) {
      throw new Error('prisma/schema.prisma not found. Run from the repo root.');
    }
    console.log('Generating CREATE SQL from prisma/schema.prisma ...');
    const sql = runPrisma(
      [
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
      ],
      targetUrl || 'postgresql://unused:unused@localhost:5432/unused',
    );
    if (dumpPath) {
      const out = resolve(process.cwd(), dumpPath);
      writeFileSync(out, sql.endsWith('\n') ? sql : `${sql}\n`, 'utf8');
      console.log(`Wrote ${out}`);
    } else {
      process.stdout.write(sql.endsWith('\n') ? sql : `${sql}\n`);
    }
    console.log(
      'Note: applying this SQL by hand does not record Prisma migration history. Use this script without --dump-sql against the new DB instead.',
    );
    return;
  }

  if (!targetUrl) {
    throw new Error(
      'Set --url or DATABASE_URL to the new testing database.\n' +
        'Example: npx ts-node scripts/recreate-schema.ts --url "postgresql://user:pass@host:5432/ecd_test"',
    );
  }

  const target = describeTarget(targetUrl);
  console.log(`Target: ${target}`);
  console.log(`URL:    ${redactUrl(targetUrl)}`);

  await ping(targetUrl);

  if (hasFlag('reset')) {
    const ok = await confirmReset(target);
    if (!ok) {
      console.log('Aborted.');
      return;
    }
    await resetPublicSchema(targetUrl);
  }

  console.log('Generating Prisma client ...');
  runPrismaInherit(['generate'], targetUrl);

  console.log('Applying migrations (prisma migrate deploy) ...');
  runPrismaInherit(['migrate', 'deploy'], targetUrl);

  console.log('Migration status:');
  runPrismaInherit(['migrate', 'status'], targetUrl);

  if (hasFlag('seed')) {
    console.log('Seeding NCDA admin ...');
    runPrismaInherit(['db', 'seed'], targetUrl);
  }

  console.log(`Schema is ready on ${target}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
