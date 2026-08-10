import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChildStatus,
  DeviceStatus,
  NutritionStatus,
  Prisma,
  RecordSyncStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  AuditAction,
  AuditService,
  toAuditJson,
} from '../../common/audit';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { SyncAccessService } from '../sync/sync-access.service';
import { CreateNutritionScreeningDto } from './dto/create-nutrition-screening.dto';
import { GrowthChartResponseDto } from './dto/growth-chart-response.dto';
import { ListNutritionQueryDto } from './dto/list-nutrition-query.dto';
import {
  NutritionAlertDto,
  NutritionAlertsResponseDto,
} from './dto/nutrition-alert.dto';
import { NutritionHistoryResponseDto } from './dto/nutrition-history-response.dto';
import { NutritionScreeningResponseDto } from './dto/nutrition-screening-response.dto';
import {
  deriveRequiresReferral,
  nutritionMapper,
} from './mappers/nutrition.mapper';

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
  ) {}

  async createScreening(
    user: AuthUser,
    childId: string,
    dto: CreateNutritionScreeningDto,
  ): Promise<NutritionScreeningResponseDto> {
    const child = await this.getAccessibleChild(user, childId);
    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();
    const requiresReferral = deriveRequiresReferral(
      dto.nutritionStatus,
      dto.requiresReferral,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.childNutritionScreening.create({
        data: {
          id: randomUUID(),
          childId: child.id,
          screeningDate: new Date(dto.screeningDate),
          weightKg: new Prisma.Decimal(dto.weightKg),
          muacCm: new Prisma.Decimal(dto.muacCm),
          heightCm:
            dto.heightCm != null ? new Prisma.Decimal(dto.heightCm) : null,
          headCircumferenceCm:
            dto.headCircumferenceCm != null
              ? new Prisma.Decimal(dto.headCircumferenceCm)
              : null,
          nutritionStatus: dto.nutritionStatus,
          requiresReferral,
          mealQuality: dto.mealQuality?.trim() ?? null,
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

    return nutritionMapper.toDto(created);
  }

  async getHistory(
    user: AuthUser,
    childId: string,
  ): Promise<NutritionHistoryResponseDto> {
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

  async getGrowthChart(
    user: AuthUser,
    childId: string,
  ): Promise<GrowthChartResponseDto> {
    await this.getAccessibleChild(user, childId);

    const rows = await this.prisma.childNutritionScreening.findMany({
      where: { childId, deletedAt: null },
      orderBy: [{ screeningDate: 'asc' }, { createdAt: 'asc' }],
    });

    return nutritionMapper.toGrowthChart(childId, rows);
  }

  async getAlerts(
    user: AuthUser,
    query: ListNutritionQueryDto,
  ): Promise<NutritionAlertsResponseDto> {
    const scope = await this.syncAccess.resolveScope(user);

    if (query.districtId) {
      if (
        scope.districtId &&
        scope.districtId !== query.districtId &&
        scope.centerIds !== 'all'
      ) {
        throw new ForbiddenException(
          `You do not have access to district ${query.districtId}`,
        );
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
      assertCenterAccess(user, center.id, center.districtId);
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
              ...(query.districtId
                ? { center: { districtId: query.districtId } }
                : {}),
            };

    const asOfDate = query.date ? new Date(query.date) : new Date();
    const overdueBefore = new Date(asOfDate);
    overdueBefore.setUTCDate(
      overdueBefore.getUTCDate() - OVERDUE_SCREENING_DAYS,
    );

    const alerts: NutritionAlertDto[] = [];

    const includeReferral =
      !query.status || query.status === 'requires_referral';
    const includeSevere =
      !query.status || query.status === 'severe_nutrition';
    const includeOverdue =
      !query.status || query.status === 'overdue_screening';

    if (includeReferral || includeSevere) {
      const screeningWhere: Prisma.ChildNutritionScreeningWhereInput = {
        deletedAt: null,
        child: {
          deletedAt: null,
          status: { not: ChildStatus.archived },
          ...centerFilter,
        },
        ...(query.date
          ? { screeningDate: { lte: asOfDate } }
          : {}),
        ...(query.nutritionStatus
          ? { nutritionStatus: query.nutritionStatus }
          : {}),
        OR: [
          ...(includeReferral ? [{ requiresReferral: true }] : []),
          ...(includeSevere
            ? [{ nutritionStatus: NutritionStatus.severe }]
            : []),
        ],
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
              centerId: true,
              center: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ screeningDate: 'desc' }, { createdAt: 'desc' }],
      });

      const seenReferral = new Set<string>();
      const seenSevere = new Set<string>();

      for (const row of flagged) {
        const fullName = [row.child.firstName, row.child.middleName, row.child.lastName]
          .filter((p): p is string => !!p?.trim())
          .join(' ');

        if (
          includeSevere &&
          row.nutritionStatus === NutritionStatus.severe &&
          !seenSevere.has(row.childId)
        ) {
          seenSevere.add(row.childId);
          alerts.push({
            type: 'severe_nutrition',
            childId: row.childId,
            childFullName: fullName,
            centerId: row.child.centerId,
            centerName: row.child.center.name,
            screeningId: row.id,
            screeningDate: row.screeningDate,
            nutritionStatus: row.nutritionStatus,
            requiresReferral: row.requiresReferral,
            message: 'Child has a severe nutrition screening',
          });
        }

        if (
          includeReferral &&
          row.requiresReferral &&
          !seenReferral.has(row.childId)
        ) {
          seenReferral.add(row.childId);
          alerts.push({
            type: 'requires_referral',
            childId: row.childId,
            childFullName: fullName,
            centerId: row.child.centerId,
            centerName: row.child.center.name,
            screeningId: row.id,
            screeningDate: row.screeningDate,
            nutritionStatus: row.nutritionStatus,
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
      });

      for (const child of children) {
        const latest = child.nutritionScreenings[0];
        const isOverdue =
          !latest || latest.screeningDate.getTime() < overdueBefore.getTime();

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
          nutritionStatus: latest?.nutritionStatus ?? null,
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
        center: { select: { id: true, districtId: true } },
      },
    });

    if (!child) {
      throw new NotFoundException('Child not found');
    }

    assertCenterAccess(user, child.centerId, child.center.districtId);
    return child;
  }

  private async resolveDeviceId(
    user: AuthUser,
    deviceId?: string,
  ): Promise<string | null> {
    if (!deviceId) {
      return null;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device || device.userId !== user.id) {
      throw new ForbiddenException(
        'Device does not belong to the authenticated user',
      );
    }

    if (device.status !== DeviceStatus.active) {
      throw new ForbiddenException('Device is inactive');
    }

    return device.id;
  }
}
