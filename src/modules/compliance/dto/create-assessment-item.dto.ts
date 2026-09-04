import { GapSeverity, GapStatus, ItemResponse } from '../../../common/domain';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAssessmentItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  standardId: string;

  @ApiProperty({ enum: ItemResponse, enumName: 'ItemResponse' })
  @IsEnum(ItemResponse)
  response: ItemResponse;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  score?: number;

  @ApiPropertyOptional({ example: 'Evidence notes' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  evidenceNotes?: string;

  @ApiPropertyOptional({ enum: GapSeverity, enumName: 'GapSeverity' })
  @IsOptional()
  @IsEnum(GapSeverity)
  gapSeverity?: GapSeverity;

  @ApiPropertyOptional({ example: 'Install handwashing station' })
  @IsOptional()
  @IsString()
  gapImprovementAction?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'ISO date string for gap target',
  })
  @IsOptional()
  @IsDateString()
  gapTargetDate?: string;

  @ApiPropertyOptional({ enum: GapStatus, enumName: 'GapStatus' })
  @IsOptional()
  @IsEnum(GapStatus)
  gapStatus?: GapStatus;

  @ApiPropertyOptional({
    example: '2026-08-01T12:00:00.000Z',
    description: 'ISO datetime when gap was resolved',
  })
  @IsOptional()
  @IsDateString()
  gapResolvedAt?: string;
}
