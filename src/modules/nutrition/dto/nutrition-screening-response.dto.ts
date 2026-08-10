import { ApiProperty } from '@nestjs/swagger';
import { NutritionStatus } from '@prisma/client';

export class NutritionScreeningResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ type: String, format: 'date-time' })
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

  @ApiProperty({ type: String, nullable: true })
  mealQuality: string | null;

  @ApiProperty({ example: false })
  feedingConcern: boolean;

  @ApiProperty({ type: String, nullable: true })
  dietNotes: string | null;

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
