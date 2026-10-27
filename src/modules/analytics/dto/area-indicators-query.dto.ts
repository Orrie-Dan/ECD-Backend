import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsUUID } from 'class-validator';

export const AREA_INDICATOR_LEVELS = ['sector', 'center'] as const;
export type AreaIndicatorLevel = (typeof AREA_INDICATOR_LEVELS)[number];

/**
 * Monitoring indicators below district grain (district grain is /analytics/district-risk).
 * NCDA may omit districtId for the whole country; district users are pinned.
 */
export class AreaIndicatorsQueryDto {
  @ApiPropertyOptional({
    enum: AREA_INDICATOR_LEVELS,
    default: 'sector',
    description: 'Area grain of the rows: sectors, or individual ECD centers (with coordinates).',
  })
  @IsOptional()
  @IsIn(AREA_INDICATOR_LEVELS)
  level?: AreaIndicatorLevel;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'District filter (NCDA admin); district users are pinned to their assignment',
  })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Sector (administrative unit) filter: only centers located in this sector. Combines with the district scope.',
  })
  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive range start (same default as /analytics/district-risk)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive range end (default: today)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
