import { ChildGender, ChildStatus } from '@prisma/client';
import {
  childMapper,
  resolveChildGenderFromPayload,
  resolveChildNationalIdFromPayload,
} from '../mappers/child.mapper';

/**
 * Children mapper / contract tests.
 * Run: npx ts-node src/modules/children/__tests__/child-mapper.spec.ts
 */

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
      throw new Error(
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };

  await assert('fullName mapping: joins first/middle/last', () => {
    eq(childMapper.toFullName('Jean', 'Pierre', 'Uwimana'), 'Jean Pierre Uwimana');
    eq(childMapper.toFullName('Jean', null, 'Uwimana'), 'Jean Uwimana');
    eq(childMapper.toFullName('Jean', null, null), 'Jean');
  });

  await assert('fullName split: first token + remaining lastName', () => {
    const parts = childMapper.splitFullName('Jean Pierre Uwimana');
    eq(parts.firstName, 'Jean');
    eq(parts.middleName, null);
    eq(parts.lastName, 'Pierre Uwimana');
  });

  await assert('structured names: backward compatible', () => {
    const parts = childMapper.resolveNameParts({
      firstName: 'Marie',
      middleName: 'Claire',
      lastName: 'Mukamana',
    });
    eq(parts.firstName, 'Marie');
    eq(parts.middleName, 'Claire');
    eq(parts.lastName, 'Mukamana');
  });

  await assert('gender mapping: DB ↔ API', () => {
    eq(childMapper.toApiGender(ChildGender.male), 'Umuhungu');
    eq(childMapper.toApiGender(ChildGender.female), 'Umukobwa');
    eq(childMapper.toDbGender('Umuhungu'), ChildGender.male);
    eq(childMapper.toDbGender('Umukobwa'), ChildGender.female);
  });

  await assert('resolveChildGenderFromPayload accepts UI and harness values', () => {
    eq(resolveChildGenderFromPayload({ gender: 'Umuhungu' }), ChildGender.male);
    eq(resolveChildGenderFromPayload({ gender: 'Umukobwa' }), ChildGender.female);
    eq(resolveChildGenderFromPayload({ gender: 'male' }), ChildGender.male);
    eq(resolveChildGenderFromPayload({ gender: 'female' }), ChildGender.female);
  });

  await assert('resolveChildNationalIdFromPayload accepts nationalId and legacy registrationNumber', () => {
    const valid = '1202480000001000';
    eq(resolveChildNationalIdFromPayload({ nationalId: valid }), valid);
    eq(
      resolveChildNationalIdFromPayload({ registrationNumber: valid }),
      valid,
    );
  });

  await assert('resolveChildNationalIdFromPayload rejects missing and sentinel values', () => {
    const rejects = (payload: Record<string, unknown>) => {
      try {
        resolveChildNationalIdFromPayload(payload);
        throw new Error('expected throw');
      } catch (err) {
        if (err instanceof Error && err.message === 'expected throw') {
          throw err;
        }
      }
    };
    rejects({});
    rejects({ nationalId: 'undefined' });
    rejects({ nationalId: 'null' });
    rejects({ nationalId: 'ECD-2026-b633' });
    rejects({ registrationNumber: '' });
  });

  await assert('pagination shape: items/pageSize (not data/meta)', () => {
    const page = 2;
    const pageSize = 10;
    const total = 25;
    const response = {
      items: [{ id: '1' }, { id: '2' }],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
    eq(Array.isArray(response.items), true);
    eq(response.pageSize, 10);
    eq(response.totalPages, 3);
    eq('data' in response, false);
    eq('meta' in response, false);
  });

  await assert('toDto: fullName + localized gender, no DB gender leak', () => {
    const dto = childMapper.toDto({
      id: 'c1',
      nationalId: 'REG-1',
      firstName: 'Jean',
      middleName: null,
      lastName: 'Habimana',
      centerId: 'center-1',
      classroomId: null,
      dateOfBirth: new Date('2020-01-01'),
      gender: ChildGender.male,
      status: ChildStatus.active,
      specialNeeds: null,
      disabilityNotes: null,
      guardianName: 'Parent',
      guardianPhone: '0780000000',
      guardianRelation: 'mother',
      guardian2Name: null,
      guardian2Phone: null,
      guardian2Relation: null,
      homeVillageId: 'v1',
      registeredAt: new Date('2024-01-01'),
      archiveReason: null,
      archivedAt: null,
      createdAt: new Date('2024-01-01'),
      createdById: null,
      updatedAt: new Date('2024-01-02'),
      updatedById: null,
      deletedAt: null,
      version: 1,
      syncStatus: 'synced' as never,
      lastModifiedByDeviceId: null,
      lastModifiedAt: new Date('2024-01-02'),
      center: {
        id: 'center-1',
        name: 'ECD Kigali',
        districtId: 'd1',
        district: {
          name: 'Gasabo',
          province: { name: 'Kigali' },
        },
      },
      homeVillage: {
        id: 'v1',
        name: 'Village A',
        level: 'village' as never,
        parent: {
          id: 'cell-1',
          name: 'Cell A',
          level: 'cell' as never,
          parent: {
            id: 'sec-1',
            name: 'Sector A',
            level: 'sector' as never,
            district: {
              name: 'Gasabo',
              province: { name: 'Kigali' },
            },
          },
        },
      },
    });

    eq(dto.fullName, 'Jean Habimana');
    eq(dto.gender, 'Umuhungu');
    eq(dto.centerName, 'ECD Kigali');
    eq(dto.village, 'Village A');
    eq(dto.cell, 'Cell A');
    eq(dto.sector, 'Sector A');
    eq(dto.district, 'Gasabo');
    eq(dto.province, 'Kigali');
    eq(dto.nationalId, 'REG-1');
    eq(dto.version, 1);
    // Structured name parts remain detail-only (list stays lighter).
    eq((dto as { firstName?: string }).firstName, undefined);
  });

  await assert('archive/reactivate field mapping via detail DTO', () => {
    const baseEntity = {
      id: 'c1',
      nationalId: 'REG-1',
      firstName: 'Aline',
      middleName: null,
      lastName: null,
      centerId: 'center-1',
      dateOfBirth: new Date('2020-01-01'),
      gender: ChildGender.female,
      status: ChildStatus.archived,
      specialNeeds: 'speech',
      disabilityNotes: 'follow-up',
      guardianName: 'Parent',
      guardianPhone: '0780000000',
      guardianRelation: 'mother',
      guardian2Name: 'Uncle',
      guardian2Phone: '0781111111',
      guardian2Relation: 'uncle',
      homeVillageId: 'v1',
      registeredAt: new Date('2024-01-01'),
      archiveReason: 'moved',
      archivedAt: new Date('2026-08-01'),
      createdAt: new Date('2024-01-01'),
      createdById: null,
      updatedAt: new Date('2026-08-01'),
      updatedById: null,
      deletedAt: null,
      version: 3,
      syncStatus: 'synced' as never,
      lastModifiedByDeviceId: null,
      lastModifiedAt: new Date('2026-08-01'),
      center: {
        id: 'center-1',
        name: 'ECD Kigali',
        districtId: 'd1',
      },
      homeVillage: {
        id: 'v1',
        name: 'Village A',
        level: 'village' as never,
      },
    };

    const archived = childMapper.toDetailDto(baseEntity as never);

    eq(archived.gender, 'Umukobwa');
    eq(archived.status, ChildStatus.archived);
    eq(!!archived.archivedAt, true);
    eq(archived.notes, 'follow-up');
    eq(archived.specialNeeds, 'speech');
    eq(archived.version, 3);
    eq(archived.nationalId, 'REG-1');
    eq(archived.firstName, 'Aline');
    eq(archived.middleName, null);
    eq(archived.lastName, null);
    eq(archived.guardianRelation, 'mother');
    eq(archived.guardian2Name, 'Uncle');
    eq(archived.guardian2Phone, '0781111111');
    eq(archived.guardian2Relation, 'uncle');
    eq(archived.archiveReason, 'moved');
    eq(!!archived.registeredAt, true);

    const active = childMapper.toDetailDto({
      ...baseEntity,
      status: ChildStatus.active,
      archivedAt: null,
      archiveReason: null,
      version: 4,
    } as never);

    eq(active.status, ChildStatus.active);
    eq(active.archivedAt, null);
    eq(active.archiveReason, null);
    eq(active.version, 4);
  });

  await assert('create mapping from fullName', () => {
    const data = childMapper.toCreateData({
      fullName: 'Jean Habimana',
      dateOfBirth: '2020-01-01',
      gender: 'Umuhungu',
      centerId: 'center-1',
      nationalId: 'R1',
      homeVillageId: 'v1',
      guardianName: 'P',
      guardianPhone: '07',
    });
    eq(data.firstName, 'Jean');
    eq(data.lastName, 'Habimana');
    eq(data.gender, ChildGender.male);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
