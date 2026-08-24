import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AbsentReason } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsAttendanceDate, UniqueChildDateInBatch } from '../validators/attendance.validators';

export class AttendanceBatchRecordDto {
  @ApiProperty({
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  childId: string;

  @ApiProperty({
    example: '2024-06-15',
    description: 'Attendance date (YYYY-MM-DD)',
  })
  @IsAttendanceDate()
  date: string;

  @ApiProperty({ example: true, description: 'Whether the child was present' })
  @IsBoolean()
  present: boolean;

  @ApiProperty({
    enum: AbsentReason,
    enumName: 'AbsentReason',
    required: false,
    description: 'Required when present is false',
    example: AbsentReason.sick,
  })
  @ValidateIf((o: AttendanceBatchRecordDto) => o.present === false)
  @IsEnum(AbsentReason)
  @IsNotEmpty()
  absentReason?: AbsentReason;

  @ApiPropertyOptional({ example: 'Arrived late', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Required when correcting an existing attendance row (optimistic lock).
   * Omit on first create for the child+date key.
   */
  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    description:
      'Required when correcting an existing attendance row (optimistic lock). Omit on first create.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Originating device UUID for offline sync',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({
    example: 'local-att-001',
    maxLength: 100,
    description: 'Client-side local identifier for sync correlation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  localId?: string;
}

export class AttendanceBatchDto {
  @ApiProperty({
    type: () => [AttendanceBatchRecordDto],
    minItems: 1,
    maxItems: 500,
    description: 'Attendance records to create or update (max 500)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceBatchRecordDto)
  @UniqueChildDateInBatch()
  records: AttendanceBatchRecordDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Originating device UUID for offline sync',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional center scope for the batch',
  })
  @IsOptional()
  @IsUUID()
  centerId?: string;
}
