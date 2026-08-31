/**

 * Apply Scenario C GIS SQL phases from docs/gis/phases/.

 *

 * Usage:

 *   npx ts-node scripts/run-gis-scenario-c-phase.ts --through 3

 *   npx ts-node scripts/run-gis-scenario-c-phase.ts --phase 2

 *   npx ts-node scripts/run-gis-scenario-c-phase.ts --phase 1c-seed --url "postgresql://..."

 *

 * For hosted DBs / partial runs, prefer: npm run gis:deploy

 *

 * Uses DATABASE_URL from .env unless --url is passed.

 */



import { Client } from 'pg';

import {

  GIS_PHASE_FILES,

  GIS_PHASE_ORDER,

  loadEnvFile,

  redactUrl,

  runPhaseStrict,

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



async function main() {

  const url = getOption('url') || process.env.DATABASE_URL;

  if (!url) {

    console.error('DATABASE_URL not set. Pass --url or configure .env');

    process.exit(1);

  }



  const phaseOpt = getOption('phase') as GisPhaseId | undefined;

  const throughOpt = getOption('through') as GisPhaseId | undefined;



  let phases: GisPhaseId[];

  if (phaseOpt) {

    if (!GIS_PHASE_ORDER.includes(phaseOpt)) {

      console.error(`Unknown phase: ${phaseOpt}. Valid: ${GIS_PHASE_ORDER.join(', ')}`);

      process.exit(1);

    }

    phases = [phaseOpt];

  } else if (throughOpt) {

    const idx = GIS_PHASE_ORDER.indexOf(throughOpt);

    if (idx === -1) {

      console.error(`Unknown --through phase: ${throughOpt}`);

      process.exit(1);

    }

    phases = GIS_PHASE_ORDER.slice(0, idx + 1);

  } else {

    console.error('Pass --phase <id> or --through <id> (or use npm run gis:deploy)');

    process.exit(1);

  }



  console.log(`Target: ${redactUrl(url)}`);

  console.log(`Phases: ${phases.join(' → ')}`);



  const client = new Client({ connectionString: url });

  await client.connect();



  try {

    for (const phase of phases) {

      await runPhaseStrict(client, phase);

    }

    console.log('\nAll requested phases completed.');

  } finally {

    await client.end();

  }

}



main().catch((err) => {

  console.error(err instanceof Error ? err.message : err);

  process.exit(1);

});


