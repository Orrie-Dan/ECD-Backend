import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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

export class CreateStaffTrainingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Platform user when the trainee is a centre caregiver/staff account',
  })
  @IsOptional()
  @IsUUID()
  traineeUserId?: string;

  @ApiProperty({ example: 'Uwimana Claire', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  traineeName: string;

  @ApiProperty({ example: 'Caregiver', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  traineeRole: string;

  @ApiProperty({
    example: '2026-02-10',
    description: 'Training start date. Duration is stored as durationDays.',
  })
  @IsDateString()
  trainingDate: string;

  @ApiProperty({ example: 'NCDA / District', minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  trainingProvider: string;

  @ApiProperty({ example: 'Early stimulation', minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  topic: string;

  @ApiProperty({ example: 3, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  certificateReceived: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateStaffTrainingDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  traineeUserId?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  traineeName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  traineeRole?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  trainingProvider?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  topic?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  certificateReceived?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class StaffTrainingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty()
  centerName: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  traineeUserId: string | null;

  @ApiProperty()
  traineeName: string;

  @ApiProperty()
  traineeRole: string;

  @ApiProperty({ type: String, format: 'date-time' })
  trainingDate: Date;

  @ApiProperty()
  trainingProvider: string;

  @ApiProperty()
  topic: string;

  @ApiProperty()
  durationDays: number;

  @ApiProperty()
  certificateReceived: boolean;

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

export class PaginatedStaffTrainingsResponseDto {
  @ApiProperty({ type: [StaffTrainingResponseDto] })
  items: StaffTrainingResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}
