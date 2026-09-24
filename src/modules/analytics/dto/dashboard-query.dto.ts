import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsUUID } from 'class-validator';

/**
 * Canonical geographic query params for analytics dashboard.
 * Hierarchy: Province → District → Sector → Cell → Village → Center.
 * Inconsistent parent/child combinations are rejected with 400.
 */
export class DashboardQueryDto {
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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional sector scope — centers whose village lies under this administrative unit',
  })
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

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;
}
