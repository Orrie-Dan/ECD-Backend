import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ChildrenDemographicsQueryDto } from './children-demographics-query.dto';

export const CHILDREN_DISTRIBUTION_LEVELS = [
  'province',
  'district',
  'sector',
  'cell',
  'village',
  'center',
] as const;
export type ChildrenDistributionLevel = (typeof CHILDREN_DISTRIBUTION_LEVELS)[number];

/** Same geographic scope as /analytics/children-demographics, plus the grain of the rows. */
export class ChildrenDistributionQueryDto extends ChildrenDemographicsQueryDto {
  @ApiPropertyOptional({
    enum: CHILDREN_DISTRIBUTION_LEVELS,
    default: 'district',
    description: 'Administrative grain of the rows, down to individual ECD centers.',
  })
  @IsOptional()
  @IsIn(CHILDREN_DISTRIBUTION_LEVELS)
  level?: ChildrenDistributionLevel;
}
