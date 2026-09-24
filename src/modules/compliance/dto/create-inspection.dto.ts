import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateInspectionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  centerId: string;

  @ApiProperty({ example: 'daycare', description: 'Facility checklist id (daycare | ecd_3_5)' })
  @IsString()
  @IsNotEmpty()
  facilityTypeId: string;

  @ApiProperty({ example: '2024.2-weighted' })
  @IsString()
  @IsNotEmpty()
  standardsVersion: string;

  @ApiProperty({
    example: '2026-09-23',
    description: 'Assessment date (ISO date string)',
  })
  @IsDateString()
  assessmentDate: string;
}
