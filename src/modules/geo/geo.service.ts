import { AdministrativeLevel, EcdCenterStatus, UserRole, asDomainEnum } from '../../common/domain';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    if (query.districtId) {
      if (user.role === UserRole.district_focal_person) {
        assertDistrictAccess(user, query.districtId);
      }
    }

    // Drill-down by parent (sector → cell → village) takes precedence.
    if (query.parentId) {
      const where: Prisma.AdministrativeUnitWhereInput = {
        parentId: query.parentId,
      };
      if (query.level) {
        where.level = query.level;
      }
      const rows = await this.prisma.administrativeUnit.findMany({
        where,
        orderBy: [{ name: 'asc' }],
      });
      return rows.map((row) => this.toAdminUnitDto(row));
    }

    if (query.districtId && query.level) {
      const rows = await this.findAdminUnitsInDistrict(query.districtId, query.level);
      return rows.map((row) => this.toAdminUnitDto(row));
    }

    const where: Prisma.AdministrativeUnitWhereInput = {};

    if (query.districtId) {
      where.districtId = query.districtId;
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

  /**
   * Cells and villages often have district_id NULL (only sectors are tagged).
   * Resolve them via parent chain so mobile can list villages for a district.
   */
  private async findAdminUnitsInDistrict(districtId: string, level: AdministrativeLevel) {
    if (level === AdministrativeLevel.sector || level === AdministrativeLevel.province) {
      return this.prisma.administrativeUnit.findMany({
        where: { districtId, level },
        orderBy: [{ name: 'asc' }],
      });
    }

    const sectors = await this.prisma.administrativeUnit.findMany({
      where: { districtId, level: AdministrativeLevel.sector },
      select: { id: true },
    });
    const sectorIds = sectors.map((s) => s.id);

    if (level === AdministrativeLevel.cell) {
      if (sectorIds.length === 0) {
        return [];
      }
      return this.prisma.administrativeUnit.findMany({
        where: { level: AdministrativeLevel.cell, parentId: { in: sectorIds } },
        orderBy: [{ name: 'asc' }],
      });
    }

    if (level === AdministrativeLevel.village) {
      if (sectorIds.length === 0) {
        return [];
      }
      const cells = await this.prisma.administrativeUnit.findMany({
        where: { level: AdministrativeLevel.cell, parentId: { in: sectorIds } },
        select: { id: true },
      });
      const cellIds = cells.map((c) => c.id);
      if (cellIds.length === 0) {
        return [];
      }
      return this.prisma.administrativeUnit.findMany({
        where: { level: AdministrativeLevel.village, parentId: { in: cellIds } },
        orderBy: [{ name: 'asc' }],
      });
    }

    return this.prisma.administrativeUnit.findMany({
      where: { districtId, level },
      orderBy: [{ name: 'asc' }],
    });
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
    level: string;
    parentId: string | null;
    districtId: string | null;
    name: string;
    code: string;
    latitude: number | null;
    longitude: number | null;
    createdAt: Date;
  }): AdminUnitResponseDto {
    return {
      id: row.id,
      level: asDomainEnum<AdministrativeLevel>(row.level),
      parentId: row.parentId,
      districtId: row.districtId,
      name: row.name,
      code: row.code,
      latitude: row.latitude,
      longitude: row.longitude,
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
    status: string;
    villageId: string;
    latitude: number | null;
    longitude: number | null;
    village: { id: string; name: string };
  }): CenterInDistrictResponseDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      phone: row.phone,
      capacity: row.capacity,
      status: asDomainEnum<EcdCenterStatus>(row.status),
      villageId: row.villageId,
      villageName: row.village.name,
      latitude: row.latitude,
      longitude: row.longitude,
    };
  }
}
