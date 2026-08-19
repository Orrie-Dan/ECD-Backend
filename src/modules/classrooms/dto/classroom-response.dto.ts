import { ApiProperty } from '@nestjs/swagger';

export class ClassroomResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({
    enum: ['grade_1', 'grade_2', 'grade_3'],
    enumName: 'ClassroomGrade',
  })
  grade: string;

  @ApiProperty({ example: 'Grade 1 / Umwaka wa 1' })
  label: string;

  @ApiProperty({ example: 25 })
  childrenCount: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class PromoteChildResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  classroomId: string;

  @ApiProperty({
    enum: ['grade_1', 'grade_2', 'grade_3'],
    enumName: 'ClassroomGrade',
  })
  classroomGrade: string;
}

export class BulkPromoteResponseDto {
  @ApiProperty({ example: 20 })
  promotedCount: number;

  @ApiProperty({
    type: [String],
    description: 'IDs of children in Grade 3 who were not promoted',
  })
  grade3ChildIds: string[];
}
