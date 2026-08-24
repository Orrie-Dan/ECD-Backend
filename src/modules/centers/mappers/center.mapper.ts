import { EcdCenter, Prisma } from '@prisma/client';
import { CenterDetailResponseDto, CenterResponseDto } from '../dto/center-response.dto';

export type CenterListRow = EcdCenter & {
  district: { id: string; name: string };
  village: { id: string; name: string };
  _count: { children: number };
};

export type CenterDetailRow = EcdCenter & {
  district: {
    id: string;
    name: string;
    province: { name: string } | null;
  };
  village: { id: string; name: string };
  _count: {
    children: number;
    userAccounts: number;
  };
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  return Number(value);
}

export const centerMapper = {
  toListDto(row: CenterListRow): CenterResponseDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      phone: row.phone,
      capacity: row.capacity,
      latitude: decimalToNumber(row.latitude),
      longitude: decimalToNumber(row.longitude),
      status: row.status,
      districtId: row.districtId,
      districtName: row.district?.name ?? null,
      villageId: row.villageId,
      villageName: row.village?.name ?? null,
      currentComplianceLevel: row.currentComplianceLevel,
      currentComplianceAssessedAt: row.currentComplianceAssessedAt,
      activeChildrenCount: row._count?.children ?? 0,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  toDetailDto(
    row: CenterDetailRow,
    extras: {
      attendancePresentToday: number;
      attendanceAbsentToday: number;
      pendingReferralsCount: number;
    },
  ): CenterDetailResponseDto {
    return {
      ...this.toListDto({
        ...row,
        district: { id: row.district.id, name: row.district.name },
        _count: { children: row._count.children },
      }),
      provinceName: row.district.province?.name ?? null,
      caregiversCount: row._count.userAccounts,
      attendancePresentToday: extras.attendancePresentToday,
      attendanceAbsentToday: extras.attendanceAbsentToday,
      pendingReferralsCount: extras.pendingReferralsCount,
    };
  },
};
