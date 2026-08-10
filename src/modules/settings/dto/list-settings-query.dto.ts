import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ListSettingsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter settings by district',
  })
  @IsOptional()
  @IsUUID()
  districtId?: string;
}
