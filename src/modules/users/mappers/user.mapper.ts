import {
  EducationLevel,
  PersonSex,
  UserAccountStatus,
  UserRole,
  asDomainEnum,
  asDomainEnumNullable,
} from '../../../common/domain';
import { UserAccount } from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { ApiUserStatus, UserResponseDto } from '../dto/user-response.dto';

export type UserWithRelations = UserAccount & {
  district: { id: string; name: string } | null;
  center: { id: string; code: string; name: string } | null;
  createdBy: { id: string; username: string; fullName: string } | null;
};

export type UserCreateMapped = {
  username: string;
  fullName: string;
  phone: string | null;
  gender: PersonSex | null;
  educationLevel: EducationLevel | null;
  role: UserRole;
  districtId: string | null;
  centerId: string | null;
};

export type UserUpdateMapped = {
  fullName?: string;
  phone?: string | null;
  gender?: PersonSex | null;
  educationLevel?: EducationLevel | null;
  status?: UserAccountStatus;
};

export class UserMapper implements Mapper<UserWithRelations, UserResponseDto> {
  toDto(entity: UserWithRelations): UserResponseDto {
    return {
      id: entity.id,
      username: entity.username,
      fullName: entity.fullName,
      phone: entity.phone,
      gender: asDomainEnumNullable<PersonSex>(entity.gender),
      educationLevel: asDomainEnumNullable<EducationLevel>(entity.educationLevel),
      role: asDomainEnum<UserRole>(entity.role),
      status: this.toApiStatus(asDomainEnum<UserAccountStatus>(entity.status)),
      district: entity.district ? { id: entity.district.id, name: entity.district.name } : null,
      center: entity.center
        ? {
            id: entity.center.id,
            code: entity.center.code,
            name: entity.center.name,
          }
        : null,
      createdBy: entity.createdBy
        ? {
            id: entity.createdBy.id,
            username: entity.createdBy.username,
            fullName: entity.createdBy.fullName,
          }
        : null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  toApiStatus(status: UserAccountStatus): ApiUserStatus {
    return status === UserAccountStatus.active ? 'ACTIVE' : 'SUSPENDED';
  }

  toDbStatus(status: ApiUserStatus): UserAccountStatus {
    return status === 'ACTIVE' ? UserAccountStatus.active : UserAccountStatus.inactive;
  }

  /**
   * Maps create DTO scalars. Role-specific district/center resolution
   * (including deriving district from center) is done in the service.
   */
  toCreateInput(dto: CreateUserDto): UserCreateMapped {
    return {
      username: dto.username.trim(),
      fullName: dto.fullName.trim(),
      phone: dto.phone?.trim() || null,
      gender: dto.gender ?? null,
      educationLevel: dto.educationLevel ?? null,
      role: dto.role,
      districtId: dto.districtId ?? null,
      centerId: dto.centerId ?? null,
    };
  }

  toUpdateInput(dto: UpdateUserDto): UserUpdateMapped {
    const data: UserUpdateMapped = {};

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
    }
    if (dto.phone !== undefined) {
      data.phone = dto.phone?.trim() || null;
    }
    if (dto.gender !== undefined) {
      data.gender = dto.gender;
    }
    if (dto.educationLevel !== undefined) {
      data.educationLevel = dto.educationLevel;
    }
    if (dto.status !== undefined) {
      data.status = this.toDbStatus(dto.status);
    }

    return data;
  }
}

export const userMapper = new UserMapper();
