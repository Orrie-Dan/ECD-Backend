/**
 * Seed realistic test children with attendance + growth (nutrition screenings).
 *
 * Usage:
 *   npx ts-node scripts/seed-test-children.ts
 *   npx ts-node scripts/seed-test-children.ts --center-id <uuid> --count 5
 *   npx ts-node scripts/seed-test-children.ts --dry-run
 *
 * Env (optional):
 *   API_BASE_URL=http://localhost:3000/api/v1
 *   SEED_USERNAME=ncda_admin
 *   SEED_PASSWORD=ChangeMe123!
 */

import { ChildGender, NutritionStatus } from '../src/common/domain';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { buildPlaceholderNationalId } from '../src/modules/children/mappers/child.mapper';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnv();

const API = (process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const USERNAME = process.env.SEED_USERNAME ?? 'ncda_admin';
const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
const DRY_RUN = process.argv.includes('--dry-run');

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const TARGET_COUNT = Number(getArg('count') ?? process.env.SEED_CHILD_COUNT ?? '20');
const CENTER_ID_ARG = getArg('center-id') ?? process.env.SEED_CENTER_ID;

type ApiGender = 'Umuhungu' | 'Umukobwa';

type TestChildSpec = {
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: ApiGender;
  dateOfBirth: string;
  guardianName: string;
  guardianPhone: string;
  guardianRelation: string;
};

const FIRST_NAMES_BOYS = [
  'Jean', 'Eric', 'Kevin', 'Patrick', 'Emmanuel', 'Fabrice', 'Olivier', 'Samuel',
  'Claude', 'Innocent', 'Moise', 'David', 'Alexis', 'Thierry', 'Didier',
];
const FIRST_NAMES_GIRLS = [
  'Chantal', 'Divine', 'Grace', 'Claire', 'Immaculee', 'Joyce', 'Sandrine',
  'Aline', 'Esperance', 'Marie', 'Ange', 'Yvette', 'Beatrice', 'Denyse', 'Solange',
];
const LAST_NAMES = [
  'Uwimana', 'Mukamurenzi', 'Habimana', 'Ishimwe', 'Nshimiyimana', 'Mugisha',
  'Niyonsenga', 'Uwase', 'Mukamana', 'Bizimana', 'Nkurunziza', 'Habyarimana',
  'Murenzi', 'Niyitegeka', 'Rukundo', 'Manirakiza', 'Ndahiro', 'Twagirumukiza',
];
const GUARDIAN_FIRST = [
  'Mukamana', 'Niyonsenga', 'Uwase', 'Mugisha', 'Nyirahabimana', 'Habimana',
  'Murenzi', 'Uwimana', 'Mukamurenzi', 'Bizimana',
];
const GUARDIAN_LAST = [
  'Alice', 'Paul', 'Grace', 'Jean', 'Rose', 'Emmanuel', 'Claire', 'Patrick',
  'Immaculee', 'Fabrice',
];
const RELATIONS = ['Mother', 'Father', 'Aunt', 'Uncle', 'Guardian'];

function buildTestChildren(count: number): TestChildSpec[] {
  const specs: TestChildSpec[] = [];
  for (let i = 0; i < count; i++) {
    const gender: ApiGender = i % 2 === 0 ? 'Umuhungu' : 'Umukobwa';
    const firstName =
      gender === 'Umuhungu'
        ? FIRST_NAMES_BOYS[i % FIRST_NAMES_BOYS.length]
        : FIRST_NAMES_GIRLS[i % FIRST_NAMES_GIRLS.length];
    const lastName = LAST_NAMES[i % LAST_NAMES.length];
    const birthYear = 2019 + (i % 5);
    const birthMonth = String((i % 12) + 1).padStart(2, '0');
    const birthDay = String((i % 27) + 1).padStart(2, '0');
    const guardianName = `${GUARDIAN_FIRST[i % GUARDIAN_FIRST.length]} ${GUARDIAN_LAST[(i + 3) % GUARDIAN_LAST.length]}`;

    specs.push({
      firstName,
      middleName: i % 3 === 0 ? 'Marie' : undefined,
      lastName,
      gender,
      dateOfBirth: `${birthYear}-${birthMonth}-${birthDay}`,
      guardianName,
      guardianPhone: `+250788${String(200000 + i).slice(-6)}`,
      guardianRelation: RELATIONS[i % RELATIONS.length],
    });
  }
  return specs;
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function login(): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.accessToken as string;
}

function toPrismaGender(g: ApiGender): ChildGender {
  return g === 'Umuhungu' ? ChildGender.male : ChildGender.female;
}

function recentWeekdays(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < count) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day >= 1 && day <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

function growthProfile(dob: string) {
  const ageYears =
    (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const baseWeight = 8 + ageYears * 2.2;
  const baseHeight = 70 + ageYears * 7;
  const baseMuac = 12 + ageYears * 0.8;
  return { baseWeight, baseHeight, baseMuac };
}

async function seedAttendanceAndGrowth(
  token: string,
  centerId: string,
  childIds: string[],
  specs: Array<{ firstName: string; dateOfBirth: string }>,
) {
  const dates = recentWeekdays(10);
  const attendanceRecords = childIds.flatMap((childId, idx) =>
    dates.map((date, dayIdx) => {
      const present = (idx + dayIdx) % 7 !== 0;
      return present
        ? { childId, date, present: true }
        : { childId, date, present: false, absentReason: 'sick' };
    }),
  );

  const ATTENDANCE_CHUNK = 10;
  let createdAtt = 0;
  for (let c = 0; c < attendanceRecords.length; c += ATTENDANCE_CHUNK) {
    const chunk = attendanceRecords.slice(c, c + ATTENDANCE_CHUNK);
    const attendanceResult = await api<{ items: Array<{ outcome: string }> }>(
      '/attendance/batch',
      token,
      {
        method: 'POST',
        body: JSON.stringify({ centerId, records: chunk }),
      },
    );
    createdAtt += attendanceResult.items.filter((x) => x.outcome === 'created').length;
  }
  console.log(`Attendance: ${createdAtt} records created across ${dates.length} weekdays`);

  for (const [idx, childId] of childIds.entries()) {
    const spec = specs[idx];
    const { baseWeight, baseHeight, baseMuac } = growthProfile(spec.dateOfBirth);
    const screeningDates = ['2025-06-01', '2025-07-01', '2025-08-01'];

    for (const [j, screeningDate] of screeningDates.entries()) {
      await api(`/children/${childId}/nutrition-screenings`, token, {
        method: 'POST',
        body: JSON.stringify({
          screeningDate,
          weightKg: Number((baseWeight + j * 0.4).toFixed(2)),
          heightCm: Number((baseHeight + j * 1.2).toFixed(1)),
          muacCm: Number((baseMuac + j * 0.2).toFixed(1)),
          headCircumferenceCm: Number((46 + j * 0.3).toFixed(1)),
          nutritionStatus: NutritionStatus.normal,
          mealQuality: 'Balanced',
          feedingConcern: false,
        }),
      });
    }

    const chart = await api<{ weight: unknown[]; height: unknown[] }>(
      `/children/${childId}/growth-chart`,
      token,
    );
    console.log(
      `  Growth for ${spec.firstName}: ${chart.weight.length} weight points, ${chart.height.length} height points`,
    );
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const center = CENTER_ID_ARG
      ? await prisma.ecdCenter.findFirstOrThrow({
          where: { id: CENTER_ID_ARG, deletedAt: null },
          select: { id: true, name: true, villageId: true },
        })
      : await prisma.ecdCenter.findFirstOrThrow({
          where: { deletedAt: null },
          select: { id: true, name: true, villageId: true },
          orderBy: { name: 'asc' },
        });

    const existingCount = await prisma.child.count({
      where: { centerId: center.id, deletedAt: null, status: 'active' },
    });
    const toCreate = Math.max(0, TARGET_COUNT - existingCount);
    const specs = buildTestChildren(toCreate);
    const ninOffset = 900000 + existingCount;

    console.log(`Center: ${center.name} (${center.id})`);
    console.log(`Existing active children: ${existingCount}, target: ${TARGET_COUNT}`);

    if (toCreate === 0) {
      const missingGrowth = await prisma.child.findMany({
        where: {
          centerId: center.id,
          deletedAt: null,
          status: 'active',
          nutritionScreenings: { none: {} },
        },
        select: { id: true, firstName: true, dateOfBirth: true },
      });
      if (missingGrowth.length === 0) {
        console.log('Target already met — all children have attendance/growth data.');
        return;
      }
      console.log(`Target met. Backfilling ${missingGrowth.length} children missing growth data...`);
      if (DRY_RUN) return;

      const token = await login();
      const specs = missingGrowth.map((c) => ({
        firstName: c.firstName,
        dateOfBirth: c.dateOfBirth.toISOString().slice(0, 10),
      }));
      const createdChildIds = missingGrowth.map((c) => c.id);
      await seedAttendanceAndGrowth(token, center.id, createdChildIds, specs);
      console.log('\nDone.');
      return;
    }

    console.log(`Creating ${specs.length} children${DRY_RUN ? ' [DRY RUN]' : ''}...`);

    if (DRY_RUN) {
      for (const [i, spec] of specs.entries()) {
        const nin = buildPlaceholderNationalId(
          new Date(spec.dateOfBirth),
          toPrismaGender(spec.gender),
          ninOffset + i,
        );
        console.log(`  ${spec.firstName} ${spec.lastName} | NIN ${nin} | DOB ${spec.dateOfBirth}`);
      }
      return;
    }

    const token = await login();
    const createdChildIds: string[] = [];

    for (const [i, spec] of specs.entries()) {
      const nationalId = buildPlaceholderNationalId(
        new Date(spec.dateOfBirth),
        toPrismaGender(spec.gender),
        ninOffset + i,
      );

      const child = await api<{ id: string; fullName: string }>('/children', token, {
        method: 'POST',
        body: JSON.stringify({
          firstName: spec.firstName,
          middleName: spec.middleName,
          lastName: spec.lastName,
          dateOfBirth: spec.dateOfBirth,
          gender: spec.gender,
          centerId: center.id,
          nationalId,
          homeVillageId: center.villageId,
          guardianName: spec.guardianName,
          guardianPhone: spec.guardianPhone,
          guardianRelation: spec.guardianRelation,
          registeredAt: '2025-09-01',
        }),
      });

      createdChildIds.push(child.id);
      console.log(`  Registered: ${child.fullName} (${child.id})`);
    }

    await seedAttendanceAndGrowth(
      token,
      center.id,
      createdChildIds,
      specs.map((s) => ({ firstName: s.firstName, dateOfBirth: s.dateOfBirth })),
    );

    console.log('\nDone.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
