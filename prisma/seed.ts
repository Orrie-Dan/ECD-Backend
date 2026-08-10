/**
 * Bootstrap NCDA admin (no public registration; API cannot create ncda_admin).
 *
 * Usage (from repo root, DATABASE_URL via .env):
 *   npx prisma db seed
 *   npm run seed:admin
 *
 * Optional env:
 *   SEED_ADMIN_USERNAME (default: ncda_admin)
 *   SEED_ADMIN_PASSWORD (default: ChangeMe123!)
 *   SEED_ADMIN_FULL_NAME (default: NCDA Admin)
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PrismaClient,
  UserAccountStatus,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

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

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'ncda_admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const fullName = process.env.SEED_ADMIN_FULL_NAME ?? 'NCDA Admin';

  if (password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.userAccount.upsert({
    where: { username },
    update: {
      passwordHash,
      fullName,
      role: UserRole.ncda_admin,
      status: UserAccountStatus.active,
      districtId: null,
      centerId: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
    },
    create: {
      username,
      passwordHash,
      fullName,
      role: UserRole.ncda_admin,
      status: UserAccountStatus.active,
      districtId: null,
      centerId: null,
      passwordChangedAt: new Date(),
    },
  });

  console.log(`Seeded NCDA admin: ${user.username} (${user.id})`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(
      'Using default password ChangeMe123! — set SEED_ADMIN_PASSWORD for a custom value.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
