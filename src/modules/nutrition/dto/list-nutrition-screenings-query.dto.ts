import { NutritionStatus } from '../../../common/domain';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
/**
 * Query for GET /nutrition/screenings — paginated operational screening list.
 * Date bounds are inclusive UTC date-only on `screeningDate` (no default range).
 */
export class ListNutritionScreeningsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by ECD center (via child.centerId)',
  })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by child',
  })
  @IsOptional()
  @IsUUID()
  childId?: string;

  @ApiPropertyOptional({
    example: '2024-06-01',
    description: 'Inclusive start date on screeningDate (YYYY-MM-DD, UTC date-only)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2024-06-30',
    description: 'Inclusive end date on screeningDate (YYYY-MM-DD, UTC date-only)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: NutritionStatus,
    enumName: 'NutritionStatus',
    description: 'Filter by nutrition status',
  })
  @IsOptional()
  @IsEnum(NutritionStatus)
  nutritionStatus?: NutritionStatus;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
