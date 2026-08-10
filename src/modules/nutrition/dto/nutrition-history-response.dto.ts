import { ApiProperty } from '@nestjs/swagger';
import { NutritionScreeningResponseDto } from './nutrition-screening-response.dto';

export class NutritionHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ type: [NutritionScreeningResponseDto] })
  items: NutritionScreeningResponseDto[];

  @ApiProperty({ example: 10 })
  total: number;
}
