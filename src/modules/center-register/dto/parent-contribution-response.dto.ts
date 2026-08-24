import { ApiProperty } from '@nestjs/swagger';
import { InKindItemType, ParentContributionType } from '@prisma/client';

export class ParentContributionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty()
  centerName: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  childId: string | null;

  @ApiProperty()
  contributorName: string;

  @ApiProperty({ nullable: true })
  contributorPhone: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  contributionDate: Date;

  @ApiProperty({
    enum: ParentContributionType,
    enumName: 'ParentContributionType',
  })
  contributionType: ParentContributionType;

  @ApiProperty({ nullable: true, example: 5000 })
  amount: number | null;

  @ApiProperty({
    enum: InKindItemType,
    enumName: 'InKindItemType',
    nullable: true,
  })
  itemType: InKindItemType | null;

  @ApiProperty({ nullable: true })
  quantity: number | null;

  @ApiProperty({ nullable: true })
  unit: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

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

export class PaginatedParentContributionsResponseDto {
  @ApiProperty({ type: [ParentContributionResponseDto] })
  items: ParentContributionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}

export class ParentContributionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: '2026-01-01', nullable: true })
  from: string | null;

  @ApiProperty({ example: '2026-03-31', nullable: true })
  to: string | null;

  @ApiProperty({
    description: 'Distinct cash contributors (by contributor name)',
  })
  cashContributorCount: number;

  @ApiProperty({ description: 'Sum of cash amounts' })
  cashAmountTotal: number;

  @ApiProperty({
    description: 'Distinct in-kind contributors (by contributor name)',
  })
  inKindContributorCount: number;

  @ApiProperty()
  cashRecordCount: number;

  @ApiProperty()
  inKindRecordCount: number;
}
