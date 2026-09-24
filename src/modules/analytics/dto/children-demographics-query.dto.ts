import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ChildrenDemographicsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional province scope — all centers in districts under this province',
  })
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional sector scope — centers whose village lies under this administrative unit',
  })
  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional cell scope — centers whose village lies under this administrative unit',
  })
  @IsOptional()
  @IsUUID()
  cellId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional village scope — centers in this village',
  })
  @IsOptional()
  @IsUUID()
  villageId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  centerId?: string;
}
