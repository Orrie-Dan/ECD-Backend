import { ApiProperty } from '@nestjs/swagger';

export class SettingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ example: 'attendance.cutoff_time' })
  key: string;

  @ApiProperty({ example: '16:00' })
  value: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ format: 'uuid', nullable: true })
  updatedById: string | null;
}
