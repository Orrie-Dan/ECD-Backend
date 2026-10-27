import { ApiProperty } from '@nestjs/swagger';
import {
  CHILDREN_CONDITION_LEVELS,
  type ChildrenConditionLevel,
} from './children-conditions-query.dto';

export class ChildrenConditionMeasureDto {
  @ApiProperty({ example: 120, description: 'Children the rate is computed over' })
  denominator: number;

  @ApiProperty({
    example: 18,
    nullable: true,
    description: 'Children with the condition. Null when `denominator` < `minDenominator`.',
  })
  affected: number | null;

  @ApiProperty({
    example: 15,
    nullable: true,
    description:
      'affected ÷ denominator, percent (1 dp). Null when suppressed or denominator is 0.',
  })
  rate: number | null;
}

export class ChildrenConditionAreaDto {
  @ApiProperty({ format: 'uuid', description: 'District id or sector administrative-unit id' })
  areaId: string;

  @ApiProperty({ example: 'Kimironko' })
  areaName: string;

  @ApiProperty({ example: '110203' })
  areaCode: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({
    example: 'Gasabo',
    description: 'Parent district (same as areaName at district level)',
  })
  districtName: string;

  @ApiProperty({ example: 640, description: 'Active children at ECD centers located in the area' })
  activeChildren: number;

  @ApiProperty({
    type: ChildrenConditionMeasureDto,
    description:
      'Latest height-for-age in range below −2 SD, over children with a classifiable height',
  })
  stunting: ChildrenConditionMeasureDto;

  @ApiProperty({
    type: ChildrenConditionMeasureDto,
    description: 'Latest weight-for-age in range below −2 SD, over classifiable children',
  })
  underweight: ChildrenConditionMeasureDto;

  @ApiProperty({
    type: ChildrenConditionMeasureDto,
    description:
      'Latest MUAC-for-age in range below −2 SD, over classifiable children (not wasting)',
  })
  lowMuac: ChildrenConditionMeasureDto;

  @ApiProperty({
    type: ChildrenConditionMeasureDto,
    description:
      'Any of the three WHO indicators below −2 SD, over children with ≥1 classifiable indicator',
  })
  anyMalnutrition: ChildrenConditionMeasureDto;

  @ApiProperty({
    type: ChildrenConditionMeasureDto,
    description: 'Active children with special needs / disability notes, over active children',
  })
  disability: ChildrenConditionMeasureDto;

  @ApiProperty({
    type: ChildrenConditionMeasureDto,
    description: 'Active children with no nutrition screening in range, over active children',
  })
  notScreened: ChildrenConditionMeasureDto;
}

export class ChildrenConditionsResponseDto {
  @ApiProperty({ example: '2026-07-28T00:00:00.000Z' })
  from: string;

  @ApiProperty({ example: '2026-10-26T00:00:00.000Z' })
  to: string;

  @ApiProperty({ enum: CHILDREN_CONDITION_LEVELS })
  level: ChildrenConditionLevel;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({
    example: 10,
    description: 'Below this denominator an area’s affected count and rate are withheld',
  })
  minDenominator: number;

  @ApiProperty({
    type: [ChildrenConditionAreaDto],
    description: 'Every area in scope, ordered by name (areas without children included)',
  })
  items: ChildrenConditionAreaDto[];
}
