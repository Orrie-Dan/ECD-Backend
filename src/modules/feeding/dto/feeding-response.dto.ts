import { ApiProperty } from '@nestjs/swagger';

export class FeedingDayResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  recordedDate: Date;

  @ApiProperty({ example: true })
  milkServed: boolean;

  @ApiProperty({ example: true })
  porridgeServed: boolean;

  @ApiProperty({ example: true })
  balancedMealServed: boolean;

  @ApiProperty({ example: true })
  cerealsOrTubers: boolean;

  @ApiProperty({ example: false })
  legumes: boolean;

  @ApiProperty({ example: true })
  dairy: boolean;

  @ApiProperty({ example: false })
  animalProducts: boolean;

  @ApiProperty({ example: true })
  fruitsVegetables: boolean;

  @ApiProperty({ example: false })
  addedFat: boolean;

  @ApiProperty({ format: 'uuid' })
  recordedBy: string;

  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt: Date;

  @ApiProperty({
    description: 'Optimistic-lock version; send back on update',
    example: 1,
  })
  version: number;

  @ApiProperty({
    type: [String],
    description: 'Non-blocking validation warnings from the upsert',
    example: [],
  })
  warnings: string[];
}

export class FeedingMonthSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: '2026-08' })
  yearMonth: string;

  @ApiProperty({ example: 120.5 })
  milkLiters: number;

  @ApiProperty({ example: 50.0 })
  flourKg: number;

  @ApiProperty({ example: 'Local market' })
  foodSource: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  recordedBy: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt: Date;

  @ApiProperty({
    description: 'Optimistic-lock version; send back on update',
    example: 1,
  })
  version: number;
}

export class PaginatedFeedingDaysResponseDto {
  @ApiProperty({ type: () => [FeedingDayResponseDto] })
  items: FeedingDayResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export class PaginatedFeedingMonthSummariesResponseDto {
  @ApiProperty({ type: () => [FeedingMonthSummaryResponseDto] })
  items: FeedingMonthSummaryResponseDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
