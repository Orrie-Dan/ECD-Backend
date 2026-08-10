import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GapSeverity, GapStatus, ItemResponse } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateAssessmentItemDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Required for optimistic locking (CAS)',
  })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ enum: ItemResponse, enumName: 'ItemResponse' })
  @IsOptional()
  @IsEnum(ItemResponse)
  response?: ItemResponse;

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
