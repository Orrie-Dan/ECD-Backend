import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsUUID } from 'class-validator';

/**
 * Period filters align with analytics dashboard / reports (inclusive UTC days).
 * National NCDA callers omit districtId; district focal persons are scoped by auth.
 */
export class DistrictRiskQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive range start (UTC day)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive range end (UTC day)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional single-district filter (NCDA admin only)',
  })
  @IsOptional()
  @IsUUID()
  districtId?: string;
}
