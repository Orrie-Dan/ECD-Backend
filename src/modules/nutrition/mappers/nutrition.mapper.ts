import {
  ChildNutritionScreening,
  NutritionStatus,
  Prisma,
} from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { GrowthChartResponseDto } from '../dto/growth-chart-response.dto';
import { NutritionScreeningResponseDto } from '../dto/nutrition-screening-response.dto';

export function deriveRequiresReferral(
  nutritionStatus: NutritionStatus,
  clientFlag?: boolean,
): boolean {
  if (
    nutritionStatus === NutritionStatus.moderate ||
    nutritionStatus === NutritionStatus.severe
  ) {
    return true;
  }
  return Boolean(clientFlag);
}

export function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  return Number(value.toString());
}

export class NutritionMapper
  implements Mapper<ChildNutritionScreening, NutritionScreeningResponseDto>
{
  toDto(entity: ChildNutritionScreening): NutritionScreeningResponseDto {
    const weightKg = decimalToNumber(entity.weightKg);
    const muacCm = decimalToNumber(entity.muacCm);

    if (weightKg == null || muacCm == null) {
      throw new Error('Nutrition screening is missing required measurements');
    }

    return {
      id: entity.id,
      childId: entity.childId,
      screeningDate: entity.screeningDate,
      weightKg,
      muacCm,
      heightCm: decimalToNumber(entity.heightCm),
      headCircumferenceCm: decimalToNumber(entity.headCircumferenceCm),
      nutritionStatus: entity.nutritionStatus,
      requiresReferral: entity.requiresReferral,
      mealQuality: entity.mealQuality,
      feedingConcern: entity.feedingConcern,
      dietNotes: entity.dietNotes,
      recordedById: entity.recordedById,
      version: entity.version,
      createdAt: entity.createdAt,
    };
  }

  toGrowthChart(
    childId: string,
    screenings: ChildNutritionScreening[],
  ): GrowthChartResponseDto {
    const chronological = [...screenings].sort(
      (a, b) => a.screeningDate.getTime() - b.screeningDate.getTime(),
    );

    const weight: GrowthChartResponseDto['weight'] = [];
    const muac: GrowthChartResponseDto['muac'] = [];
    const height: GrowthChartResponseDto['height'] = [];
    const headCircumference: GrowthChartResponseDto['headCircumference'] = [];

    for (const row of chronological) {
      const weightKg = decimalToNumber(row.weightKg);
      const muacCm = decimalToNumber(row.muacCm);
      const heightCm = decimalToNumber(row.heightCm);
      const headCm = decimalToNumber(row.headCircumferenceCm);

      if (weightKg != null) {
        weight.push({ date: row.screeningDate, value: weightKg });
      }
      if (muacCm != null) {
        muac.push({ date: row.screeningDate, value: muacCm });
      }
      if (heightCm != null) {
        height.push({ date: row.screeningDate, value: heightCm });
      }
      if (headCm != null) {
        headCircumference.push({ date: row.screeningDate, value: headCm });
      }
    }

    return {
      childId,
      weight,
      muac,
      height,
      headCircumference,
    };
  }
}

export const nutritionMapper = new NutritionMapper();
