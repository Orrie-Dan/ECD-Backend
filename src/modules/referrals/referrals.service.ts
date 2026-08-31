import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceStatus,
  Prisma,
  RecordSyncStatus,
  ReferralSourceType,
  ReferralStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { LookupDualWrite, LookupResolverService } from '../../common/lookups';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncAccessService } from '../sync/sync-access.service';
import { CreateReferralDto } from './dto/create-referral.dto';
import { ListReferralsQueryDto } from './dto/list-referrals-query.dto';
import {
  PaginatedReferralsResponseDto,
  ReferralHistoryResponseDto,
  ReferralResponseDto,
} from './dto/referral-response.dto';
import { UpdateReferralStatusDto } from './dto/update-referral-status.dto';
import {
  canTransitionReferralStatus,
  referralMapper,
  toDbReferralSourceType,
  toDbReferralStatus,
} from './mappers/referral.mapper';
import { NotificationsService } from '../notifications/notifications.service';

export type CreateReferralFromSignalInput = {
  childId: string;
  centerId: string;
  sourceId: string;
  referralDate: string;
  reason: string;
  destination: string;
  notes?: string | null;
  recordedById: string;
  deviceId?: string | null;
};

@Injectable()
export class ReferralsService {
  private readonly lookupDw: LookupDualWrite;

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncAccess: SyncAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly lookupResolver: LookupResolverService,
  ) {
    this.lookupDw = new LookupDualWrite(this.lookupResolver);
  }

  async create(user: AuthUser, dto: CreateReferralDto): Promise<ReferralResponseDto> {
    const child = await this.getAccessibleChild(user, dto.childId);

    if (child.centerId !== dto.centerId) {
      throw new BadRequestException('centerId does not match the child current center');
    }

    assertCenterAccess(user, dto.centerId, child.center.districtId);
    await this.assertValidSource(dto.sourceType, dto.sourceId, dto.childId);

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const mapped = referralMapper.toCreateData(dto);
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.referral.create({
        data: {
          id: randomUUID(),
          childId: child.id,
          centerId: dto.centerId,
          ...this.lookupDw.referralSourceType(mapped.sourceType),
          sourceId: dto.sourceId,
          referralDate: mapped.referralDate,
          reason: mapped.reason,
          destination: mapped.destination,
          ...this.lookupDw.referralStatus(ReferralStatus.pending),
          notes: mapped.notes,
          recordedById: user.id,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'referral',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: user.id,
        deviceId,
        oldValues: null,
        newValues: toAuditJson(row),
        changedAt: now,
      });

      return row;
    });

    this.notifications
      .findUserIdsByRoleAndCenter(dto.centerId, [UserRole.ecd_director])
      .then((ids) => {
        this.notifications.notifyAsync(ids, {
          type: 'referral_created',
          title: 'New referral created',
          message: `A new ${dto.sourceType} referral has been created.`,
          entityType: 'referral',
          entityId: created.id,
        });
      })
      .catch(() => {});

    return referralMapper.toDto(created);
  }

  async getChildHistory(user: AuthUser, childId: string): Promise<ReferralHistoryResponseDto> {
    await this.getAccessibleChild(user, childId);

    const rows = await this.prisma.referral.findMany({
      where: { childId, deletedAt: null },
      orderBy: [{ referralDate: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      childId,
      items: rows.map((row) => referralMapper.toDto(row)),
      total: rows.length,
    };
  }

  async findAll(
    user: AuthUser,
    query: ListReferralsQueryDto,
  ): Promise<PaginatedReferralsResponseDto> {
    const scope = await this.syncAccess.resolveScope(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
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

    const fromDate = query.from ? this.toDateOnly(query.from) : undefined;
    const toDate = query.to ? this.toDateOnly(query.to) : undefined;
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from must be on or before to');
    }

    const where: Prisma.ReferralWhereInput = {
      deletedAt: null,
      ...this.syncAccess.centerFilter(scope),
      ...(query.centerId ? { centerId: query.centerId } : {}),
      ...(query.childId ? { childId: query.childId } : {}),
      ...(query.status ? { status: toDbReferralStatus(query.status) } : {}),
      ...(query.sourceType ? { sourceType: toDbReferralSourceType(query.sourceType) } : {}),
      ...(fromDate || toDate
        ? {
            referralDate: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.referral.findMany({
        where,
        orderBy: [{ referralDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.referral.count({ where }),
    ]);

    return {
      items: rows.map((row) => referralMapper.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async updateStatus(
    user: AuthUser,
    id: string,
    dto: UpdateReferralStatusDto,
  ): Promise<ReferralResponseDto> {
    const referral = await this.prisma.referral.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!referral) {
      throw new NotFoundException('Referral not found');
    }

    assertCenterAccess(user, referral.centerId, referral.center.districtId);

    const nextStatus = toDbReferralStatus(dto.status);
    if (!canTransitionReferralStatus(referral.status, nextStatus)) {
      throw new BadRequestException(
        `Cannot transition referral from ${referral.status} to ${dto.status}`,
      );
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();
    const implementedAt =
      dto.implementedAt != null
        ? new Date(`${dto.implementedAt.slice(0, 10)}T00:00:00.000Z`)
        : nextStatus === ReferralStatus.completed
          ? now
          : referral.implementedAt;

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.referral.updateMany({
        where: {
          id: referral.id,
          version: dto.version,
          status: ReferralStatus.pending,
          deletedAt: null,
        },
        data: {
          ...this.lookupDw.referralStatus(nextStatus),
          implementedAt,
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
          updatedAt: now,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'referral', () =>
        tx.referral.findUnique({
          where: { id: referral.id },
          select: { version: true },
        }),
      );

      const row = await tx.referral.findFirstOrThrow({
        where: { id: referral.id },
      });

      await this.audit.log({
        tx,
        entityType: 'referral',
        entityId: row.id,
        action: AuditAction.STATUS_CHANGE,
        userId: user.id,
        deviceId,
        oldValues: toAuditJson({
          status: referral.status,
          implementedAt: referral.implementedAt,
          notes: referral.notes,
          version: referral.version,
        }),
        newValues: toAuditJson({
          status: row.status,
          implementedAt: row.implementedAt,
          notes: row.notes,
          version: row.version,
        }),
        changedAt: now,
      });

      return row;
    });

    this.notifications
      .findUserIdsByRoleAndCenter(referral.centerId, [UserRole.ecd_director, UserRole.caregiver])
      .then((ids) => {
        this.notifications.notifyAsync(ids, {
          type: 'referral_updated',
          title: 'Referral status updated',
          message: `A referral has been updated to ${dto.status}.`,
          entityType: 'referral',
          entityId: referral.id,
        });
      })
      .catch(() => {});

    return referralMapper.toDto(updated);
  }

  /**
   * Future automation from nutrition screening signals.
   * Intentionally unused until auto-referral is approved.
   */
  async createReferralFromNutritionSignal(
    input: CreateReferralFromSignalInput,
  ): Promise<ReferralResponseDto> {
    return this.createFromSignal(ReferralSourceType.nutrition, input);
  }

  /**
   * Future automation from STED assessment signals.
   * Intentionally unused until auto-referral is approved.
   */
  async createReferralFromStedSignal(
    input: CreateReferralFromSignalInput,
  ): Promise<ReferralResponseDto> {
    return this.createFromSignal(ReferralSourceType.sted, input);
  }

  private async createFromSignal(
    sourceType: ReferralSourceType,
    input: CreateReferralFromSignalInput,
  ): Promise<ReferralResponseDto> {
    const apiSource = sourceType === ReferralSourceType.nutrition ? 'nutrition' : 'sted';
    await this.assertValidSource(apiSource, input.sourceId, input.childId);

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.referral.create({
        data: {
          id: randomUUID(),
          childId: input.childId,
          centerId: input.centerId,
          ...this.lookupDw.referralSourceType(sourceType),
          sourceId: input.sourceId,
          referralDate: new Date(`${input.referralDate.slice(0, 10)}T00:00:00.000Z`),
          reason: input.reason.trim(),
          destination: input.destination.trim(),
          ...this.lookupDw.referralStatus(ReferralStatus.pending),
          notes: input.notes?.trim() || null,
          recordedById: input.recordedById,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: input.deviceId ?? null,
          lastModifiedAt: now,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'referral',
        entityId: row.id,
        action: AuditAction.CREATE,
        userId: input.recordedById,
        deviceId: input.deviceId ?? null,
        actorType: 'user',
        oldValues: null,
        newValues: toAuditJson(row),
        changedAt: now,
      });

      return row;
    });

    return referralMapper.toDto(created);
  }

  private async assertValidSource(
    sourceType: 'nutrition' | 'sted',
    sourceId: string,
    childId: string,
  ): Promise<void> {
    if (sourceType === 'nutrition') {
      const screening = await this.prisma.childNutritionScreening.findFirst({
        where: { id: sourceId, deletedAt: null },
        select: { id: true, childId: true },
      });
      if (!screening) {
        throw new BadRequestException(
          'sourceId must reference an existing ChildNutritionScreening',
        );
      }
      if (screening.childId !== childId) {
        throw new BadRequestException('nutrition sourceId does not belong to the specified child');
      }
      return;
    }

    const assessment = await this.prisma.stedAssessment.findFirst({
      where: { id: sourceId, deletedAt: null },
      select: { id: true, childId: true },
    });
    if (!assessment) {
      throw new BadRequestException('sourceId must reference an existing StedAssessment');
    }
    if (assessment.childId !== childId) {
      throw new BadRequestException('sted sourceId does not belong to the specified child');
    }
  }

  private async getAccessibleChild(user: AuthUser, childId: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        centerId: true,
        status: true,
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    assertCenterAccess(user, child.centerId, child.center.districtId);
    return child;
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

  /** Normalize YYYY-MM-DD (or datetime) to UTC date-only midnight for @db.Date filters. */
  private toDateOnly(raw: string): Date {
    return new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  }
}
