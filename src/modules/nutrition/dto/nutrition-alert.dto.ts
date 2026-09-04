import { NutritionStatus } from '../../../common/domain';
import { ApiProperty } from '@nestjs/swagger';
export type NutritionAlertType = 'overdue_screening' | 'requires_referral' | 'severe_nutrition';

export class NutritionAlertDto {
  @ApiProperty({
    enum: ['overdue_screening', 'requires_referral', 'severe_nutrition'],
    enumName: 'NutritionAlertType',
    example: 'overdue_screening',
  })
  type: NutritionAlertType;

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

  @ApiProperty({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
    nullable: true,
  })
  nutritionStatus: NutritionStatus | null;

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
