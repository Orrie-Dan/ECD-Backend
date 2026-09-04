import { UserAccountStatus, UserRole } from '../../../common/domain';
import { userMapper } from '../mappers/user.mapper';
import { UserWithRelations } from '../mappers/user.mapper';

/**
 * User mapper tests.
 * Run: npx ts-node src/modules/users/tests/user.mapper.spec.ts
 */

function sampleUser(overrides: Partial<UserWithRelations> = {}): UserWithRelations {
  const now = new Date('2026-08-01T10:00:00.000Z');
  return {
    id: 'user-1',
    username: 'caregiver1',
    passwordHash: 'SECRET_HASH_MUST_NOT_LEAK',
    fullName: 'Care Giver',
    phone: '0780000000',
    email: 'hidden@example.com',
    gender: null,
    educationLevel: null,
    role: UserRole.caregiver,
    districtId: 'd1',
    centerId: 'c1',
    status: UserAccountStatus.active,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: null,
    createdAt: now,
    createdById: 'admin-1',
    updatedAt: now,
    updatedById: 'admin-1',
    district: { id: 'd1', name: 'Gasabo' },
    center: { id: 'c1', code: 'CTR-01', name: 'Center One' },
    createdBy: {
      id: 'admin-1',
      username: 'ncda',
      fullName: 'NCDA Admin',
    },
    ...overrides,
  } as UserWithRelations;
}

async function run() {
  let passed = 0;
  let failed = 0;

  const assert = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(err);
    }
  };

  const eq = (actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  await assert('maps ACTIVE status from active', () => {
    const dto = userMapper.toDto(sampleUser());
    eq(dto.status, 'ACTIVE');
    eq(dto.username, 'caregiver1');
    eq(dto.district?.name, 'Gasabo');
    eq(dto.center?.code, 'CTR-01');
    eq(dto.createdBy?.username, 'ncda');
  });

  await assert('maps SUSPENDED status from inactive', () => {
    const dto = userMapper.toDto(sampleUser({ status: UserAccountStatus.inactive }));
    eq(dto.status, 'SUSPENDED');
  });

  await assert('mapper output does not expose passwordHash', () => {
    const dto = userMapper.toDto(sampleUser());
    const json = JSON.stringify(dto);
    eq(json.includes('passwordHash'), false);
    eq(json.includes('SECRET_HASH'), false);
    eq('passwordHash' in dto, false);
    eq('email' in dto, false);
    eq('failedLoginAttempts' in dto, false);
    eq('lockedUntil' in dto, false);
  });

  await assert('toDbStatus round-trip', () => {
    eq(userMapper.toDbStatus('ACTIVE'), UserAccountStatus.active);
    eq(userMapper.toDbStatus('SUSPENDED'), UserAccountStatus.inactive);
  });

  await assert('toCreateInput trims scalars', () => {
    const mapped = userMapper.toCreateInput({
      username: '  alice  ',
      fullName: '  Alice Admin ',
      role: UserRole.caregiver,
      centerId: 'c1',
      phone: ' 0781 ',
    });
    eq(mapped.username, 'alice');
    eq(mapped.fullName, 'Alice Admin');
    eq(mapped.phone, '0781');
    eq(mapped.centerId, 'c1');
    eq(mapped.gender, null);
    eq(mapped.educationLevel, null);
  });

  await assert('toUpdateInput cannot reassign centerId', () => {
    const mapped = userMapper.toUpdateInput({ fullName: 'A' });
    eq('centerId' in mapped, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
