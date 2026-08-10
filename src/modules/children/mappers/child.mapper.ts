import {
  AdministrativeLevel,
  Child,
  ChildGender,
  ChildStatus,
} from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { CreateChildDto } from '../dto/create-child.dto';
import {
  ApiChildGender,
  ChildDetailResponseDto,
  ChildResponseDto,
} from '../dto/child-response.dto';
import { UpdateChildDto } from '../dto/update-child.dto';

export type NameParts = {
  firstName: string;
  middleName: string | null;
  lastName: string | null;
};

type AdminNode = {
  id: string;
  name: string;
  level: AdministrativeLevel;
  parent?: AdminNode | null;
  district?: {
    name: string;
    province?: { name: string } | null;
  } | null;
};

export type ChildWithRelations = Child & {
  center: {
    id: string;
    name: string;
    districtId: string;
    district?: { name: string; province?: { name: string } | null } | null;
  };
  homeVillage: AdminNode;
};

export class ChildMapper
  implements Mapper<ChildWithRelations, ChildResponseDto>
{
  toDto(entity: ChildWithRelations): ChildResponseDto {
    const geo = this.resolveGeoNames(entity.homeVillage, entity.center);

    return {
      id: entity.id,
      fullName: this.toFullName(
        entity.firstName,
        entity.middleName,
        entity.lastName,
      ),
      gender: this.toApiGender(entity.gender),
      dateOfBirth: entity.dateOfBirth,
      status: entity.status,
      registrationNumber: entity.registrationNumber,
      centerId: entity.centerId,
      centerName: entity.center?.name ?? null,
      homeVillageId: entity.homeVillageId,
      province: geo.province,
      district: geo.district,
      sector: geo.sector,
      cell: geo.cell,
      village: geo.village,
      guardianName: entity.guardianName,
      guardianPhone: entity.guardianPhone,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  toDetailDto(entity: ChildWithRelations): ChildDetailResponseDto {
    return {
      ...this.toDto(entity),
      firstName: entity.firstName,
      middleName: entity.middleName,
      lastName: entity.lastName,
      guardianRelation: entity.guardianRelation,
      guardian2Name: entity.guardian2Name,
      guardian2Phone: entity.guardian2Phone,
      guardian2Relation: entity.guardian2Relation,
      notes: entity.disabilityNotes,
      specialNeeds: entity.specialNeeds,
      registeredAt: entity.registeredAt,
      archiveReason: entity.archiveReason,
      archivedAt: entity.archivedAt,
    };
  }

  toFullName(
    firstName: string,
    middleName?: string | null,
    lastName?: string | null,
  ): string {
    return [firstName, middleName, lastName]
      .map((part) => part?.trim())
      .filter((part): part is string => !!part)
      .join(' ');
  }

  splitFullName(fullName: string): NameParts {
    const tokens = fullName
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      return { firstName: '', middleName: null, lastName: null };
    }

    if (tokens.length === 1) {
      return { firstName: tokens[0], middleName: null, lastName: null };
    }

    // First token → firstName; remaining tokens → lastName (no data loss).
    return {
      firstName: tokens[0],
      middleName: null,
      lastName: tokens.slice(1).join(' '),
    };
  }

  resolveNameParts(input: {
    fullName?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
  }): NameParts {
    if (input.firstName?.trim()) {
      return {
        firstName: input.firstName.trim(),
        middleName: input.middleName?.trim() || null,
        lastName: input.lastName?.trim() || null,
      };
    }

    if (input.fullName?.trim()) {
      return this.splitFullName(input.fullName);
    }

    throw new Error('Either fullName or firstName is required');
  }

  toApiGender(gender: ChildGender): ApiChildGender {
    return gender === ChildGender.male ? 'Umuhungu' : 'Umukobwa';
  }

  toDbGender(gender: ApiChildGender): ChildGender {
    return gender === 'Umuhungu' ? ChildGender.male : ChildGender.female;
  }

  toCreateData(dto: CreateChildDto): {
    firstName: string;
    middleName: string | null;
    lastName: string | null;
    gender: ChildGender;
    centerId: string;
    disabilityNotes: string | null;
  } {
    const names = this.resolveNameParts(dto);
    return {
      ...names,
      gender: this.toDbGender(dto.gender),
      centerId: dto.centerId,
      disabilityNotes: dto.notes?.trim() ?? null,
    };
  }

  toUpdateData(dto: UpdateChildDto): {
    firstName?: string;
    middleName?: string | null;
    lastName?: string | null;
    gender?: ChildGender;
    centerId?: string;
    disabilityNotes?: string | null;
  } {
    const data: {
      firstName?: string;
      middleName?: string | null;
      lastName?: string | null;
      gender?: ChildGender;
      centerId?: string;
      disabilityNotes?: string | null;
    } = {};

    if (dto.fullName != null || dto.firstName != null) {
      const names = this.resolveNameParts({
        fullName: dto.fullName,
        firstName: dto.firstName,
        middleName: dto.middleName,
        lastName: dto.lastName,
      });
      data.firstName = names.firstName;
      data.middleName = names.middleName;
      data.lastName = names.lastName;
    } else {
      if (dto.middleName !== undefined) {
        data.middleName = dto.middleName?.trim() || null;
      }
      if (dto.lastName !== undefined) {
        data.lastName = dto.lastName?.trim() || null;
      }
    }

    if (dto.gender != null) {
      data.gender = this.toDbGender(dto.gender);
    }
    if (dto.centerId != null) {
      data.centerId = dto.centerId;
    }
    if (dto.notes !== undefined) {
      data.disabilityNotes = dto.notes?.trim() ?? null;
    }

    return data;
  }

  parseStatusFilter(status?: string): ChildStatus | undefined {
    if (!status) return undefined;
    if (
      status === ChildStatus.active ||
      status === ChildStatus.archived ||
      status === ChildStatus.transferred
    ) {
      return status;
    }
    return undefined;
  }

  private resolveGeoNames(
    village: AdminNode,
    center: ChildWithRelations['center'],
  ): {
    province: string | null;
    district: string | null;
    sector: string | null;
    cell: string | null;
    village: string | null;
  } {
    const names = {
      province: null as string | null,
      district: null as string | null,
      sector: null as string | null,
      cell: null as string | null,
      village: null as string | null,
    };

    let node: AdminNode | null | undefined = village;
    while (node) {
      if (node.level === AdministrativeLevel.village) {
        names.village = node.name;
      } else if (node.level === AdministrativeLevel.cell) {
        names.cell = node.name;
      } else if (node.level === AdministrativeLevel.sector) {
        names.sector = node.name;
        if (node.district) {
          names.district = node.district.name;
          names.province = node.district.province?.name ?? names.province;
        }
      } else if (node.level === AdministrativeLevel.province) {
        names.province = node.name;
      }
      node = node.parent;
    }

    if (!names.district && center.district) {
      names.district = center.district.name;
      names.province = center.district.province?.name ?? names.province;
    }

    return names;
  }
}

export const childMapper = new ChildMapper();
