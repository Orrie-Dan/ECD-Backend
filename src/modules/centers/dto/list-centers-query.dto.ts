import { EcdCenterStatus } from '../../../common/domain';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListCentersQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by province — centers in districts under this province',
  })
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by district' })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Filter by sector — centers whose village lies under this administrative unit',
  })
  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Filter by cell — centers whose village lies under this administrative unit (narrower than sector)',
  })
  @IsOptional()
  @IsUUID()
  cellId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by village — centers in this village',
  })
  @IsOptional()
  @IsUUID()
  villageId?: string;

  @ApiPropertyOptional({
    enum: EcdCenterStatus,
    enumName: 'EcdCenterStatus',
  })
  @IsOptional()
  @IsEnum(EcdCenterStatus)
  status?: EcdCenterStatus;

  @ApiPropertyOptional({
    example: 'Kigali',
    description: 'Search by center name or code',
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
}
