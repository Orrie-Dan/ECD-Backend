import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAttendanceQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by ECD center',
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
    description: 'Inclusive start date (ISO-8601)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2024-06-30',
    description: 'Inclusive end date (ISO-8601)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** @deprecated Prefer startDate */
  @ApiPropertyOptional({
    deprecated: true,
    example: '2024-06-01',
    description: 'Deprecated; prefer startDate',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  /** @deprecated Prefer endDate */
  @ApiPropertyOptional({
    deprecated: true,
    example: '2024-06-30',
    description: 'Deprecated; prefer endDate',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

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

  /** @deprecated Prefer pageSize */
  @ApiPropertyOptional({
    deprecated: true,
    example: 50,
    minimum: 1,
    maximum: 200,
    description: 'Deprecated; prefer pageSize',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
