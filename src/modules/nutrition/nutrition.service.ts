import { ChildStatus, DeviceStatus, asDomainEnum } from '../../common/domain';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordSyncStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { assertCenterAccessibleById } from '../../common/scope/district-query.scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncAccessService } from '../sync/sync-access.service';
import { CreateNutritionScreeningDto } from './dto/create-nutrition-screening.dto';
import { GrowthChartResponseDto } from './dto/growth-chart-response.dto';
import { ListNutritionQueryDto } from './dto/list-nutrition-query.dto';
import { ListNutritionScreeningsQueryDto } from './dto/list-nutrition-screenings-query.dto';
import { NutritionAlertDto, NutritionAlertsResponseDto } from './dto/nutrition-alert.dto';
import { NutritionHistoryResponseDto } from './dto/nutrition-history-response.dto';
import {
  NutritionScreeningListItemDto,
  PaginatedNutritionScreeningsResponseDto,
} from './dto/nutrition-screening-list-response.dto';
import { NutritionScreeningResponseDto } from './dto/nutrition-screening-response.dto';
import {
  decimalToNumber,
  deriveRequiresReferral,
  nutritionMapper,
  parseOptionalNutritionStatus,
} from './mappers/nutrition.mapper';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { collectWhoConcerns } from './who/concern';

/** Active children with no screening within this window are overdue. */
const OVERDUE_SCREENING_DAYS = 30;

/**
 * Nutrition screenings are append-only clinical records.
 * REST exposes create + read only — no update/delete endpoints.
 * Soft-delete (if ever needed) should use sync CAS; do not add blind REST updates.
 */
@Injectable()
export class NutritionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncAccess: SyncAccessService,
    private readonly audit: AuditService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  async createScreening(
    user: AuthUser,
    childId: string,
    dto: CreateNutritionScreeningDto,
  ): Promise<NutritionScreeningResponseDto> {
    const child = await this.getAccessibleChild(user, childId);
    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();
    // Manual referral only — no automatic WHO or legacy-MUAC referral rule.
    const requiresReferral = deriveRequiresReferral(dto.requiresReferral);
    // Do not persist new legacy absolute-MUAC status. Older clients may still send it;
    // we ignore it so WHO indicators remain the sole nutrition assessment.
    const nutritionStatus: string | null = null;

    const created = await this.prisma.$transaction(async (tx) => {
      const mealQuality = dto.mealQuality?.trim() ?? null;
      const row = await tx.childNutritionScreening.create({
        data: {
          id: randomUUID(),
          childId: child.id,
          screeningDate: new Date(dto.screeningDate),
          weightKg: new Prisma.Decimal(dto.weightKg),
          muacCm: new Prisma.Decimal(dto.muacCm),
          heightCm: dto.heightCm != null ? new Prisma.Decimal(dto.heightCm) : null,
          headCircumferenceCm:
            dto.headCircumferenceCm != null ? new Prisma.Decimal(dto.headCircumferenceCm) : null,
          nutritionStatus,
          requiresReferral,
          mealQuality,
          feedingConcern: dto.feedingConcern ?? false,
          dietNotes: dto.dietNotes?.trim() ?? null,
          recordedById: user.id,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'child_nutrition_screening',
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

    const concerns = collectWhoConcerns({
      dateOfBirth: child.dateOfBirth,
      gender: child.gender,
      screeningDate: dto.screeningDate,
      weightKg: dto.weightKg,
      heightCm: dto.heightCm,
      muacCm: dto.muacCm,
    });

    void this.notificationEvents.onNutritionScreeningCreated({
      screeningId: created.id,
      whoConcerns: concerns,
      requiresReferral,
      centerId: child.centerId,
      districtId: child.center.districtId,
    });

    return nutritionMapper.toDto(created);
  }

  async getHistory(user: AuthUser, childId: string): Promise<NutritionHistoryResponseDto> {
    await this.getAccessibleChild(user, childId);

    const rows = await this.prisma.childNutritionScreening.findMany({
      where: { childId, deletedAt: null },
      orderBy: [{ screeningDate: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      childId,
      items: rows.map((row) => nutritionMapper.toDto(row)),
      total: rows.length,
    };
  }

  async getGrowthChart(user: AuthUser, childId: string): Promise<GrowthChartResponseDto> {
    await this.getAccessibleChild(user, childId);

    const rows = await this.prisma.childNutritionScreening.findMany({
      where: { childId, deletedAt: null },
      orderBy: [{ screeningDate: 'asc' }, { createdAt: 'asc' }],
    });

    return nutritionMapper.toGrowthChart(childId, rows);
  }

  /**
   * Paginated operational screening list for District (and scoped caregiver/NCDA).
   * Filters via child.centerId — screenings have no denormalized centerId.
   */
  async listScreenings(
    user: AuthUser,
    query: ListNutritionScreeningsQueryDto,
  ): Promise<PaginatedNutritionScreeningsResponseDto> {
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
      await assertCenterAccessibleById(this.prisma, user, center.id);
    }

    const fromDate = query.from ? this.toDateOnly(query.from) : undefined;
    const toDate = query.to ? this.toDateOnly(query.to) : undefined;
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from must be on or before to');
    }

    const childCenterFilter =
      query.centerId != null
        ? { centerId: query.centerId }
        : scope.centerIds === 'all'
          ? {}
          : { centerId: { in: scope.centerIds } };

    const where: Prisma.ChildNutritionScreeningWhereInput = {
      deletedAt: null,
      ...(query.childId ? { childId: query.childId } : {}),
      ...(query.nutritionStatus ? { nutritionStatus: query.nutritionStatus } : {}),
      ...(fromDate || toDate
        ? {
            screeningDate: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      child: {
        deletedAt: null,
        ...childCenterFilter,
      },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.childNutritionScreening.findMany({
        where,
        include: {
          child: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              dateOfBirth: true,
              gender: true,
              centerId: true,
              center: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ screeningDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.childNutritionScreening.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toListItemDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async getAlerts(
    user: AuthUser,
    query: ListNutritionQueryDto,
  ): Promise<NutritionAlertsResponseDto> {
    const scope = await this.syncAccess.resolveScope(user);

    if (query.districtId) {
      if (scope.districtId && scope.districtId !== query.districtId && scope.centerIds !== 'all') {
        throw new ForbiddenException(`You do not have access to district ${query.districtId}`);
      }
    }

    if (query.centerId) {
      const center = await this.prisma.ecdCenter.findFirst({
        where: { id: query.centerId, deletedAt: null },
        select: { id: true, districtId: true },
      });
      if (!center) {
        throw new NotFoundException('Center not found');
      }
      await assertCenterAccessibleById(this.prisma, user, center.id);
    }

    const centerFilter =
      query.centerId != null
        ? { centerId: query.centerId }
        : scope.centerIds === 'all'
          ? query.districtId
            ? { center: { districtId: query.districtId } }
            : {}
          : {
              centerId: { in: scope.centerIds },
              ...(query.districtId ? { center: { districtId: query.districtId } } : {}),
            };

    const asOfDate = query.date ? new Date(query.date) : new Date();
    const overdueBefore = new Date(asOfDate);
    overdueBefore.setUTCDate(overdueBefore.getUTCDate() - OVERDUE_SCREENING_DAYS);

    const alerts: NutritionAlertDto[] = [];

    const includeReferral = !query.status || query.status === 'requires_referral';
    const includeWhoConcern =
      !query.status ||
      query.status === 'who_growth_concern' ||
      query.status === 'severe_nutrition';
    const includeOverdue = !query.status || query.status === 'overdue_screening';

    if (includeReferral || includeWhoConcern) {
      const screeningWhere: Prisma.ChildNutritionScreeningWhereInput = {
        deletedAt: null,
        child: {
          deletedAt: null,
          status: { not: ChildStatus.archived },
          ...centerFilter,
        },
        ...(query.date ? { screeningDate: { lte: asOfDate } } : {}),
        ...(query.nutritionStatus ? { nutritionStatus: query.nutritionStatus } : {}),
        ...(includeReferral && !includeWhoConcern ? { requiresReferral: true } : {}),
      };

      const flagged = await this.prisma.childNutritionScreening.findMany({
        where: screeningWhere,
        include: {
          child: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              dateOfBirth: true,
              gender: true,
              centerId: true,
              center: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ screeningDate: 'desc' }, { createdAt: 'desc' }],
        // Bound national NCDA scans — alerts are signals, not a full dump.
        take: 2000,
      });

      const seenReferral = new Set<string>();
      const seenWhoConcern = new Set<string>();

      for (const row of flagged) {
        const fullName = [row.child.firstName, row.child.middleName, row.child.lastName]
          .filter((p): p is string => !!p?.trim())
          .join(' ');

        const weightKg = decimalToNumber(row.weightKg);
        const muacCm = decimalToNumber(row.muacCm);
        const heightCm = decimalToNumber(row.heightCm);
        const concerns =
          weightKg != null && muacCm != null
            ? collectWhoConcerns({
                dateOfBirth: row.child.dateOfBirth,
                gender: row.child.gender,
                screeningDate: row.screeningDate,
                weightKg,
                heightCm,
                muacCm,
              })
            : [];

        if (includeWhoConcern && concerns.length > 0 && !seenWhoConcern.has(row.childId)) {
          seenWhoConcern.add(row.childId);
          const primary = concerns[0];
          alerts.push({
            type: 'who_growth_concern',
            childId: row.childId,
            childFullName: fullName,
            centerId: row.child.centerId,
            centerName: row.child.center.name,
            screeningId: row.id,
            screeningDate: row.screeningDate,
            nutritionStatus: parseOptionalNutritionStatus(row.nutritionStatus),
            whoIndicator: primary.indicator,
            whoZone: primary.zone,
            requiresReferral: row.requiresReferral,
            message: `WHO growth concern: ${primary.label}`,
          });
        }

        if (includeReferral && row.requiresReferral && !seenReferral.has(row.childId)) {
          seenReferral.add(row.childId);
          alerts.push({
            type: 'requires_referral',
            childId: row.childId,
            childFullName: fullName,
            centerId: row.child.centerId,
            centerName: row.child.center.name,
            screeningId: row.id,
            screeningDate: row.screeningDate,
            nutritionStatus: parseOptionalNutritionStatus(row.nutritionStatus),
            whoIndicator: null,
            whoZone: null,
            requiresReferral: true,
            message: 'Child requires nutrition referral',
          });
        }
      }
    }

    if (includeOverdue) {
      const children = await this.prisma.child.findMany({
        where: {
          deletedAt: null,
          status: ChildStatus.active,
          ...centerFilter,
        },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          centerId: true,
          center: { select: { id: true, name: true } },
          nutritionScreenings: {
            where: { deletedAt: null },
            orderBy: { screeningDate: 'desc' },
            take: 1,
            select: {
              id: true,
              screeningDate: true,
              nutritionStatus: true,
              requiresReferral: true,
            },
          },
        },
        // Bound national NCDA scans — overdue alerts are a signal sample.
        take: 2000,
      });

      for (const child of children) {
        const latest = child.nutritionScreenings[0];
        const isOverdue = !latest || latest.screeningDate.getTime() < overdueBefore.getTime();

        if (!isOverdue) {
          continue;
        }

        const fullName = [child.firstName, child.middleName, child.lastName]
          .filter((p): p is string => !!p?.trim())
          .join(' ');

        alerts.push({
          type: 'overdue_screening',
          childId: child.id,
          childFullName: fullName,
          centerId: child.centerId,
          centerName: child.center.name,
          screeningId: latest?.id ?? null,
          screeningDate: latest?.screeningDate ?? null,
          nutritionStatus: parseOptionalNutritionStatus(latest?.nutritionStatus),
          whoIndicator: null,
          whoZone: null,
          requiresReferral: latest?.requiresReferral ?? null,
          message: latest
            ? `No nutrition screening within the last ${OVERDUE_SCREENING_DAYS} days`
            : 'Child has never been screened for nutrition',
        });
      }
    }

    return {
      items: alerts,
      total: alerts.length,
    };
  }

  private async getAccessibleChild(user: AuthUser, childId: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        centerId: true,
        status: true,
        dateOfBirth: true,
        gender: true,
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    await assertCenterAccessibleById(this.prisma, user, child.centerId);
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

  private toDateOnly(raw: string): Date {
    return new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  }

  private toListItemDto(row: {
    id: string;
    childId: string;
    screeningDate: Date;
    weightKg: Prisma.Decimal | number;
    muacCm: Prisma.Decimal | number;
    heightCm: Prisma.Decimal | number | null;
    headCircumferenceCm: Prisma.Decimal | number | null;
    nutritionStatus: string | null;
    requiresReferral: boolean;
    recordedById: string;
    version: number;
    createdAt: Date;
    child: {
      firstName: string;
      middleName: string | null;
      lastName: string | null;
      dateOfBirth: Date;
      gender: string;
      centerId: string;
      center: { id: string; name: string };
    };
  }): NutritionScreeningListItemDto {
    const weightKg = decimalToNumber(row.weightKg);
    const muacCm = decimalToNumber(row.muacCm);
    if (weightKg == null || muacCm == null) {
      throw new Error('Nutrition screening is missing required measurements');
    }

    const childFullName = [row.child.firstName, row.child.middleName, row.child.lastName]
      .filter((p): p is string => !!p?.trim())
      .join(' ');

    return {
      id: row.id,
      childId: row.childId,
      childFullName,
      childDateOfBirth: row.child.dateOfBirth,
      childGender: asDomainEnum(row.child.gender) as NutritionScreeningListItemDto['childGender'],
      centerId: row.child.centerId,
      centerName: row.child.center.name,
      screeningDate: row.screeningDate,
      weightKg,
      muacCm,
      heightCm: decimalToNumber(row.heightCm),
      headCircumferenceCm: decimalToNumber(row.headCircumferenceCm),
      nutritionStatus: parseOptionalNutritionStatus(row.nutritionStatus),
      requiresReferral: row.requiresReferral,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
    };
  }
}
