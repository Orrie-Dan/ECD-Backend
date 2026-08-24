import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceStatus, Prisma, RecordSyncStatus, SyncOperationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditAction, AuditService, toAuditJson, toPrismaAuditAction } from '../../common/audit';
import { assertCenterAccess, canAccessCenter } from '../../common/auth/scope.util';
import { assertCasApplied, classifyCasMiss } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncAccessService } from '../sync/sync-access.service';
import { AttendanceBatchDto, AttendanceBatchRecordDto } from './dto/attendance-batch.dto';
import {
  AttendanceBatchResultDto,
  AttendanceBatchResultItemDto,
  AttendanceResponseDto,
  PaginatedAttendanceResponseDto,
} from './dto/attendance-response.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import {
  AttendanceEntity,
  attendanceMapper,
  toAttendanceDateKey,
} from './mappers/attendance.mapper';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncAccess: SyncAccessService,
    private readonly audit: AuditService,
  ) {}

  async createBatch(user: AuthUser, dto: AttendanceBatchDto): Promise<AttendanceBatchResultDto> {
    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();

    const childIds = [...new Set(dto.records.map((r) => r.childId))];
    const children = await this.prisma.child.findMany({
      where: { id: { in: childIds }, deletedAt: null },
      select: {
        id: true,
        centerId: true,
        center: { select: { id: true, districtId: true } },
      },
    });
    const childMap = new Map(children.map((c) => [c.id, c]));

    const existing = await this.prisma.attendanceRecord.findMany({
      where: {
        OR: dto.records.map((r) => ({
          childId: r.childId,
          attendanceDate: this.toDateOnly(r.date),
        })),
      },
    });
    const existingMap = new Map(
      existing.map((e) => [`${e.childId}|${toAttendanceDateKey(e.attendanceDate)}`, e]),
    );

    type Planned =
      | {
          kind: 'create';
          record: AttendanceBatchRecordDto;
          centerId: string;
          attendanceDate: Date;
          id: string;
        }
      | {
          kind: 'update';
          record: AttendanceBatchRecordDto;
          existing: (typeof existing)[number];
          attendanceDate: Date;
        };

    const items: AttendanceBatchResultItemDto[] = [];
    const planned: Planned[] = [];
    const seenKeys = new Set<string>();

    for (const record of dto.records) {
      const dateKey = toAttendanceDateKey(record.date);
      const child = childMap.get(record.childId);

      if (!child) {
        items.push({
          childId: record.childId,
          date: dateKey,
          localId: record.localId,
          outcome: 'not_found',
          message: 'Child not found',
        });
        continue;
      }

      if (dto.centerId && child.centerId !== dto.centerId) {
        items.push({
          childId: record.childId,
          date: dateKey,
          localId: record.localId,
          outcome: 'forbidden',
          message: 'Child does not belong to the provided center',
        });
        continue;
      }

      if (!canAccessCenter(user, child.centerId, child.center.districtId)) {
        items.push({
          childId: record.childId,
          date: dateKey,
          localId: record.localId,
          outcome: 'forbidden',
          message: 'Child is outside your authorized scope',
        });
        continue;
      }

      if (record.present === false && !record.absentReason) {
        items.push({
          childId: record.childId,
          date: dateKey,
          localId: record.localId,
          outcome: 'failed',
          message: 'absentReason is required when present is false',
        });
        continue;
      }

      const key = `${record.childId}|${dateKey}`;
      if (seenKeys.has(key)) {
        items.push({
          childId: record.childId,
          date: dateKey,
          localId: record.localId,
          outcome: 'failed',
          message: 'Duplicate childId + date in batch',
        });
        continue;
      }
      seenKeys.add(key);

      const prior = existingMap.get(key);
      const attendanceDate = this.toDateOnly(record.date);

      if (prior) {
        if (record.version == null) {
          items.push({
            childId: record.childId,
            date: dateKey,
            localId: record.localId,
            outcome: 'conflict',
            message: 'version is required when updating an existing attendance record',
            currentVersion: prior.version,
          });
          continue;
        }
        planned.push({
          kind: 'update',
          record,
          existing: prior,
          attendanceDate,
        });
      } else {
        planned.push({
          kind: 'create',
          record,
          centerId: child.centerId,
          attendanceDate,
          id: randomUUID(),
        });
      }
    }

    let created = 0;
    let updated = 0;

    if (planned.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const item of planned) {
          const mapped = attendanceMapper.toWriteData(item.record);

          if (item.kind === 'create') {
            const row = await tx.attendanceRecord.create({
              data: {
                id: item.id,
                childId: item.record.childId,
                centerId: item.centerId,
                attendanceDate: item.attendanceDate,
                status: mapped.status,
                absentReason: mapped.absentReason,
                notes: mapped.notes,
                recordedById: user.id,
                updatedById: user.id,
                version: 1,
                syncStatus: RecordSyncStatus.synced,
                lastModifiedByDeviceId: deviceId,
                lastModifiedAt: now,
              },
            });

            await this.writeSyncAndAudit(tx, {
              userId: user.id,
              deviceId,
              entityId: row.id,
              localId: item.record.localId,
              action: AuditAction.CREATE,
              now,
              oldValues: null,
              newValues: row,
            });

            created += 1;
            items.push({
              childId: item.record.childId,
              date: toAttendanceDateKey(item.attendanceDate),
              localId: item.record.localId,
              outcome: 'created',
              attendance: attendanceMapper.toDto(row as AttendanceEntity),
            });
          } else {
            const cas = await tx.attendanceRecord.updateMany({
              where: {
                id: item.existing.id,
                version: item.record.version!,
              },
              data: {
                status: mapped.status,
                absentReason: mapped.absentReason,
                notes: mapped.notes,
                deletedAt: null,
                updatedById: user.id,
                version: { increment: 1 },
                syncStatus: RecordSyncStatus.synced,
                lastModifiedByDeviceId: deviceId,
                lastModifiedAt: now,
              },
            });

            const miss = await classifyCasMiss(cas.count, () =>
              tx.attendanceRecord.findUnique({
                where: { id: item.existing.id },
                select: { version: true },
              }),
            );

            if (miss.kind !== 'applied') {
              items.push({
                childId: item.record.childId,
                date: toAttendanceDateKey(item.attendanceDate),
                localId: item.record.localId,
                outcome: miss.kind === 'not_found' ? 'not_found' : 'conflict',
                message:
                  miss.kind === 'not_found'
                    ? 'Attendance record not found'
                    : 'Record was modified by another device',
                ...(miss.kind === 'version_mismatch' ? { currentVersion: miss.serverVersion } : {}),
              });
              continue;
            }

            const row = await tx.attendanceRecord.findFirstOrThrow({
              where: { id: item.existing.id },
            });

            await this.writeSyncAndAudit(tx, {
              userId: user.id,
              deviceId,
              entityId: row.id,
              localId: item.record.localId,
              action: AuditAction.UPDATE,
              now,
              oldValues: item.existing,
              newValues: row,
            });

            updated += 1;
            items.push({
              childId: item.record.childId,
              date: toAttendanceDateKey(item.attendanceDate),
              localId: item.record.localId,
              outcome: 'updated',
              attendance: attendanceMapper.toDto(row as AttendanceEntity),
            });
          }
        }
      });
    }

    const failed = items.filter((i) => !['created', 'updated'].includes(i.outcome)).length;

    return { created, updated, failed, items };
  }

  async findAll(
    user: AuthUser,
    query: ListAttendanceQueryDto,
  ): Promise<PaginatedAttendanceResponseDto> {
    const scope = await this.syncAccess.resolveScope(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    const skip = (page - 1) * pageSize;

    if (query.centerId) {
      const center = await this.prisma.ecdCenter.findFirst({
        where: { id: query.centerId, deletedAt: null },
        select: { id: true, districtId: true },
      });
      if (!center) {
        throw new NotFoundException('Center not found');
      }
      assertCenterAccess(user, center.id, center.districtId);
    }

    const startDate = query.startDate ?? query.from;
    const endDate = query.endDate ?? query.to;

    const where: Prisma.AttendanceRecordWhereInput = {
      deletedAt: null,
      ...this.syncAccess.centerFilter(scope),
      ...(query.centerId ? { centerId: query.centerId } : {}),
      ...(query.childId ? { childId: query.childId } : {}),
      ...(startDate || endDate
        ? {
            attendanceDate: {
              ...(startDate ? { gte: this.toDateOnly(startDate) } : {}),
              ...(endDate ? { lte: this.toDateOnly(endDate) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({
        where,
        orderBy: [{ attendanceDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);

    return {
      items: rows.map((row) => attendanceMapper.toDto(row as AttendanceEntity)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async softDelete(
    user: AuthUser,
    id: string,
    version: number,
    deviceId?: string,
  ): Promise<AttendanceResponseDto> {
    const existing = await this.prisma.attendanceRecord.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('Attendance record not found');
    }

    assertCenterAccess(user, existing.centerId, existing.center.districtId);

    const resolvedDeviceId = await this.resolveDeviceId(user, deviceId);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.attendanceRecord.updateMany({
        where: {
          id: existing.id,
          version,
          deletedAt: null,
        },
        data: {
          deletedAt: now,
          updatedById: user.id,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: resolvedDeviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'attendance_record', () =>
        tx.attendanceRecord.findUnique({
          where: { id: existing.id },
          select: { version: true },
        }),
      );

      const row = await tx.attendanceRecord.findFirstOrThrow({
        where: { id: existing.id },
      });

      await this.writeSyncAndAudit(tx, {
        userId: user.id,
        deviceId: resolvedDeviceId,
        entityId: row.id,
        localId: null,
        action: AuditAction.DELETE,
        now,
        oldValues: (() => {
          const { center: _center, ...plain } = existing;
          return plain;
        })(),
        newValues: row,
      });

      return row;
    });

    return attendanceMapper.toDto(updated as AttendanceEntity);
  }

  private async writeSyncAndAudit(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      deviceId: string | null;
      entityId: string;
      localId?: string | null;
      action: AuditAction;
      now: Date;
      oldValues?: unknown | null;
      newValues: unknown;
    },
  ): Promise<void> {
    if (params.deviceId) {
      await tx.syncOperation.create({
        data: {
          id: randomUUID(),
          deviceId: params.deviceId,
          entityType: 'attendance_record',
          entityId: params.entityId,
          localId: params.localId ?? null,
          operation: toPrismaAuditAction(params.action),
          payload: toAuditJson(params.newValues),
          status: SyncOperationStatus.applied,
          clientTimestamp: params.now,
          processedAt: params.now,
        },
      });
    }

    await this.audit.log({
      tx,
      entityType: 'attendance_record',
      entityId: params.entityId,
      action: params.action,
      userId: params.userId,
      deviceId: params.deviceId,
      oldValues: params.oldValues ?? null,
      newValues: params.newValues,
      changedAt: params.now,
    });
  }

  private toDateOnly(value: string | Date): Date {
    const raw = typeof value === 'string' ? value : value.toISOString();
    const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date: ${raw}`);
    }
    return date;
  }

  private async resolveDeviceId(user: AuthUser, deviceId?: string): Promise<string | null> {
    if (!deviceId) {
      return null;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device || device.userId !== user.id) {
      throw new ForbiddenException('Device does not belong to the authenticated user');
    }

    if (device.status !== DeviceStatus.active) {
      throw new ForbiddenException('Device is inactive');
    }

    return device.id;
  }
}
