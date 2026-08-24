import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceStatus,
  ChildStatus,
  DeviceStatus,
  Prisma,
  RecordSyncStatus,
  ReferralStatus,
  UserAccountStatus,
  UserRole,
} from '@prisma/client';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import {
  assertCenterAccess,
  assertDistrictAccess,
  isCenterStaffRole,
} from '../../common/auth/scope.util';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CenterDetailResponseDto,
  CenterResponseDto,
  PaginatedCentersResponseDto,
} from './dto/center-response.dto';
import { ListCentersQueryDto } from './dto/list-centers-query.dto';
import { UpdateCenterDto } from './dto/update-center.dto';
import { CenterDetailRow, CenterListRow, centerMapper } from './mappers/center.mapper';

@Injectable()
export class CentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(user: AuthUser, query: ListCentersQueryDto): Promise<PaginatedCentersResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where = this.buildListWhere(user, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ecdCenter.findMany({
        where,
        include: {
          district: { select: { id: true, name: true } },
          village: { select: { id: true, name: true } },
          _count: {
            select: {
              children: {
                where: { deletedAt: null, status: ChildStatus.active },
              },
            },
          },
        },
        orderBy: [{ name: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.ecdCenter.count({ where }),
    ]);

    return {
      items: (rows as CenterListRow[]).map((r) => centerMapper.toListDto(r)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async findOne(user: AuthUser, id: string): Promise<CenterDetailResponseDto> {
    const center = await this.prisma.ecdCenter.findFirst({
      where: { id, deletedAt: null },
      include: {
        district: {
          select: {
            id: true,
            name: true,
            province: { select: { name: true } },
          },
        },
        village: { select: { id: true, name: true } },
        _count: {
          select: {
            children: {
              where: { deletedAt: null, status: ChildStatus.active },
            },
            userAccounts: {
              where: {
                role: UserRole.caregiver,
                status: UserAccountStatus.active,
              },
            },
          },
        },
      },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    assertCenterAccess(user, center.id, center.districtId);

    const today = startOfUtcDay(new Date());
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const [present, absent, pendingReferrals] = await Promise.all([
      this.prisma.attendanceRecord.count({
        where: {
          centerId: center.id,
          deletedAt: null,
          status: AttendanceStatus.present,
          attendanceDate: { gte: today, lt: tomorrow },
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          centerId: center.id,
          deletedAt: null,
          status: AttendanceStatus.absent,
          attendanceDate: { gte: today, lt: tomorrow },
        },
      }),
      this.prisma.referral.count({
        where: {
          centerId: center.id,
          deletedAt: null,
          status: ReferralStatus.pending,
        },
      }),
    ]);

    return centerMapper.toDetailDto(center as CenterDetailRow, {
      attendancePresentToday: present,
      attendanceAbsentToday: absent,
      pendingReferralsCount: pendingReferrals,
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateCenterDto): Promise<CenterDetailResponseDto> {
    const existing = await this.prisma.ecdCenter.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Center not found');
    }

    assertCenterAccess(user, existing.id, existing.districtId);
    if (isCenterStaffRole(user.role)) {
      throw new ForbiddenException('Center staff cannot update centers');
    }

    if (dto.villageId) {
      const village = await this.prisma.administrativeUnit.findFirst({
        where: { id: dto.villageId, level: 'village' },
        select: { id: true },
      });
      if (!village) {
        throw new NotFoundException('Village not found');
      }
    }

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();

    const oldValues = toAuditJson({
      name: existing.name,
      phone: existing.phone,
      capacity: existing.capacity,
      latitude: existing.latitude,
      longitude: existing.longitude,
      status: existing.status,
      villageId: existing.villageId,
      version: existing.version,
    });

    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.ecdCenter.updateMany({
        where: {
          id: existing.id,
          version: dto.version,
          deletedAt: null,
        },
        data: {
          ...(dto.name != null && { name: dto.name.trim() }),
          ...(dto.phone !== undefined && {
            phone: dto.phone?.trim() || null,
          }),
          ...(dto.capacity !== undefined && { capacity: dto.capacity }),
          ...(dto.latitude !== undefined && {
            latitude: dto.latitude == null ? null : new Prisma.Decimal(dto.latitude),
          }),
          ...(dto.longitude !== undefined && {
            longitude: dto.longitude == null ? null : new Prisma.Decimal(dto.longitude),
          }),
          ...(dto.status != null && { status: dto.status }),
          ...(dto.villageId != null && { villageId: dto.villageId }),
          updatedAt: now,
          updatedById: user.id,
          version: { increment: 1 },
          syncStatus: RecordSyncStatus.synced,
          lastModifiedByDeviceId: deviceId,
          lastModifiedAt: now,
        },
      });

      await assertCasApplied(cas.count, 'ecd_center', () =>
        tx.ecdCenter.findFirst({
          where: { id: existing.id, deletedAt: null },
          select: { version: true },
        }),
      );

      const updated = await tx.ecdCenter.findUniqueOrThrow({
        where: { id: existing.id },
      });

      await this.audit.log({
        tx,
        entityType: 'ecd_center',
        entityId: updated.id,
        action:
          dto.status != null && dto.status !== existing.status
            ? AuditAction.STATUS_CHANGE
            : AuditAction.UPDATE,
        userId: user.id,
        deviceId,
        oldValues,
        newValues: toAuditJson({
          name: updated.name,
          phone: updated.phone,
          capacity: updated.capacity,
          latitude: updated.latitude,
          longitude: updated.longitude,
          status: updated.status,
          villageId: updated.villageId,
          version: updated.version,
        }),
        metadata: { source: 'rest' },
      });
    });

    return this.findOne(user, id);
  }

  private buildListWhere(user: AuthUser, query: ListCentersQueryDto): Prisma.EcdCenterWhereInput {
    const where: Prisma.EcdCenterWhereInput = {
      deletedAt: null,
    };

    if (user.role === UserRole.caregiver) {
      if (!user.centerId) {
        throw new ForbiddenException('Center scope is required for this role');
      }
      where.id = user.centerId;
    } else if (user.role === UserRole.ecd_director) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required for ECD directors');
      }
      where.districtId = user.districtId;
    } else if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required for district focal persons');
      }
      if (query.districtId && query.districtId !== user.districtId) {
        assertDistrictAccess(user, query.districtId);
      }
      where.districtId = user.districtId;
    } else if (user.role === UserRole.ncda_admin) {
      if (query.districtId) {
        where.districtId = query.districtId;
      }
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private async resolveDeviceId(user: AuthUser, deviceId?: string): Promise<string | null> {
    if (!deviceId) return null;
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        userId: user.id,
        status: DeviceStatus.active,
      },
      select: { id: true },
    });
    return device?.id ?? null;
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type { CenterResponseDto };
