import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListChildrenQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by ECD center',
  })
  @IsOptional()
  @IsUUID()
  centerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Filter by district (via center.districtId). NCDA may use nationally; ' +
      'district focal persons may only pass their own district.',
  })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({
    enum: ['active', 'transferred', 'archived'],
    enumName: 'ApiChildStatus',
    example: 'active',
    description: 'Filter by child status',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: 'Uwimana',
    description: 'Search by name or registration number',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  /** @deprecated Prefer pageSize */
  @ApiPropertyOptional({
    deprecated: true,
    example: 20,
    minimum: 1,
    maximum: 100,
    description: 'Deprecated; prefer pageSize',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Originating device UUID for offline sync',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
