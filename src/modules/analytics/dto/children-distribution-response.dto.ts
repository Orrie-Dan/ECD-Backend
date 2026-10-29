import { ApiProperty } from '@nestjs/swagger';
import {
  CHILDREN_DISTRIBUTION_LEVELS,
  ChildrenDistributionLevel,
} from './children-distribution-query.dto';

export class ChildrenDistributionItemDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'Area id (administrative unit, district or ECD center); null = center not linked to this level',
  })
  areaId: string | null;

  @ApiProperty({ example: 'Kimironko', nullable: true })
  areaName: string | null;

  @ApiProperty({ example: 120 })
  boys: number;

  @ApiProperty({ example: 130 })
  girls: number;

  @ApiProperty({ example: 250 })
  total: number;
}

export class ChildrenDistributionResponseDto {
  @ApiProperty({ enum: CHILDREN_DISTRIBUTION_LEVELS })
  level: ChildrenDistributionLevel;

  @ApiProperty({
    type: () => ChildrenDistributionItemDto,
    isArray: true,
    description:
      'Active children boys/girls/total per area in scope, most children first. Only areas with children are listed.',
  })
  items: ChildrenDistributionItemDto[];
}
