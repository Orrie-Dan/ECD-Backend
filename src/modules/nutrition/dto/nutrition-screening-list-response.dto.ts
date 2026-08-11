import { ApiProperty } from '@nestjs/swagger';
import { ChildGender, NutritionStatus } from '@prisma/client';

/**
 * Screening list row for District operational reads.
 * Extends core screening measurements with child/center identity
 * (same enrichment pattern as nutrition alerts) so the UI avoids N+1.
 */
export class NutritionScreeningListItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ example: 'Jean Uwimana' })
  childFullName: string;

  @ApiProperty({ type: String, format: 'date' })
  childDateOfBirth: Date;

  @ApiProperty({
    enum: ChildGender,
    enumName: 'ChildGender',
  })
  childGender: ChildGender;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ example: 'ECD Center A' })
  centerName: string;

  @ApiProperty({ type: String, format: 'date' })
  screeningDate: Date;

  @ApiProperty({ example: 12.5 })
  weightKg: number;

  @ApiProperty({ example: 14.2 })
  muacCm: number;

  @ApiProperty({ type: Number, nullable: true, example: 85.0 })
  heightCm: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 48.0 })
  headCircumferenceCm: number | null;

  @ApiProperty({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
    example: NutritionStatus.normal,
  })
  nutritionStatus: NutritionStatus;

  @ApiProperty({ example: false })
  requiresReferral: boolean;

  @ApiProperty({ format: 'uuid' })
  recordedById: string;

  @ApiProperty({
    description: 'Optimistic-lock version',
    example: 1,
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class PaginatedNutritionScreeningsResponseDto {
  @ApiProperty({ type: [NutritionScreeningListItemDto] })
  items: NutritionScreeningListItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 50 })
  pageSize: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
