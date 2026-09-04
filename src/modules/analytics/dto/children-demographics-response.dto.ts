import { ApiProperty } from '@nestjs/swagger';

/** Gender × disability slice for one age band (or overall). */
export class DemographicSliceDto {
  @ApiProperty({ example: 320 })
  boys: number;

  @ApiProperty({ example: 12 })
  boysWithDisability: number;

  @ApiProperty({ example: 340 })
  girls: number;

  @ApiProperty({ example: 15 })
  girlsWithDisability: number;

  @ApiProperty({ example: 27 })
  withDisability: number;

  @ApiProperty({ example: 660 })
  total: number;
}

export class ChildrenAgeBandsDto {
  @ApiProperty({ type: () => DemographicSliceDto })
  age_0_2: DemographicSliceDto;

  @ApiProperty({ type: () => DemographicSliceDto })
  age_3_6: DemographicSliceDto;

  @ApiProperty({ type: () => DemographicSliceDto })
  age_above_6: DemographicSliceDto;
}

export class ChildrenDemographicsSummaryDto {
  @ApiProperty({ example: 1357 })
  total: number;

  @ApiProperty({ example: 663 })
  boys: number;

  @ApiProperty({ example: 694 })
  girls: number;

  @ApiProperty({ example: 40 })
  withDisability: number;

  @ApiProperty({ type: () => ChildrenAgeBandsDto })
  byAgeBand: ChildrenAgeBandsDto;
}

export class CaregiverEducationBreakdownDto {
  @ApiProperty({
    example: 8,
    description:
      'Active caregivers with at least one non-deleted staff training marked certificateReceived=true',
  })
  withTrainingCertificate: number;

  @ApiProperty({
    example: 12,
    description:
      'Active caregivers with educationLevel=diploma (general education, not ECD-specific)',
  })
  diploma: number;

  @ApiProperty({
    example: 5,
    description:
      'Active caregivers with educationLevel=bachelor or postgraduate (proxy for degree)',
  })
  degree: number;
}

export class StaffGenderBreakdownDto {
  @ApiProperty({ example: 40 })
  total: number;

  @ApiProperty({ example: 10 })
  male: number;

  @ApiProperty({ example: 28 })
  female: number;

  @ApiProperty({ example: 2 })
  unknownGender: number;
}

export class CaregiversDemographicsDto extends StaffGenderBreakdownDto {
  @ApiProperty({ type: () => CaregiverEducationBreakdownDto })
  education: CaregiverEducationBreakdownDto;
}

export class ChildrenByDistrictDto {
  @ApiProperty({ format: 'uuid' })
  districtId: string;

  @ApiProperty({ example: 'Gasabo' })
  districtName: string;

  @ApiProperty({ example: '01' })
  districtCode: string;

  @ApiProperty({ example: 120 })
  boys: number;

  @ApiProperty({ example: 130 })
  girls: number;

  @ApiProperty({ example: 250 })
  total: number;
}

export class ChildrenDemographicsResponseDto {
  @ApiProperty({
    example: '2026-09-03T00:00:00.000Z',
    description: 'UTC date used as the age reference (start of today)',
  })
  asOf: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  districtId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  centerId: string | null;

  @ApiProperty({ example: 12 })
  centersInScope: number;

  @ApiProperty({
    type: () => ChildrenDemographicsSummaryDto,
    description:
      'Active (non-deleted) enrolled children only. Disability = non-empty specialNeeds and/or disabilityNotes. ' +
      'Age bands from dateOfBirth vs asOf: 0–2 (<3y), 3–6 (3–6y inclusive), above 6 (≥7y).',
  })
  children: ChildrenDemographicsSummaryDto;

  @ApiProperty({
    type: () => CaregiversDemographicsDto,
    description: 'Active UserAccount rows with role=caregiver in the same center scope',
  })
  caregivers: CaregiversDemographicsDto;

  @ApiProperty({
    type: () => StaffGenderBreakdownDto,
    description:
      'Active UserAccount rows with role=ecd_director in scope (closest available proxy for supporting/leadership staff)',
  })
  supportingStaff: StaffGenderBreakdownDto;

  @ApiProperty({
    example: 11.2,
    nullable: true,
    description: 'children.total / caregivers.total, one decimal; null when caregivers.total is 0',
  })
  childrenPerCaregiver: number | null;

  @ApiProperty({
    type: () => ChildrenByDistrictDto,
    isArray: true,
    description:
      'Active children boys/girls/total per in-scope district (national = all districts; district/center filter = that district only)',
  })
  byDistrict: ChildrenByDistrictDto[];
}
