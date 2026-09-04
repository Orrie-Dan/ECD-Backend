/**
 * One-time data migration: replace legacy / invalid child.national_id values
 * with valid 16-digit Rwanda NIN placeholders derived from DOB + gender.
 *
 * Targets rows where national_id:
 *   - is the literal string "undefined" or "null"
 *   - does not match the Rwanda NIN regex
 *
 * By default only active children are updated. Pass --all to include archived.
 *
 * Usage:
 *   npx ts-node scripts/migrate-national-ids.ts --dry-run
 *   DATABASE_URL=postgres://... npx ts-node scripts/migrate-national-ids.ts
 *   npm run migrate:national-ids -- --dry-run
 */

import { ChildGender, ChildStatus } from '../src/common/domain';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  buildPlaceholderNationalId,
} from '../src/modules/children/mappers/child.mapper';
import { RWANDA_NIN_REGEX } from '../src/modules/children/dto/create-child.dto';

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

const DRY_RUN = process.argv.includes('--dry-run');
const ALL_STATUSES = process.argv.includes('--all');

function isInvalidNationalId(value: string): boolean {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed === 'undefined' ||
    trimmed === 'null' ||
    !RWANDA_NIN_REGEX.test(trimmed)
  );
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');
    console.log(ALL_STATUSES ? 'Scope: all children' : 'Scope: active children only');

    const children = await prisma.child.findMany({
      where: {
        deletedAt: null,
        ...(ALL_STATUSES ? {} : { status: ChildStatus.active }),
      },
      select: {
        id: true,
        nationalId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        status: true,
      },
      orderBy: [{ dateOfBirth: 'asc' }, { id: 'asc' }],
    });

    const invalid = children.filter((child) => isInvalidNationalId(child.nationalId));
    console.log(`Found ${invalid.length} children with invalid national_id (of ${children.length} in scope).`);

    if (invalid.length === 0) {
      return;
    }

    const usedIds = new Set(
      children
        .filter((child) => !isInvalidNationalId(child.nationalId))
        .map((child) => child.nationalId.trim()),
    );

    let sequence = 1;
    const updates: Array<{
      id: string;
      name: string;
      from: string;
      to: string;
    }> = [];

    for (const child of invalid) {
      let nextId = buildPlaceholderNationalId(
        child.dateOfBirth,
        child.gender as ChildGender,
        sequence,
      );
      while (usedIds.has(nextId)) {
        sequence += 1;
        nextId = buildPlaceholderNationalId(
          child.dateOfBirth,
          child.gender as ChildGender,
          sequence,
        );
      }
      usedIds.add(nextId);
      sequence += 1;

      updates.push({
        id: child.id,
        name: [child.firstName, child.lastName].filter(Boolean).join(' '),
        from: child.nationalId,
        to: nextId,
      });
    }

    for (const row of updates) {
      console.log(`  ${row.name || row.id}`);
      console.log(`    ${row.from} -> ${row.to}`);
    }

    if (DRY_RUN) {
      console.log('\nDry run complete — no rows updated.');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const row of updates) {
        await tx.child.update({
          where: { id: row.id },
          data: { nationalId: row.to },
        });
      }
    });

    console.log(`\nUpdated ${updates.length} children.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
