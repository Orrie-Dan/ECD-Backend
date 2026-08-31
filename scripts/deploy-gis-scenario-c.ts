/**
 * One-shot idempotent GIS Scenario C deploy (phases 0–8).
 *
 * Safe to re-run on partial or complete databases: skips "already exists" errors
 * per SQL statement instead of aborting the whole phase.
 *
 * Usage:
 *   npm run gis:deploy
 *   npm run gis:deploy -- --url "postgresql://..."
 *   npm run gis:deploy -- --no-verify
 *
 * Prerequisite: base app schema (npm run prisma:migrate:deploy).
 */

import { spawnSync } from 'child_process';
import { Client } from 'pg';
import {
  GIS_PHASE_ORDER,
  loadEnvFile,
  redactUrl,
  runPhaseIdempotent,
  type GisPhaseId,
} from './gis-scenario-c-shared';

loadEnvFile();

const args = process.argv.slice(2);

function getOption(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = args[i + 1];
  if (!next || next.startsWith('--')) return '';
  return next;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

async function main() {
  const url = getOption('url') || process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set. Pass --url or configure .env');
    process.exit(1);
  }

  const skipVerify = hasFlag('no-verify');
  const phases: GisPhaseId[] = [...GIS_PHASE_ORDER];

  console.log('GIS Scenario C — idempotent deploy');
  console.log(`Target: ${redactUrl(url)}`);
  console.log(`Phases: ${phases.join(' → ')}`);

  const client = new Client({ connectionString: url });
  await client.connect();

  let totalApplied = 0;
  let totalSkipped = 0;

  try {
    for (const phase of phases) {
      const result = await runPhaseIdempotent(client, phase);
      totalApplied += result.applied;
      totalSkipped += result.skipped;
    }

    console.log(`\nDeploy complete (${totalApplied} statements applied, ${totalSkipped} skipped).`);
  } finally {
    await client.end();
  }

  if (!skipVerify) {
    console.log('\nRunning gis:verify:phase8...\n');
    const verify = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'gis:verify:phase8'],
      {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: url },
        shell: process.platform === 'win32',
      },
    );
    if (verify.status !== 0) {
      console.error('\nVerification failed — review output above.');
      process.exit(verify.status ?? 1);
    }
  }

  console.log('\nGIS deploy finished successfully.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
