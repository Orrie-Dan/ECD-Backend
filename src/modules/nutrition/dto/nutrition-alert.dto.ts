import { NutritionStatus } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { WhoIndicator, WhoZone } from '../who/types';

export type NutritionAlertType =
  | 'overdue_screening'
  | 'requires_referral'
  | 'who_growth_concern';

/** @deprecated Alias kept for older clients filtering severe_nutrition */
export type LegacyNutritionAlertType = NutritionAlertType | 'severe_nutrition';

export class NutritionAlertDto {
  @ApiProperty({
    enum: ['overdue_screening', 'requires_referral', 'who_growth_concern', 'severe_nutrition'],
    enumName: 'NutritionAlertType',
    example: 'overdue_screening',
    description:
      'who_growth_concern replaces severe_nutrition. severe_nutrition is accepted as a filter alias for who_growth_concern.',
  })
  type: NutritionAlertType | 'severe_nutrition';

  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ example: 'Jean Uwimana' })
  childFullName: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ type: String, nullable: true })
  centerName: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  screeningId: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  screeningDate: Date | null;

  @ApiPropertyOptional({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
    nullable: true,
    description: 'Deprecated legacy absolute-MUAC status when present on historical rows.',
  })
  nutritionStatus: NutritionStatus | null;

  @ApiPropertyOptional({
    enum: ['weight_for_age', 'height_for_age', 'muac_for_age'],
    nullable: true,
    description: 'WHO indicator that triggered who_growth_concern',
  })
  whoIndicator: WhoIndicator | null;

  @ApiPropertyOptional({
    enum: [
      'below_minus_3',
      'minus_3_to_minus_2',
      'minus_2_to_minus_1',
      'minus_1_to_median',
      'median_to_plus_1',
      'plus_1_to_plus_2',
      'plus_2_to_plus_3',
      'above_plus_3',
    ],
    nullable: true,
  })
  whoZone: WhoZone | null;

  @ApiProperty({ type: Boolean, nullable: true })
  requiresReferral: boolean | null;

  @ApiProperty({ example: 'Child is overdue for nutrition screening' })
  message: string;
}

export class NutritionAlertsResponseDto {
  @ApiProperty({ type: [NutritionAlertDto] })
  items: NutritionAlertDto[];

  @ApiProperty({ example: 5 })
  total: number;
}
