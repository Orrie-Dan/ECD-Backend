import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const ATTENDANCE_SORTS = ['rate_desc', 'rate_asc'] as const;
export type AttendanceSort = (typeof ATTENDANCE_SORTS)[number];

export class MonitoringQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional province scope — all centers in districts under this province',
  })
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional cell scope — centers whose village lies under this administrative unit',
  })
  @IsOptional()
  @IsUUID()
  cellId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional village scope — centers in this village',
  })
  @IsOptional()
  @IsUUID()
  villageId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive range start',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive range end',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class MonitoringAttendanceQueryDto extends MonitoringQueryDto {
  @ApiPropertyOptional({
    enum: ATTENDANCE_SORTS,
    default: 'rate_desc',
    description:
      'Order of the per-center rows before pagination. Centers without attendance records are always last.',
  })
  @IsOptional()
  @IsIn(ATTENDANCE_SORTS)
  sort?: AttendanceSort;
}
