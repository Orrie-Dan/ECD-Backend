import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

/** API lifecycle status (maps from Prisma active/inactive). */
export type ApiUserStatus = 'ACTIVE' | 'SUSPENDED';

export class UserDistrictSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Gasabo' })
  name: string;
}

export class UserCenterSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ECD-001' })
  code: string;

  @ApiProperty({ example: 'Kigali ECD Center' })
  name: string;
}

export class UserCreatedBySummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'admin01' })
  username: string;

  @ApiProperty({ example: 'System Admin' })
  fullName: string;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'caregiver01' })
  username: string;

  @ApiProperty({ example: 'Jane Doe' })
  fullName: string;

  @ApiProperty({ example: '+250788123456', nullable: true })
  phone: string | null;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  @ApiProperty({
    enum: ['ACTIVE', 'SUSPENDED'],
    enumName: 'ApiUserStatus',
  })
  status: ApiUserStatus;

  @ApiProperty({ type: () => UserDistrictSummaryDto, nullable: true })
  district: UserDistrictSummaryDto | null;

  @ApiProperty({ type: () => UserCenterSummaryDto, nullable: true })
  center: UserCenterSummaryDto | null;

  @ApiProperty({ type: () => UserCreatedBySummaryDto, nullable: true })
  createdBy: UserCreatedBySummaryDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

/**
 * Create response — includes a one-time temporary password.
 * The password is never returned again from GET/list/update.
 */
export class CreateUserResponseDto extends UserResponseDto {
  @ApiProperty({
    description:
      'One-time temporary password for the new account. Share out-of-band with the user; it is not returned on subsequent reads.',
    example: 'K7mN2pQx9R',
  })
  temporaryPassword: string;

  @ApiProperty({
    description:
      'True when the user should change password on first login (passwordChangedAt is null).',
    example: true,
  })
  mustChangePassword: boolean;
}

/**
 * Admin password reset response.
 * When the server generates a temporary password, it is returned once here.
 */
export class ResetUserPasswordResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    required: false,
    description:
      'Present only when the server generated a temporary password (no `newPassword` in the request). Share out-of-band; not returned again.',
    example: 'K7mN2pQx9R',
  })
  temporaryPassword?: string;

  @ApiProperty({
    description:
      'True when a temporary password was generated and the user should change it on next login.',
    example: true,
  })
  mustChangePassword: boolean;
}

export class PaginatedUsersResponseDto {
  @ApiProperty({
    type: [UserResponseDto],
    description: 'User rows (legacy key — kept for backwards compatibility)',
  })
  data: UserResponseDto[];

  @ApiProperty({
    type: [UserResponseDto],
    description: 'Same array as `data` (additive alias aligned with other list endpoints)',
  })
  items: UserResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({
    example: 3,
    description: 'ceil(total / pageSize), minimum 1',
  })
  totalPages: number;
}
