import { AbsentReason, AttendanceStatus } from '@prisma/client';
import { SYNCABLE_ENTITY_TYPES } from '../../sync/sync.constants';
import {
  presentToStatus,
  resolveAbsentReasonFromPayload,
  resolveAttendanceStatusFromPayload,
} from '../mappers/attendance.mapper';

/**
 * Attendance sync create/update/delete payload coverage.
 * Run: npx ts-node src/modules/attendance/__tests__/attendance.sync.spec.ts
 */

type SyncAttendancePayload = {
  childId: string;
  attendanceDate?: string;
  date?: string;
  present?: boolean;
  status?: AttendanceStatus;
  absentReason?: AbsentReason | null;
  deviceId?: string;
  recordedById: string;
  centerId?: string;
};

function buildSyncCreateData(
  payload: SyncAttendancePayload,
  contextDeviceId: string,
  resolvedCenterId: string,
) {
  const status = resolveAttendanceStatusFromPayload(
    payload as unknown as Record<string, unknown>,
  );
  const absentReason = resolveAbsentReasonFromPayload(
    payload as unknown as Record<string, unknown>,
    status,
  );
  const attendanceDate = payload.attendanceDate ?? payload.date;
  if (!attendanceDate) {
    throw new Error('attendanceDate required');
  }

  return {
    childId: payload.childId,
    centerId: payload.centerId ?? resolvedCenterId,
    attendanceDate,
    status,
    absentReason,
    recordedById: payload.recordedById,
    lastModifiedByDeviceId: payload.deviceId ?? contextDeviceId,
  };
}

function buildSyncUpdateData(
  payload: Partial<SyncAttendancePayload>,
  existing: { status: AttendanceStatus; absentReason: AbsentReason | null },
) {
  const next: {
    status: AttendanceStatus;
    absentReason: AbsentReason | null;
  } = {
    status: existing.status,
    absentReason: existing.absentReason,
  };

  if (typeof payload.present === 'boolean' || payload.status != null) {
    next.status = resolveAttendanceStatusFromPayload(
      payload as unknown as Record<string, unknown>,
    );
    next.absentReason = resolveAbsentReasonFromPayload(
      payload as unknown as Record<string, unknown>,
      next.status,
    );
  }

  return next;
}

function buildSyncDeleteData(entityId: string, now: Date) {
  return {
    id: entityId,
    deletedAt: now,
    versionIncrement: 1,
  };
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
      throw new Error(
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  };

  await assert('attendance_record is syncable', () => {
    eq(SYNCABLE_ENTITY_TYPES.includes('attendance_record'), true);
  });

  await assert('sync create: present=true → status=present', () => {
    const data = buildSyncCreateData(
      {
        childId: 'c1',
        attendanceDate: '2026-08-01',
        present: true,
        recordedById: 'u1',
        deviceId: 'dev-1',
      },
      'dev-context',
      'center-a',
    );
    eq(data.status, AttendanceStatus.present);
    eq(data.absentReason, null);
    eq(data.centerId, 'center-a');
    eq(data.lastModifiedByDeviceId, 'dev-1');
  });

  await assert('sync create: present=false → status=absent', () => {
    const data = buildSyncCreateData(
      {
        childId: 'c1',
        attendanceDate: '2026-08-01',
        present: false,
        absentReason: AbsentReason.transport,
        recordedById: 'u1',
      },
      'dev-context',
      'center-a',
    );
    eq(data.status, AttendanceStatus.absent);
    eq(data.absentReason, AbsentReason.transport);
    eq(data.lastModifiedByDeviceId, 'dev-context');
  });

  await assert('sync update maps present boolean', () => {
    const updated = buildSyncUpdateData(
      { present: false, absentReason: AbsentReason.sick },
      { status: AttendanceStatus.present, absentReason: null },
    );
    eq(updated.status, AttendanceStatus.absent);
    eq(updated.absentReason, AbsentReason.sick);
  });

  await assert('sync delete soft-deletes', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const deleted = buildSyncDeleteData('att-1', now);
    eq(deleted.id, 'att-1');
    eq(deleted.deletedAt.toISOString(), now.toISOString());
    eq(deleted.versionIncrement, 1);
  });

  await assert('present helper maps both directions', () => {
    eq(presentToStatus(true), AttendanceStatus.present);
    eq(presentToStatus(false), AttendanceStatus.absent);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
