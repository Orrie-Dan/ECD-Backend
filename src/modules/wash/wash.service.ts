import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordSyncStatus, UserRole } from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { assertCenterAccess } from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateWashIndicatorDto } from './dto/create-wash-indicator.dto';
import { ListWashIndicatorsQueryDto } from './dto/list-wash-indicators-query.dto';
import { UpdateWashIndicatorDto } from './dto/update-wash-indicator.dto';
import {
  PaginatedWashIndicatorsResponseDto,
  WashIndicatorResponseDto,
} from './dto/wash-indicator-response.dto';

@Injectable()
export class WashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listIndicators(
    user: AuthUser,
    query: ListWashIndicatorsQueryDto,
  ): Promise<PaginatedWashIndicatorsResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where = this.buildListWhere(user, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.washIndicator.findMany({
        where,
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
        orderBy: [{ recordedDate: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.washIndicator.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async getIndicator(
    user: AuthUser,
    id: string,
  ): Promise<WashIndicatorResponseDto> {
    const indicator = await this.prisma.washIndicator.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });

    if (!indicator) {
      throw new NotFoundException('WASH indicator not found');
    }

    assertCenterAccess(
      user,
      indicator.centerId,
      indicator.center.districtId,
    );

    return this.toDto(indicator);
  }

  async createIndicator(
    user: AuthUser,
    dto: CreateWashIndicatorDto,
  ): Promise<WashIndicatorResponseDto> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id: dto.centerId, deletedAt: null },
      select: { id: true, name: true, districtId: true },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    assertCenterAccess(user, center.id, center.districtId);

    const now = new Date();
    const recordedDate = new Date(dto.recordedDate);

    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.washIndicator.create({
        data: {
          centerId: dto.centerId,
          recordedDate,
          waterSourceAvailable: dto.waterSourceAvailable,
          waterSourceType: dto.waterSourceType ?? null,
          sanitationFacilityAvailable: dto.sanitationFacilityAvailable,
          latrineCount: dto.latrineCount ?? null,
          handwashingFacilityAvailable: dto.handwashingFacilityAvailable,
          wasteManagementAvailable: dto.wasteManagementAvailable,
          notes: dto.notes ?? null,
          recordedById: user.id,
          createdAt: now,
          version: 1,
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await this.audit.log({
        tx,
        entityType: 'wash_indicator',
        entityId: created.id,
        action: AuditAction.CREATE,
        userId: user.id,
        oldValues: null,
        newValues: toAuditJson({
          centerId: created.centerId,
          recordedDate: created.recordedDate,
          waterSourceAvailable: created.waterSourceAvailable,
          sanitationFacilityAvailable: created.sanitationFacilityAvailable,
          handwashingFacilityAvailable: created.handwashingFacilityAvailable,
          wasteManagementAvailable: created.wasteManagementAvailable,
          version: created.version,
        }),
        metadata: { source: 'rest' },
      });

      return created;
    });

    return this.toDto({
      ...result,
      center,
    });
  }

  async updateIndicator(
    user: AuthUser,
    id: string,
    dto: UpdateWashIndicatorDto,
  ): Promise<WashIndicatorResponseDto> {
    const existing = await this.prisma.washIndicator.findFirst({
      where: { id, deletedAt: null },
      include: {
        center: { select: { id: true, name: true, districtId: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('WASH indicator not found');
    }

    assertCenterAccess(
      user,
      existing.centerId,
      existing.center.districtId,
    );

    const now = new Date();
    const oldValues = toAuditJson({
      waterSourceAvailable: existing.waterSourceAvailable,
      waterSourceType: existing.waterSourceType,
      sanitationFacilityAvailable: existing.sanitationFacilityAvailable,
      latrineCount: existing.latrineCount,
      handwashingFacilityAvailable: existing.handwashingFacilityAvailable,
      wasteManagementAvailable: existing.wasteManagementAvailable,
      notes: existing.notes,
      version: existing.version,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.washIndicator.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data: {
          ...(dto.waterSourceAvailable != null && {
            waterSourceAvailable: dto.waterSourceAvailable,
          }),
          ...(dto.waterSourceType !== undefined && {
            waterSourceType: dto.waterSourceType ?? null,
          }),
          ...(dto.sanitationFacilityAvailable != null && {
            sanitationFacilityAvailable: dto.sanitationFacilityAvailable,
          }),
          ...(dto.latrineCount !== undefined && {
            latrineCount: dto.latrineCount ?? null,
          }),
          ...(dto.handwashingFacilityAvailable != null && {
            handwashingFacilityAvailable: dto.handwashingFacilityAvailable,
          }),
          ...(dto.wasteManagementAvailable != null && {
            wasteManagementAvailable: dto.wasteManagementAvailable,
          }),
          ...(dto.notes !== undefined && {
            notes: dto.notes ?? null,
          }),
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'wash_indicator', () =>
        tx.washIndicator.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const updated = await tx.washIndicator.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          center: { select: { id: true, name: true, districtId: true } },
        },
      });

      await this.audit.log({
        tx,
        entityType: 'wash_indicator',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        userId: user.id,
        oldValues,
        newValues: toAuditJson({
          waterSourceAvailable: updated.waterSourceAvailable,
          waterSourceType: updated.waterSourceType,
          sanitationFacilityAvailable: updated.sanitationFacilityAvailable,
          latrineCount: updated.latrineCount,
          handwashingFacilityAvailable: updated.handwashingFacilityAvailable,
          wasteManagementAvailable: updated.wasteManagementAvailable,
          notes: updated.notes,
          version: updated.version,
        }),
        metadata: { source: 'rest' },
      });

      return updated;
    });

    return this.toDto(result);
  }

  private buildListWhere(
    user: AuthUser,
    query: ListWashIndicatorsQueryDto,
  ): Prisma.WashIndicatorWhereInput {
    const where: Prisma.WashIndicatorWhereInput = {
      deletedAt: null,
    };

    if (user.role === UserRole.caregiver) {
      if (!user.centerId) {
        throw new ForbiddenException('Center scope is required for caregivers');
      }
      where.centerId = user.centerId;
    } else if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException(
          'District scope is required for district focal persons',
        );
      }
      if (query.districtId && query.districtId !== user.districtId) {
        throw new ForbiddenException('Access to other districts is denied');
      }
      where.center = { districtId: user.districtId };
    } else if (user.role === UserRole.ncda_admin) {
      if (query.districtId) {
        where.center = { districtId: query.districtId };
      }
    }

    if (query.centerId) {
      where.centerId = query.centerId;
    }

    if (query.from || query.to) {
      where.recordedDate = {};
      if (query.from) {
        where.recordedDate.gte = new Date(query.from);
      }
      if (query.to) {
        where.recordedDate.lte = new Date(query.to);
      }
    }

    return where;
  }

  private toDto(row: {
    id: string;
    centerId: string;
    recordedDate: Date;
    waterSourceAvailable: boolean;
    waterSourceType: string | null;
    sanitationFacilityAvailable: boolean;
    latrineCount: number | null;
    handwashingFacilityAvailable: boolean;
    wasteManagementAvailable: boolean;
    notes: string | null;
    recordedById: string;
    version: number;
    createdAt: Date;
    center: { id: string; name: string; districtId: string };
  }): WashIndicatorResponseDto {
    return {
      id: row.id,
      centerId: row.centerId,
      centerName: row.center.name,
      districtId: row.center.districtId,
      recordedDate: row.recordedDate,
      waterSourceAvailable: row.waterSourceAvailable,
      waterSourceType: row.waterSourceType,
      sanitationFacilityAvailable: row.sanitationFacilityAvailable,
      latrineCount: row.latrineCount,
      handwashingFacilityAvailable: row.handwashingFacilityAvailable,
      wasteManagementAvailable: row.wasteManagementAvailable,
      notes: row.notes,
      recordedById: row.recordedById,
      version: row.version,
      createdAt: row.createdAt,
    };
  }
}
