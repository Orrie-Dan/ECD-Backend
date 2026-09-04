import { AbsentReason, AttendanceStatus } from '../../../common/domain';
import {
  attendanceMapper,
  presentToStatus,
  resolveAbsentReasonFromPayload,
  resolveAttendanceStatusFromPayload,
  statusToPresent,
} from '../mappers/attendance.mapper';

/**
 * Attendance mapper contract tests.
 * Run: npx ts-node src/modules/attendance/__tests__/attendance.mapper.spec.ts
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
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  await assert('status.present → present=true', () => {
    eq(statusToPresent(AttendanceStatus.present), true);
    eq(presentToStatus(true), AttendanceStatus.present);
  });

  await assert('status.absent → present=false', () => {
    eq(statusToPresent(AttendanceStatus.absent), false);
    eq(presentToStatus(false), AttendanceStatus.absent);
  });

  await assert('mapper returns API fields, not DB shape', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    const dto = attendanceMapper.toDto({
      id: 'att-1',
      childId: 'child-1',
      centerId: 'center-1',
      attendanceDate: new Date('2026-08-01T00:00:00.000Z'),
      status: AttendanceStatus.absent,
      absentReason: AbsentReason.weather,
      notes: 'rain',
      recordedById: 'user-1',
      version: 2,
      createdAt: now,
      updatedAt: now,
    });

    eq(dto.date, '2026-08-01');
    eq(dto.present, false);
    eq(dto.absentReason, AbsentReason.weather);
    eq(dto.recordedBy, 'user-1');
    eq('attendanceDate' in dto, false);
    eq('status' in dto, false);
    eq('recordedById' in dto, false);
  });

  await assert('present=true clears absentReason in write mapping', () => {
    const mapped = attendanceMapper.toWriteData({
      childId: 'c1',
      date: '2026-08-01',
      present: true,
      absentReason: AbsentReason.sick,
    });
    eq(mapped.status, AttendanceStatus.present);
    eq(mapped.absentReason, null);
  });

  await assert('weather accepted as absent reason', () => {
    const mapped = attendanceMapper.toWriteData({
      childId: 'c1',
      date: '2026-08-01',
      present: false,
      absentReason: AbsentReason.weather,
    });
    eq(mapped.absentReason, AbsentReason.weather);
  });

  await assert('sync payload present maps to status', () => {
    eq(resolveAttendanceStatusFromPayload({ present: true }), AttendanceStatus.present);
    eq(resolveAttendanceStatusFromPayload({ present: false }), AttendanceStatus.absent);
    eq(
      resolveAbsentReasonFromPayload(
        { present: false, absentReason: AbsentReason.family },
        AttendanceStatus.absent,
      ),
      AbsentReason.family,
    );
    eq(resolveAbsentReasonFromPayload({ present: true }, AttendanceStatus.present), null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
