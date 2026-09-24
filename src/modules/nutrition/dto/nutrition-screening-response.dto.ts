import { NutritionStatus } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
    nullable: true,
    description:
      'Deprecated legacy absolute-MUAC status. Null for new screenings; preserved on historical rows.',
  })
  nutritionStatus: NutritionStatus | null;

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
