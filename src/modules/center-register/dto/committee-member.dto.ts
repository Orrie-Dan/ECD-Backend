import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCommitteeMemberDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional link when the member is also a platform user',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ example: 'Niyonsenga Jean', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName: string;

  @ApiProperty({ example: 'President', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  position: string;

  @ApiPropertyOptional({ example: '+250788000000', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCommitteeMemberDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  position?: string;

  @ApiPropertyOptional({ maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({
    description:
      'Set false to end membership without deleting history. Prefer deactivate endpoint.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class DeactivateCommitteeMemberDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CommitteeMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty()
  centerName: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  userId: string | null;

  @ApiProperty()
  fullName: string;

  @ApiProperty()
  position: string;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startDate: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endDate: Date | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty({ format: 'uuid' })
  recordedById: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class PaginatedCommitteeMembersResponseDto {
  @ApiProperty({ type: [CommitteeMemberResponseDto] })
  items: CommitteeMemberResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}
