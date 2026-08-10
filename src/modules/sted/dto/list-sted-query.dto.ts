import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiStedAgeBand } from './sted-response.dto';

const API_AGE_BANDS: ApiStedAgeBand[] = ['1_3', '4_6'];

/**
 * Optional filters for STED listing / history refinement.
 * Primary history route is GET /children/:id/sted-history.
 */
export class ListStedQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  childId?: string;

  @ApiPropertyOptional({
    enum: API_AGE_BANDS,
    enumName: 'ApiStedAgeBand',
  })
  @IsOptional()
  @IsIn(API_AGE_BANDS)
  ageBand?: ApiStedAgeBand;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 50;
}
