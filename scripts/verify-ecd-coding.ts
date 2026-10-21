/**
 * Database-level checks for NCDA ECD coding (migrations 20261021120000–140000):
 * generator, per-village counter under concurrency, immutability trigger,
 * override, legacy re-code, and Survey123 matching.
 *
 * WRITES FIXTURE DATA. Runs only against a database passed explicitly with
 * --url, and only on localhost unless --allow-remote is given. Never point it
 * at a shared database.
 *
 * Usage:
 *   npx ts-node scripts/verify-ecd-coding.ts --url postgresql://user:pass@localhost:5432/db
 */

import { Client } from 'pg';
import { randomUUID } from 'crypto';

function parseArgs(argv: string[]) {
  const i = argv.indexOf('--url');
  const url = i >= 0 ? argv[i + 1] : undefined;
  if (!url) throw new Error('--url is required (this script writes fixture data)');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !argv.includes('--allow-remote')) {
    throw new Error(`Refusing to run against non-local host ${host}`);
  }
  return { url };
}

let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL: ${name}\n  ${(e as Error).message}`);
  }
}

function eq(actual: unknown, expected: unknown, label = 'eq') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

async function expectError(fn: () => Promise<unknown>, text: string) {
  try {
    await fn();
  } catch (e) {
    if (!(e as Error).message.includes(text)) {
      throw new Error(`expected error containing "${text}", got "${(e as Error).message}"`);
    }
    return;
  }
  throw new Error(`expected error containing "${text}"`);
}

async function main() {
  const { url } = parseArgs(process.argv.slice(2));
  const db = new Client({ connectionString: url });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows as T[];

  // ---- fixture: Umujyi wa Kigali › Nyarugenge › Gitega › Akabahizi › {Sani, Uncoded, Full} ----
  const tag = randomUUID().slice(0, 8);
  const ids = {
    province: randomUUID(),
    district: randomUUID(),
    sector: randomUUID(),
    cell: randomUUID(),
    village: randomUUID(),
    villageUncoded: randomUUID(),
    villageFull: randomUUID(),
    user: randomUUID(),
  };
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  const prov = `verify-${tag}`;
  const distCode = `${prov}-nyarugenge`;
  const secCode = `${distCode}-gitega`;
  const cellCode = `${secCode}-akabahizi`;
  await q(
    `INSERT INTO sde.administrative_unit (id, level, code, name, minaloc_code) VALUES ($1,'province',$2,$3,NULL)`,
    [ids.province, prov, `Verify ${tag}`],
  );
  await q(`INSERT INTO sde.district (id, province_id, code, name) VALUES ($1,$2,$3,'Nyarugenge')`, [
    ids.district,
    ids.province,
    distCode,
  ]);
  await q(
    `INSERT INTO sde.administrative_unit (id, level, code, name, district_id) VALUES ($1,'sector',$2,'Gitega',$3)`,
    [ids.sector, secCode, ids.district],
  );
  await q(
    `INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id) VALUES ($1,'cell',$2,'Akabahizi',$3,$4)`,
    [ids.cell, cellCode, ids.sector, ids.district],
  );
  // Random 10-digit geo codes keep reruns independent.
  const geo = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const geoFull = `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  await q(
    `INSERT INTO sde.administrative_unit (id, level, code, name, parent_id, district_id, minaloc_code) VALUES
       ($1,'village',$2,'Sani',$5,$6,$7),
       ($3,'village',$4,'Uncoded',$5,$6,NULL),
       ($8,'village',$9,'Full',$5,$6,$10)`,
    [
      ids.village,
      `${cellCode}-${slug('Sani')}`,
      ids.villageUncoded,
      `${cellCode}-uncoded`,
      ids.cell,
      ids.district,
      geo,
      ids.villageFull,
      `${cellCode}-full`,
      geoFull,
    ],
  );
  await q(
    `INSERT INTO sde.user_account (id, username, password_hash, full_name, role) VALUES ($1,$2,'x','Verify','ncda_admin')`,
    [ids.user, `verify-${tag}`],
  );
  const year = new Date().getUTCFullYear();

  /** Issue + insert a center in one transaction on its own connection. */
  async function createCenter(conn: Client, village: string, letter = 'C', startYear = 2020) {
    const id = randomUUID();
    await conn.query('BEGIN');
    try {
      const [{ code }] = (
        await conn.query(`SELECT survey.issue_ecd_code($1,$2,$3,$4,$5) AS code`, [
          id,
          village,
          letter,
          startYear,
          ids.user,
        ])
      ).rows;
      await conn.query(
        `INSERT INTO sde.ecd_center (id, district_id, village_id, code, name, facility_type, ncda_type_code, start_year)
         VALUES ($1,$2,$3,$4,'Verify center',survey.ncda_type_to_facility_type($5),$5,$6)`,
        [id, ids.district, village, code, letter, startYear],
      );
      await conn.query('COMMIT');
      return { id, code: code as string };
    } catch (e) {
      await conn.query('ROLLBACK');
      throw e;
    }
  }

  await check('issue: first code in village matches guideline format', async () => {
    const c = await createCenter(db, ids.village, 'C', 2020);
    eq(c.code, `${geo}/C/2020/01`);
  });

  await check('issue: 30 concurrent registrations get distinct, contiguous numbers', async () => {
    const conns = await Promise.all(
      Array.from({ length: 30 }, async () => {
        const c = new Client({ connectionString: url });
        await c.connect();
        return c;
      }),
    );
    try {
      const codes = await Promise.all(conns.map((c) => createCenter(c, ids.village, 'B', 2021)));
      const nn = codes.map((c) => Number(c.code.slice(-2))).sort((a, b) => a - b);
      eq(
        nn,
        Array.from({ length: 30 }, (_, i) => i + 2),
        'NN 02..31',
      );
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });

  await check('issue: rejects uncoded village, bad letter, future/early year', async () => {
    await expectError(() => createCenter(db, ids.villageUncoded), 'ECD_CODE_VILLAGE_NOT_CODED');
    await expectError(() => createCenter(db, ids.village, 'F'), 'ECD_CODE_INVALID_TYPE');
    await expectError(() => createCenter(db, ids.village, 'C', year + 1), 'ECD_CODE_INVALID_YEAR');
    await expectError(() => createCenter(db, ids.village, 'C', 1949), 'ECD_CODE_INVALID_YEAR');
  });

  await check(
    'issue: failed insert rolls back counter and registry (no gaps consumed)',
    async () => {
      const before = (
        await q<{ last_seq: number }>(
          `SELECT last_seq FROM sde.ecd_code_sequence WHERE village_id=$1`,
          [ids.village],
        )
      )[0].last_seq;
      await db.query('BEGIN');
      await db.query(`SELECT survey.issue_ecd_code($1,$2,'C',2020,NULL)`, [
        randomUUID(),
        ids.village,
      ]);
      await expectError(() => db.query('COMMIT'), 'ecd_code_registry_center_id_fkey'); // deferred FK: no center row
      const after = (
        await q<{ last_seq: number }>(
          `SELECT last_seq FROM sde.ecd_code_sequence WHERE village_id=$1`,
          [ids.village],
        )
      )[0].last_seq;
      eq(after, before);
    },
  );

  await check('issue: 99 per village, then exhausted', async () => {
    await q(`INSERT INTO sde.ecd_code_sequence (village_id, last_seq) VALUES ($1, 98)`, [
      ids.villageFull,
    ]);
    const c = await createCenter(db, ids.villageFull);
    eq(c.code.endsWith('/99'), true, c.code);
    await expectError(() => createCenter(db, ids.villageFull), 'ECD_CODE_SEQUENCE_EXHAUSTED');
  });

  await check('immutability: insert with unissued code and code update both rejected', async () => {
    await expectError(
      () =>
        q(
          `INSERT INTO sde.ecd_center (id, district_id, village_id, code, name) VALUES ($1,$2,$3,'HAND-TYPED','x')`,
          [randomUUID(), ids.district, ids.village],
        ),
      'ECD_CODE_NOT_ISSUED',
    );
    const c = await createCenter(db, ids.village);
    await expectError(
      () => q(`UPDATE sde.ecd_center SET code = 'X' WHERE id = $1`, [c.id]),
      'ECD_CODE_IMMUTABLE',
    );
    await expectError(
      () => q(`UPDATE sde.ecd_center SET legacy_code = 'X' WHERE id = $1`, [c.id]),
      'ECD_CODE_IMMUTABLE',
    );
    await q(`UPDATE sde.ecd_center SET name = 'renamed', village_id = $2 WHERE id = $1`, [
      c.id,
      ids.villageUncoded,
    ]);
    eq(
      (await q(`SELECT code FROM sde.ecd_center WHERE id=$1`, [c.id]))[0].code,
      c.code,
      'other fields editable, code kept',
    );
  });

  await check('type/facility constraint: letter must agree with facility_type', async () => {
    const c = await createCenter(db, ids.village, 'B');
    await expectError(
      () => q(`UPDATE sde.ecd_center SET facility_type='daycare' WHERE id=$1`, [c.id]),
      'ecd_center_ncda_type_matches_facility_type',
    );
  });

  await check(
    'override: replaces code, retires old, old code can never be reissued; generator skips taken numbers',
    async () => {
      const c = await createCenter(db, ids.village);
      const seq = (
        await q<{ last_seq: number }>(
          `SELECT last_seq FROM sde.ecd_code_sequence WHERE village_id=$1`,
          [ids.village],
        )
      )[0].last_seq;
      const ahead = `${geo}/C/2020/${String(seq + 1).padStart(2, '0')}`;
      await db.query('BEGIN');
      const [{ old }] = (
        await db.query(`SELECT survey.override_ecd_code($1,$2,'wrong type',$3) AS old`, [
          c.id,
          ahead,
          ids.user,
        ])
      ).rows;
      await db.query('COMMIT');
      eq(old, c.code);
      const row = (
        await q(`SELECT code, legacy_code, version FROM sde.ecd_center WHERE id=$1`, [c.id])
      )[0];
      eq([row.code, row.legacy_code, row.version], [ahead, null, 2]);
      eq(
        (await q(`SELECT retired_reason FROM sde.ecd_code_registry WHERE code=$1`, [c.code]))[0]
          .retired_reason,
        'wrong type',
      );
      const other = await createCenter(db, ids.village);
      await expectError(
        () => q(`SELECT survey.override_ecd_code($1,$2,'reuse',$3)`, [other.id, c.code, ids.user]),
        'ECD_CODE_ALREADY_ISSUED',
      );
      eq(
        other.code.endsWith(String(seq + 2).padStart(2, '0')),
        true,
        `skipped override number: ${other.code}`,
      );
      await expectError(
        () => q(`SELECT survey.override_ecd_code($1,'bad','x',$2)`, [other.id, ids.user]),
        'ECD_CODE_INVALID_FORMAT',
      );
      // Replacement must match the center's village, letter and year (other is C/2020 in geo).
      for (const wrong of [`${geo}/B/2020/90`, `${geo}/C/2019/90`, `${geoFull}/C/2020/90`]) {
        await expectError(
          () => q(`SELECT survey.override_ecd_code($1,$2,'x',$3)`, [other.id, wrong, ids.user]),
          'ECD_CODE_MISMATCH',
        );
      }
    },
  );

  await check(
    'recode: legacy center gets NCDA code, keeps legacy_code, bumps version; second call is a no-op',
    async () => {
      const id = randomUUID();
      const legacy = `L${tag}/2019/01`;
      await db.query('BEGIN');
      await db.query(`SELECT set_config('ecd.allow_code_change','on',true)`); // simulate pre-existing row
      await db.query(
        `INSERT INTO sde.ecd_center (id, district_id, village_id, code, name, facility_type) VALUES ($1,$2,$3,$4,'Legacy','ecd_3_5')`,
        [id, ids.district, ids.village, legacy],
      );
      await db.query('COMMIT');
      const [{ code }] = await q<{ code: string }>(
        `SELECT survey.recode_ecd_center($1,'E',2019,$2) AS code`,
        [id, ids.user],
      );
      const row = (
        await q(
          `SELECT code, legacy_code, ncda_type_code, facility_type, start_year, version FROM sde.ecd_center WHERE id=$1`,
          [id],
        )
      )[0];
      eq(
        [
          row.code,
          row.legacy_code,
          row.ncda_type_code,
          row.facility_type,
          row.start_year,
          row.version,
        ],
        [code, legacy, 'E', 'ecd_3_5', 2019, 2],
      );
      const [{ code: again }] = await q<{ code: string }>(
        `SELECT survey.recode_ecd_center($1,'E',2019,$2) AS code`,
        [id, ids.user],
      );
      eq(again, code);
      eq(
        (await q(`SELECT version FROM sde.ecd_center WHERE id=$1`, [id]))[0].version,
        2,
        'no second bump',
      );
    },
  );

  // ---- Survey123 ----
  const objectid = () => Math.floor(Math.random() * 1e9);
  const surveyRow = async (oid: number, fields: Record<string, unknown>) => {
    const base = {
      objectid: oid,
      name_ecd_sercive: 'Survey Center',
      province_name: `Verify ${tag}`,
      district_name: 'Nyarugenge',
      sector_name: 'Gitega',
      cell_name: 'Akabahizi',
      village_name: 'Sani',
      active_not_active: 'Active',
      settings_types: 'Community Based ECD',
      start_year_ecd: '2018-03-01',
      ...fields,
    };
    const cols = Object.keys(base);
    await q(
      `INSERT INTO sde.ecd_mapping_form (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(base),
    );
    return (
      await q(
        `SELECT center_id, ncda_code, sync_status, sync_error FROM sde.ecd_mapping_form WHERE objectid=$1`,
        [oid],
      )
    )[0];
  };

  await check(
    'survey: new facility without ecd_code is created with an issued code, written back to ncda_code',
    async () => {
      const r = await surveyRow(objectid(), {});
      eq(r.sync_status, 'applied', String(r.sync_error));
      const c = (
        await q(
          `SELECT code, ncda_type_code, facility_type, start_year FROM sde.ecd_center WHERE id=$1`,
          [r.center_id],
        )
      )[0];
      eq([c.ncda_type_code, c.facility_type, c.start_year], ['C', 'community_based', 2018]);
      eq(r.ncda_code, c.code);
      eq(String(c.code).startsWith(`${geo}/C/2018/`), true, String(c.code));
    },
  );

  await check(
    'survey: Model ECD → E; unmapped type, missing year, unregistered village → failed, nothing created',
    async () => {
      const e = await surveyRow(objectid(), { settings_types: 'Model ECD' });
      eq(
        (await q(`SELECT ncda_type_code FROM sde.ecd_center WHERE id=$1`, [e.center_id]))[0]
          .ncda_type_code,
        'E',
      );
      const before = Number((await q(`SELECT count(*) AS n FROM sde.ecd_center`))[0].n);
      for (const [fields, text] of [
        [{ settings_types: 'Other' }, 'no NCDA type letter'],
        [{ start_year_ecd: null }, 'start_year_ecd is required'],
        [{ village_name: 'Not In Register' }, 'ECD_CODE_VILLAGE_NOT_CODED'],
      ] as Array<[Record<string, unknown>, string]>) {
        const r = await surveyRow(objectid(), fields);
        eq(r.sync_status, 'failed');
        if (!String(r.sync_error).includes(text))
          throw new Error(`sync_error "${r.sync_error}" lacks "${text}"`);
      }
      eq(
        Number((await q(`SELECT count(*) AS n FROM sde.ecd_center`))[0].n),
        before,
        'no centers created',
      );
    },
  );

  await check(
    'survey: editing a re-coded center (old ecd_code) updates it — no duplicate, code unchanged',
    async () => {
      const id = randomUUID();
      const legacy = `S${tag}/2016/01`;
      await db.query('BEGIN');
      await db.query(`SELECT set_config('ecd.allow_code_change','on',true)`);
      await db.query(
        `INSERT INTO sde.ecd_center (id, district_id, village_id, code, name, facility_type) VALUES ($1,$2,$3,$4,'Old','home_based')`,
        [id, ids.district, ids.village, legacy],
      );
      await db.query('COMMIT');
      const [{ code }] = await q<{ code: string }>(
        `SELECT survey.recode_ecd_center($1,'B',2016,NULL) AS code`,
        [id],
      );

      const before = Number((await q(`SELECT count(*) AS n FROM sde.ecd_center`))[0].n);
      const oid = objectid();
      const r = await surveyRow(oid, {
        ecd_code: legacy,
        name_ecd_sercive: 'Renamed via survey',
        settings_types: 'Home Based ECD',
      });
      eq([r.sync_status, r.center_id, r.ncda_code], ['applied', id, code], String(r.sync_error));
      eq(
        Number((await q(`SELECT count(*) AS n FROM sde.ecd_center`))[0].n),
        before,
        'no duplicate',
      );

      await q(
        `UPDATE sde.ecd_mapping_form SET name_ecd_sercive='Renamed again', ecd_code='SOMETHING-ELSE' WHERE objectid=$1`,
        [oid],
      );
      const c = (await q(`SELECT name, code FROM sde.ecd_center WHERE id=$1`, [id]))[0];
      eq(
        [c.name, c.code],
        ['Renamed again', code],
        'matched by center_id even after ecd_code edit',
      );
    },
  );

  await check('survey: override propagates to ecd_mapping_form.ncda_code', async () => {
    const r = await surveyRow(objectid(), {});
    const seq = (
      await q<{ last_seq: number }>(
        `SELECT last_seq FROM sde.ecd_code_sequence WHERE village_id=$1`,
        [ids.village],
      )
    )[0].last_seq;
    const next = `${geo}/C/2018/${String(seq + 1).padStart(2, '0')}`;
    await q(`SELECT survey.override_ecd_code($1,$2,'fix',$3)`, [r.center_id, next, ids.user]);
    eq(
      (await q(`SELECT ncda_code FROM sde.ecd_mapping_form WHERE center_id=$1`, [r.center_id]))[0]
        .ncda_code,
      next,
    );
  });

  await db.end();
  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll ECD coding database checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
