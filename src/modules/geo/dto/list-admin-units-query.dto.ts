import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdministrativeLevel } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListAdminUnitsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    enum: AdministrativeLevel,
    enumName: 'AdministrativeLevel',
  })
  @IsOptional()
  @IsEnum(AdministrativeLevel)
  level?: AdministrativeLevel;
}
