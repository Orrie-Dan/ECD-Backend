import { DeviceStatus } from '../../common/domain';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordSyncStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { OptimisticLockConflictException } from '../../common/concurrency/optimistic-lock.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { FeedingDayResponseDto, FeedingMonthSummaryResponseDto } from './dto/feeding-response.dto';
import { UpsertFeedingDayDto } from './dto/upsert-feeding-day.dto';
import { UpsertFeedingMonthSummaryDto } from './dto/upsert-feeding-month-summary.dto';
import { balancedMealWarnings, feedingMapper } from './mappers/feeding.mapper';

@Injectable()
export class FeedingService {
  private readonly logger = new Logger(FeedingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async upsertDaily(user: AuthUser, dto: UpsertFeedingDayDto): Promise<FeedingDayResponseDto> {
    await this.assertAccessibleCenter(user, dto.centerId);
    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const warnings = balancedMealWarnings(dto);

    if (warnings.length > 0) {
      this.logger.warn(
        `Feeding day balanced-meal warning center=${dto.centerId} date=${dto.recordedDate}: ${warnings.join('; ')}`,
      );
    }

    const now = new Date();
    const recordedDate = this.toDateOnly(dto.recordedDate);
    const writeData = feedingMapper.toDayWriteData(dto);

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.centerFeedingDay.findFirst({
        where: {
          centerId: dto.centerId,
          recordedDate,
          deletedAt: null,
        },
      });

      if (!existing) {
        try {
          const created = await tx.centerFeedingDay.create({
            data: {
              id: randomUUID(),
              centerId: dto.centerId,
              recordedDate,
              ...writeData,
              recordedById: user.id,
              version: 1,
              syncStatus: RecordSyncStatus.synced,
              lastModifiedByDeviceId: deviceId,
              lastModifiedAt: now,
            },
          });

          await this.audit.log({
            tx,
            entityType: 'center_feeding_day',
            entityId: created.id,
            action: AuditAction.CREATE,
            userId: user.id,
            deviceId,
            oldValues: null,
            newValues: toAuditJson(created),
            changedAt: now,
          });

          return created;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const raced = await tx.centerFeedingDay.findFirst({
              where: { centerId: dto.centerId, recordedDate },
              select: { version: true },
            });
            throw new OptimisticLockConflictException('center_feeding_day', raced?.version);
          }
          throw error;
        }
      }

      if (dto.version == null) {
        throw new BadRequestException('version is required when updating an existing feeding day');
      }

      const cas = await tx.centerFeedingDay.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data: {
          ...writeData,
          recordedById: user.id,
          updatedAt: now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'center_feeding_day', () =>
        tx.centerFeedingDay.findUnique({
          where: { id: existing.id },
          select: { version: true },
        }),
      );

      const updated = await tx.centerFeedingDay.findFirstOrThrow({
        where: { id: existing.id },
      });

      await this.audit.log({
        tx,
        entityType: 'center_feeding_day',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        deviceId,
        oldValues: toAuditJson(existing),
        newValues: toAuditJson(updated),
        changedAt: now,
      });

      return updated;
    });

    return feedingMapper.toDto(row, warnings);
  }

  async listDaily(
    user: AuthUser,
    centerId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: FeedingDayResponseDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    await this.assertAccessibleCenter(user, centerId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = { centerId, deletedAt: null };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.centerFeedingDay.findMany({
        where,
        orderBy: { recordedDate: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.centerFeedingDay.count({ where }),
    ]);

    return {
      items: rows.map((row) => feedingMapper.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async upsertMonthSummary(
    user: AuthUser,
    dto: UpsertFeedingMonthSummaryDto,
  ): Promise<FeedingMonthSummaryResponseDto> {
    await this.assertAccessibleCenter(user, dto.centerId);
    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();
    const writeData = feedingMapper.toMonthWriteData(dto);

    const row = await this.prisma.$transaction(async (tx) => {
      const monthData = { ...writeData };
      const existing = await tx.centerFeedingMonthSummary.findFirst({
        where: {
          centerId: dto.centerId,
          yearMonth: dto.yearMonth,
          deletedAt: null,
        },
      });

      if (!existing) {
        try {
          const created = await tx.centerFeedingMonthSummary.create({
            data: {
              id: randomUUID(),
              centerId: dto.centerId,
              yearMonth: dto.yearMonth,
              ...monthData,
              updatedById: user.id,
              version: 1,
              syncStatus: RecordSyncStatus.synced,
              lastModifiedByDeviceId: deviceId,
              lastModifiedAt: now,
            },
          });

          await this.audit.log({
            tx,
            entityType: 'center_feeding_month_summary',
            entityId: created.id,
            action: AuditAction.CREATE,
            userId: user.id,
            deviceId,
            oldValues: null,
            newValues: toAuditJson(created),
            changedAt: now,
          });

          return created;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const raced = await tx.centerFeedingMonthSummary.findFirst({
              where: { centerId: dto.centerId, yearMonth: dto.yearMonth },
              select: { version: true },
            });
            throw new OptimisticLockConflictException(
              'center_feeding_month_summary',
              raced?.version,
            );
          }
          throw error;
        }
      }

      if (dto.version == null) {
        throw new BadRequestException(
          'version is required when updating an existing feeding month summary',
        );
      }

      const cas = await tx.centerFeedingMonthSummary.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data: {
          ...monthData,
          updatedById: user.id,
          updatedAt: now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'center_feeding_month_summary', () =>
        tx.centerFeedingMonthSummary.findUnique({
          where: { id: existing.id },
          select: { version: true },
        }),
      );

      const updated = await tx.centerFeedingMonthSummary.findFirstOrThrow({
        where: { id: existing.id },
      });

      await this.audit.log({
        tx,
        entityType: 'center_feeding_month_summary',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        deviceId,
        oldValues: toAuditJson(existing),
        newValues: toAuditJson(updated),
        changedAt: now,
      });

      return updated;
    });

    return feedingMapper.toMonthDto(row);
  }

  async listMonthSummaries(
    user: AuthUser,
    centerId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: FeedingMonthSummaryResponseDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    await this.assertAccessibleCenter(user, centerId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const skip = (page - 1) * pageSize;
    const where = { centerId, deletedAt: null };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.centerFeedingMonthSummary.findMany({
        where,
        orderBy: { yearMonth: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.centerFeedingMonthSummary.count({ where }),
    ]);

    return {
      items: rows.map((row) => feedingMapper.toMonthDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  private async assertAccessibleCenter(user: AuthUser, centerId: string): Promise<void> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: centerId, deletedAt: null },
      select: { id: true, districtId: true },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    assertCenterAccess(user, center.id, center.districtId);
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

  private toDateOnly(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
