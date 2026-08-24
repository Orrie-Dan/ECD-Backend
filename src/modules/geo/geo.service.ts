import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdministrativeLevel, EcdCenterStatus, Prisma, UserRole } from '@prisma/client';
import { assertDistrictAccess, isCenterStaffRole } from '../../common/auth/scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/jwt-payload.interface';
import {
  AdminUnitResponseDto,
  CenterInDistrictResponseDto,
  DistrictResponseDto,
  PaginatedCentersInDistrictResponseDto,
  PaginatedDistrictsResponseDto,
} from './dto/geo-response.dto';
import { ListAdminUnitsQueryDto } from './dto/list-admin-units-query.dto';
import { ListCentersByDistrictQueryDto } from './dto/list-centers-by-district-query.dto';
import { ListDistrictsQueryDto } from './dto/list-districts-query.dto';

@Injectable()
export class GeoService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdminUnits(
    user: AuthUser,
    query: ListAdminUnitsQueryDto,
  ): Promise<AdminUnitResponseDto[]> {
    const where: Prisma.AdministrativeUnitWhereInput = {};

    if (query.districtId) {
      if (user.role === UserRole.district_focal_person) {
        assertDistrictAccess(user, query.districtId);
      }
      where.districtId = query.districtId;
    }

    if (query.parentId) {
      where.parentId = query.parentId;
    }

    if (query.level) {
      where.level = query.level;
    }

    const rows = await this.prisma.administrativeUnit.findMany({
      where,
      orderBy: [{ name: 'asc' }],
    });

    return rows.map((row) => this.toAdminUnitDto(row));
  }

  async listDistricts(
    user: AuthUser,
    query: ListDistrictsQueryDto,
  ): Promise<PaginatedDistrictsResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.DistrictWhereInput = {};

    if (user.role === UserRole.district_focal_person) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required');
      }
      where.id = user.districtId;
    } else if (isCenterStaffRole(user.role)) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required');
      }
      where.id = user.districtId;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (typeof query.isActive === 'boolean') {
      where.isActive = query.isActive;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.district.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.district.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDistrictDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async getDistrict(user: AuthUser, districtId: string): Promise<DistrictResponseDto> {
    if (user.role === UserRole.district_focal_person || isCenterStaffRole(user.role)) {
      if (!user.districtId) {
        throw new ForbiddenException('District scope is required');
      }
      if (user.role === UserRole.district_focal_person) {
        assertDistrictAccess(user, districtId);
      } else if (user.districtId !== districtId) {
        throw new ForbiddenException(
          `You do not have access to district ${districtId} (${user.role})`,
        );
      }
    }

    const row = await this.prisma.district.findUnique({
      where: { id: districtId },
    });

    if (!row) {
      throw new NotFoundException('District not found');
    }

    return this.toDistrictDto(row);
  }

  async listCentersByDistrict(
    user: AuthUser,
    districtId: string,
    query: ListCentersByDistrictQueryDto,
  ): Promise<PaginatedCentersInDistrictResponseDto> {
    if (user.role === UserRole.district_focal_person) {
      assertDistrictAccess(user, districtId);
    } else if (isCenterStaffRole(user.role)) {
      throw new ForbiddenException('Center staff cannot list centers by district');
    }

    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
      select: { id: true },
    });

    if (!district) {
      throw new NotFoundException('District not found');
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.EcdCenterWhereInput = {
      districtId,
      deletedAt: null,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ecdCenter.findMany({
        where,
        include: {
          village: { select: { id: true, name: true } },
        },
        orderBy: [{ name: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.ecdCenter.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toCenterInDistrictDto(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  private toAdminUnitDto(row: {
    id: string;
    level: AdministrativeLevel;
    parentId: string | null;
    districtId: string | null;
    name: string;
    code: string;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    createdAt: Date;
  }): AdminUnitResponseDto {
    return {
      id: row.id,
      level: row.level,
      parentId: row.parentId,
      districtId: row.districtId,
      name: row.name,
      code: row.code,
      latitude: row.latitude ? row.latitude.toNumber() : null,
      longitude: row.longitude ? row.longitude.toNumber() : null,
      createdAt: row.createdAt,
    };
  }

  private toDistrictDto(row: {
    id: string;
    provinceId: string;
    code: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): DistrictResponseDto {
    return {
      id: row.id,
      provinceId: row.provinceId,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toCenterInDistrictDto(row: {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    capacity: number | null;
    status: EcdCenterStatus;
    villageId: string;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    village: { id: string; name: string };
  }): CenterInDistrictResponseDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      phone: row.phone,
      capacity: row.capacity,
      status: row.status,
      villageId: row.villageId,
      villageName: row.village.name,
      latitude: row.latitude ? row.latitude.toNumber() : null,
      longitude: row.longitude ? row.longitude.toNumber() : null,
    };
  }
}
