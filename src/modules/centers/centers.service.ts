import {
  AttendanceStatus,
  ChildStatus,
  ClassroomGrade,
  DeviceStatus,
  UserAccountStatus,
  UserRole,
} from '../../common/domain';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordSyncStatus, ReferralStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditAction, AuditService, toAuditJson } from '../../common/audit';
import { isCenterStaffRole } from '../../common/auth/scope.util';
import {
  assertCenterAccessible,
  ecdCenterWhere,
  resolveDistrictQueryScope,
} from '../../common/scope/district-query.scope';
import { assertCasApplied } from '../../common/concurrency/cas.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  CenterDetailResponseDto,
  CenterResponseDto,
  PaginatedCentersResponseDto,
} from './dto/center-response.dto';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { CreateCenterDto } from './dto/create-center.dto';
import { ListCentersQueryDto } from './dto/list-centers-query.dto';
import { OverrideCenterCodeDto } from './dto/override-center-code.dto';
import { UpdateCenterDto } from './dto/update-center.dto';
import {
  NCDA_TYPE_TO_FACILITY_TYPE,
  isValidStartYear,
  mapEcdCodeDbError,
  resolveTypeUpdate,
} from './ecd-code';
import { CenterDetailRow, CenterListRow, centerMapper } from './mappers/center.mapper';

@Injectable()
export class CentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  async findAll(user: AuthUser, query: ListCentersQueryDto): Promise<PaginatedCentersResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where = await this.buildListWhere(user, query);

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

    await assertCenterAccessible(this.prisma, user, {
      id: center.id,
      districtId: center.districtId,
      villageId: center.villageId,
    });

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

    await assertCenterAccessible(this.prisma, user, {
      id: existing.id,
      districtId: existing.districtId,
      villageId: existing.villageId,
    });
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

    if (dto.startYear !== undefined && !isValidStartYear(dto.startYear)) {
      throw new BadRequestException('startYear cannot be in the future');
    }
    const typeUpdate = resolveTypeUpdate(existing, {
      ncdaTypeCode: dto.ncdaTypeCode,
      facilityType: dto.facilityType,
    });

    const deviceId = await this.resolveDeviceId(user, dto.deviceId);
    const now = new Date();

    const oldValues = toAuditJson({
      name: existing.name,
      phone: existing.phone,
      capacity: existing.capacity,
      latitude: existing.latitude,
      longitude: existing.longitude,
      status: existing.status,
      facilityType: existing.facilityType,
      ncdaTypeCode: existing.ncdaTypeCode,
      startYear: existing.startYear,
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
            latitude: dto.latitude == null ? null : dto.latitude,
          }),
          ...(dto.longitude !== undefined && {
            longitude: dto.longitude == null ? null : dto.longitude,
          }),
          ...(dto.status != null && { status: dto.status }),
          ...typeUpdate,
          ...(dto.startYear !== undefined && { startYear: dto.startYear }),
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
          facilityType: updated.facilityType,
          ncdaTypeCode: updated.ncdaTypeCode,
          startYear: updated.startYear,
          villageId: updated.villageId,
          version: updated.version,
        }),
        metadata: { source: 'rest' },
      });
    });

    return this.findOne(user, id);
  }

  /**
   * Register a facility and issue its NCDA code (survey.issue_ecd_code) in the
   * same transaction, so a failed insert never consumes a registry entry.
   */
  async create(user: AuthUser, dto: CreateCenterDto): Promise<CenterDetailResponseDto> {
    if (isCenterStaffRole(user.role)) {
      throw new ForbiddenException('Center staff cannot register centers');
    }
    if (!isValidStartYear(dto.startYear)) {
      throw new BadRequestException('startYear cannot be in the future');
    }

    const village = await this.prisma.administrativeUnit.findFirst({
      where: { id: dto.villageId, level: 'village' },
      select: { id: true, districtId: true, minalocCode: true },
    });
    if (!village) {
      throw new NotFoundException('Village not found');
    }
    if (!village.districtId) {
      throw new BadRequestException('Village is not linked to a district');
    }
    if (!village.minalocCode) {
      throw new BadRequestException(
        'Village has no MINALOC code; it must be in the national register before a facility can be coded',
      );
    }

    const id = randomUUID();
    await assertCenterAccessible(this.prisma, user, {
      id,
      districtId: village.districtId,
      villageId: village.id,
    });

    const facilityType = NCDA_TYPE_TO_FACILITY_TYPE[dto.ncdaTypeCode];
    const now = new Date();

    const created = await this.prisma
      .$transaction(async (tx) => {
        const [{ code }] = await tx.$queryRaw<Array<{ code: string }>>`
          SELECT survey.issue_ecd_code(${id}, ${village.id}, ${dto.ncdaTypeCode}, ${dto.startYear}::int, ${user.id}) AS code`;

        const center = await tx.ecdCenter.create({
          data: {
            id,
            districtId: village.districtId!,
            villageId: village.id,
            code,
            name: dto.name.trim(),
            phone: dto.phone?.trim() || null,
            capacity: dto.capacity ?? null,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
            ...(dto.status != null && { status: dto.status }),
            facilityType,
            ncdaTypeCode: dto.ncdaTypeCode,
            startYear: dto.startYear,
            codeIssuedAt: now,
            createdById: user.id,
            updatedById: user.id,
            syncStatus: RecordSyncStatus.synced,
            lastModifiedAt: now,
          },
        });

        await tx.classroom.createMany({
          data: Object.values(ClassroomGrade).map((grade) => ({ centerId: id, grade })),
          skipDuplicates: true,
        });

        await this.audit.log({
          tx,
          entityType: 'ecd_center',
          entityId: id,
          action: AuditAction.CREATE,
          userId: user.id,
          newValues: toAuditJson({
            code: center.code,
            name: center.name,
            villageId: center.villageId,
            districtId: center.districtId,
            ncdaTypeCode: center.ncdaTypeCode,
            facilityType: center.facilityType,
            startYear: center.startYear,
            status: center.status,
            version: center.version,
          }),
          metadata: { source: 'rest' },
        });

        return center;
      })
      .catch((error: unknown) => {
        throw mapEcdCodeDbError(error) ?? error;
      });

    const district = await this.prisma.district.findUnique({
      where: { id: created.districtId },
      select: { name: true },
    });
    await this.notificationEvents.onCenterCreated({
      centerId: created.id,
      centerName: created.name,
      districtId: created.districtId,
      districtName: district?.name ?? null,
    });

    return this.findOne(user, id);
  }

  /** NCDA-only replacement of an issued code. The old code is retired, never reused. */
  async overrideCode(
    user: AuthUser,
    id: string,
    dto: OverrideCenterCodeDto,
  ): Promise<CenterDetailResponseDto> {
    if (user.role !== UserRole.ncda_admin) {
      throw new ForbiddenException('Only NCDA administrators can override facility codes');
    }

    const existing = await this.prisma.ecdCenter.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, legacyCode: true, version: true },
    });
    if (!existing) {
      throw new NotFoundException('Center not found');
    }

    await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT survey.override_ecd_code(${id}, ${dto.code}, ${dto.reason.trim()}, ${user.id})`;

        const updated = await tx.ecdCenter.findUniqueOrThrow({
          where: { id },
          select: { code: true, legacyCode: true, version: true },
        });

        await this.audit.log({
          tx,
          entityType: 'ecd_center',
          entityId: id,
          action: AuditAction.UPDATE,
          userId: user.id,
          oldValues: toAuditJson(existing),
          newValues: toAuditJson({ id, ...updated }),
          metadata: { source: 'rest', operation: 'ecd_code_override', reason: dto.reason.trim() },
        });
      })
      .catch((error: unknown) => {
        throw mapEcdCodeDbError(error) ?? error;
      });

    return this.findOne(user, id);
  }

  private async buildListWhere(
    user: AuthUser,
    query: ListCentersQueryDto,
  ): Promise<Prisma.EcdCenterWhereInput> {
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
    } else if (
      user.role === UserRole.district_focal_person ||
      user.role === UserRole.sector_focal_person ||
      user.role === UserRole.ncda_admin
    ) {
      const scope = await resolveDistrictQueryScope(this.prisma, user, {
        provinceId: query.provinceId,
        districtId: query.districtId,
        sectorId: query.sectorId,
        cellId: query.cellId,
        villageId: query.villageId,
      });
      Object.assign(where, ecdCenterWhere(scope));
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { legacyCode: { contains: q, mode: 'insensitive' } },
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
