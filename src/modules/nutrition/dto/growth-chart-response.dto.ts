import { ApiProperty } from '@nestjs/swagger';

export class GrowthChartPointDto {
  @ApiProperty({ type: String, format: 'date-time' })
  date: Date;

  @ApiProperty({ example: 12.5 })
  value: number;
}

export class GrowthChartResponseDto {
  @ApiProperty({ format: 'uuid' })
  childId: string;

  @ApiProperty({ type: [GrowthChartPointDto], description: 'Weight (kg) over time' })
  weight: GrowthChartPointDto[];

  @ApiProperty({ type: [GrowthChartPointDto], description: 'MUAC (cm) over time' })
  muac: GrowthChartPointDto[];

  @ApiProperty({ type: [GrowthChartPointDto], description: 'Height (cm) over time' })
  height: GrowthChartPointDto[];

  @ApiProperty({
    type: [GrowthChartPointDto],
    description: 'Head circumference (cm) over time',
  })
  headCircumference: GrowthChartPointDto[];
}
