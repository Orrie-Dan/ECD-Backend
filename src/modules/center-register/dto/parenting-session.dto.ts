import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateParentingSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({ example: '2026-03-10' })
  @IsDateString()
  sessionDate: string;

  @ApiProperty({ example: 'Positive discipline', minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  topic: string;

  @ApiProperty({ example: 'Uwase Marie', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  facilitatorName: string;

  @ApiPropertyOptional({ example: 'Community health worker', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  facilitatorRole?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Set only when the facilitator is a platform user',
  })
  @IsOptional()
  @IsUUID()
  facilitatorUserId?: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  messageSummary: string;

  @ApiProperty({ example: 4, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  maleAttendees: number;

  @ApiProperty({ example: 12, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  femaleAttendees: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateParentingSessionDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  topic?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  facilitatorName?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  facilitatorRole?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  facilitatorUserId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  messageSummary?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  maleAttendees?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  femaleAttendees?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class ParentingSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty()
  centerName: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  sessionDate: Date;

  @ApiProperty()
  topic: string;

  @ApiProperty()
  facilitatorName: string;

  @ApiProperty({ nullable: true })
  facilitatorRole: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  facilitatorUserId: string | null;

  @ApiProperty()
  messageSummary: string;

  @ApiProperty()
  maleAttendees: number;

  @ApiProperty()
  femaleAttendees: number;

  @ApiProperty({ description: 'Derived as maleAttendees + femaleAttendees' })
  totalAttendees: number;

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

export class PaginatedParentingSessionsResponseDto {
  @ApiProperty({ type: [ParentingSessionResponseDto] })
  items: ParentingSessionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}
