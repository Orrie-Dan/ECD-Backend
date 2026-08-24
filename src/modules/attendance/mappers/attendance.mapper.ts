import { AbsentReason, AttendanceRecord, AttendanceStatus } from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { AttendanceBatchRecordDto } from '../dto/attendance-batch.dto';
import { AttendanceResponseDto } from '../dto/attendance-response.dto';

export type AttendanceEntity = Pick<
  AttendanceRecord,
  | 'id'
  | 'childId'
  | 'centerId'
  | 'attendanceDate'
  | 'status'
  | 'absentReason'
  | 'notes'
  | 'recordedById'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
>;

export type AttendanceWriteMapped = {
  status: AttendanceStatus;
  absentReason: AbsentReason | null;
  notes: string | null;
};

/**
 * Maps API `present` boolean ↔ Prisma `AttendanceStatus`.
 */
export function presentToStatus(present: boolean): AttendanceStatus {
  return present ? AttendanceStatus.present : AttendanceStatus.absent;
}

export function statusToPresent(status: AttendanceStatus): boolean {
  return status === AttendanceStatus.present;
}

/**
 * Sync payload helper: accept `present` (preferred) or legacy `status`.
 */
export function resolveAttendanceStatusFromPayload(
  payload: Record<string, unknown>,
): AttendanceStatus {
  if (typeof payload.present === 'boolean') {
    return presentToStatus(payload.present);
  }
  if (payload.status === AttendanceStatus.present || payload.status === AttendanceStatus.absent) {
    return payload.status;
  }
  throw new Error('Attendance payload requires present (boolean) or status');
}

export function resolveAbsentReasonFromPayload(
  payload: Record<string, unknown>,
  status: AttendanceStatus,
): AbsentReason | null {
  if (status === AttendanceStatus.present) {
    return null;
  }
  if (payload.absentReason == null || payload.absentReason === '') {
    throw new Error('absentReason is required when present is false');
  }
  return payload.absentReason as AbsentReason;
}

export function toAttendanceDateKey(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

export class AttendanceMapper implements Mapper<AttendanceEntity, AttendanceResponseDto> {
  toDto(entity: AttendanceEntity): AttendanceResponseDto {
    return {
      id: entity.id,
      childId: entity.childId,
      centerId: entity.centerId,
      date: toAttendanceDateKey(entity.attendanceDate),
      present: statusToPresent(entity.status),
      absentReason: entity.absentReason,
      notes: entity.notes,
      recordedBy: entity.recordedById,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  toWriteData(dto: AttendanceBatchRecordDto): AttendanceWriteMapped {
    const status = presentToStatus(dto.present);
    return {
      status,
      absentReason: status === AttendanceStatus.present ? null : (dto.absentReason ?? null),
      notes: dto.notes?.trim() || null,
    };
  }
}

export const attendanceMapper = new AttendanceMapper();
