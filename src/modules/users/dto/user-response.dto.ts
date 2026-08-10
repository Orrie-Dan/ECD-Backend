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
