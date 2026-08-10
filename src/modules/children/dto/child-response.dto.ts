import { ApiProperty } from '@nestjs/swagger';

export type ApiChildGender = 'Umuhungu' | 'Umukobwa';

export class ChildResponseDto {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'Uwimana Jean' })
  fullName: string;

  @ApiProperty({
    enum: ['Umuhungu', 'Umukobwa'],
    enumName: 'ApiChildGender',
    example: 'Umuhungu',
  })
  gender: ApiChildGender;

  @ApiProperty({ type: String, format: 'date-time', example: '2020-05-15T00:00:00.000Z' })
  dateOfBirth: Date;

  @ApiProperty({
    type: String,
    enum: ['active', 'transferred', 'archived'],
    enumName: 'ApiChildStatus',
    example: 'active',
    description: 'Child lifecycle status',
  })
  status: string;

  @ApiProperty({
    example: 'REG-2024-001',
    description: 'Unique registration number (additive on list/detail)',
  })
  registrationNumber: string;

  @ApiProperty({ format: 'uuid' })
  centerId: string;

  @ApiProperty({ nullable: true, example: 'Kigali ECD Center' })
  centerName: string | null;

  @ApiProperty({ format: 'uuid' })
  homeVillageId: string;

  @ApiProperty({ nullable: true, example: 'Kigali' })
  province: string | null;

  @ApiProperty({ nullable: true, example: 'Gasabo' })
  district: string | null;

  @ApiProperty({ nullable: true, example: 'Remera' })
  sector: string | null;

  @ApiProperty({ nullable: true, example: 'Rukiri I' })
  cell: string | null;

  @ApiProperty({ nullable: true, example: 'Amahoro' })
  village: string | null;

  @ApiProperty({ example: 'Mukamana Alice' })
  guardianName: string;

  @ApiProperty({ example: '+250788123456' })
  guardianPhone: string;

  @ApiProperty({
    example: 1,
    description: 'Optimistic-lock version (required for PATCH/DELETE/archive)',
  })
  version: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class ChildDetailResponseDto extends ChildResponseDto {
  @ApiProperty({ example: 'Jean' })
  firstName: string;

  @ApiProperty({ nullable: true, example: 'Pierre' })
  middleName: string | null;

  @ApiProperty({ nullable: true, example: 'Uwimana' })
  lastName: string | null;

  @ApiProperty({ example: 'mother', description: 'Primary guardian relationship' })
  guardianRelation: string;

  @ApiProperty({ nullable: true, example: 'Habimana Paul' })
  guardian2Name: string | null;

  @ApiProperty({ nullable: true, example: '+250788654321' })
  guardian2Phone: string | null;

  @ApiProperty({ nullable: true, example: 'father' })
  guardian2Relation: string | null;

  @ApiProperty({ nullable: true, example: 'Prefers morning sessions' })
  notes: string | null;

  @ApiProperty({ nullable: true, example: 'Hearing impairment' })
  specialNeeds: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2024-01-15',
    description: 'Date the child was registered at the center',
  })
  registeredAt: Date;

  @ApiProperty({ nullable: true, example: 'Family relocated' })
  archiveReason: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  archivedAt: Date | null;
}

export class PaginatedChildrenResponseDto {
  @ApiProperty({ type: () => [ChildResponseDto] })
  items: ChildResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}
