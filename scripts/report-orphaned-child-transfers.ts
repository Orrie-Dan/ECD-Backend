/**
 * Read-only report: child_transfer rows whose child is not at to_center_id.
 *
 * These rows may indicate historical offline sync that created a transfer
 * without moving the child (pre-fix data). Manual review only — no writes.
 *
 * Usage (from repo root, with DATABASE_URL set or .env present):
 *   npx ts-node scripts/report-orphaned-child-transfers.ts
 *   npm run report:orphaned-transfers
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

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

async function main() {
  const prisma = new PrismaClient();

  try {
    const transfers = await prisma.childTransfer.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        childId: true,
        fromCenterId: true,
        toCenterId: true,
        transferDate: true,
        createdAt: true,
        child: {
          select: {
            centerId: true,
            deletedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const mismatched = transfers.filter(
      (t) =>
        t.child.deletedAt == null && t.child.centerId !== t.toCenterId,
    );

    console.log('=== Orphaned / mismatched child_transfer report (read-only) ===');
    console.log(`Total active transfers: ${transfers.length}`);
    console.log(
      `Mismatched (child.center_id != transfer.to_center_id): ${mismatched.length}`,
    );

    if (mismatched.length === 0) {
      console.log('No mismatched rows found.');
      return;
    }

    console.log('\nAffected rows:');
    for (const row of mismatched) {
      console.log(
        JSON.stringify({
          transferId: row.id,
          childId: row.childId,
          fromCenterId: row.fromCenterId,
          toCenterId: row.toCenterId,
          childCenterId: row.child.centerId,
          transferDate: row.transferDate,
          createdAt: row.createdAt,
        }),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: { code?: string; meta?: { table?: string }; message?: string }) => {
  if (err?.code === 'P2021') {
    console.error(
      `Database table missing (${err.meta?.table ?? 'unknown'}). ` +
        'Run migrations first (npm run prisma:migrate:deploy), then re-run this report.',
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
