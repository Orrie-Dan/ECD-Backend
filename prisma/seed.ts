/**

 * Bootstrap NCDA admin + survey import user.

 *

 * Uses raw SQL with public.* enum casts because EGDB stores app tables in sde

 * while PostgreSQL enums live in public (DATABASE_URL ?schema=sde).

 *

 * Usage:

 *   npm run seed:admin

 *   npx prisma db seed

 *

 * Optional env:

 *   SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD / SEED_ADMIN_FULL_NAME

 *   SEED_SURVEY_SYNC_USERNAME / SEED_SURVEY_SYNC_PASSWORD / SEED_SURVEY_SYNC_FULL_NAME

 */



import { existsSync, readFileSync } from 'fs';

import { resolve } from 'path';

import { Client } from 'pg';

import * as bcrypt from 'bcrypt';

import { randomUUID } from 'crypto';



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



async function upsertNcdaAdminUser(

  client: Client,

  username: string,

  passwordHash: string,

  fullName: string,

): Promise<string> {

  const existing = await client.query<{ id: string }>(

    `SELECT id FROM sde.user_account WHERE username = $1`,

    [username],

  );



  if (existing.rows.length > 0) {

    const id = existing.rows[0].id;

    await client.query(

      `UPDATE sde.user_account

       SET password_hash = $1,

           full_name = $2,

           role = 'ncda_admin',

           status = 'active',

           district_id = NULL,

           center_id = NULL,

           failed_login_attempts = 0,

           locked_until = NULL,

           password_changed_at = now(),

           updated_at = now()

       WHERE id = $3`,

      [passwordHash, fullName, id],

    );

    return id;

  }



  const id = randomUUID();

  await client.query(

    `INSERT INTO sde.user_account (

       id, username, password_hash, full_name, role, status,

       district_id, center_id, password_changed_at, created_at, updated_at

     ) VALUES (

       $1, $2, $3, $4,

       'ncda_admin',

       'active',

       NULL, NULL, now(), now(), now()

     )`,

    [id, username, passwordHash, fullName],

  );

  return id;

}



async function main() {

  const url = process.env.DATABASE_URL?.split('?')[0];

  if (!url) {

    throw new Error('DATABASE_URL is not set');

  }



  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'ncda_admin';

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const adminFullName = process.env.SEED_ADMIN_FULL_NAME ?? 'NCDA Admin';



  if (adminPassword.length < 8) {

    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');

  }



  const surveyUsername = process.env.SEED_SURVEY_SYNC_USERNAME ?? 'survey_sync';

  const surveyPassword = process.env.SEED_SURVEY_SYNC_PASSWORD ?? 'SurveySync123!';

  const surveyFullName = process.env.SEED_SURVEY_SYNC_FULL_NAME ?? 'Survey123 Import';



  if (surveyPassword.length < 8) {

    throw new Error('SEED_SURVEY_SYNC_PASSWORD must be at least 8 characters');

  }



  const client = new Client({ connectionString: url });

  await client.connect();



  try {

    const adminHash = await bcrypt.hash(adminPassword, 12);

    const adminId = await upsertNcdaAdminUser(client, adminUsername, adminHash, adminFullName);

    console.log(`Seeded NCDA admin: ${adminUsername} (${adminId})`);

    if (!process.env.SEED_ADMIN_PASSWORD) {

      console.log(

        'Using default password ChangeMe123! — set SEED_ADMIN_PASSWORD for a custom value.',

      );

    }



    const surveyHash = await bcrypt.hash(surveyPassword, 12);

    const surveyId = await upsertNcdaAdminUser(client, surveyUsername, surveyHash, surveyFullName);

    console.log(`Seeded survey import user: ${surveyUsername} (${surveyId})`);

  } finally {

    await client.end();

  }

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


