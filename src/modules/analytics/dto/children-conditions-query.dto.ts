import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsUUID } from 'class-validator';

export const CHILDREN_CONDITION_LEVELS = ['district', 'sector'] as const;
export type ChildrenConditionLevel = (typeof CHILDREN_CONDITION_LEVELS)[number];

/**
 * Children-by-condition map query. NCDA may omit districtId for the national
 * district view; `level=sector` needs a district. District users are pinned.
 */
export class ChildrenConditionsQueryDto {
  @ApiPropertyOptional({
    enum: CHILDREN_CONDITION_LEVELS,
    default: 'district',
    description: 'Area grain of the rows. `sector` requires a district (query or assignment).',
  })
  @IsOptional()
  @IsIn(CHILDREN_CONDITION_LEVELS)
  level?: ChildrenConditionLevel;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'District filter (NCDA admin); district users are pinned to their assignment',
  })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive range start (default: 90 days before `to`)',
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
