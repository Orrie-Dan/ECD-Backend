/**
 * Application domain enums for columns stored as TEXT in PostgreSQL.
 * ArcGIS coded-value domains enforce allowed values at the GIS layer;
 * NestJS validates via @IsEnum() and service-level checks.
 *
 * Do not import these from @prisma/client — only the seven PostgreSQL enum
 * types still mapped in schema.prisma remain there.
 */

export enum EcdCenterStatus {
  active = 'active',
  inactive = 'inactive',
}

export enum UserRole {
  caregiver = 'caregiver',
  district_focal_person = 'district_focal_person',
  ncda_admin = 'ncda_admin',
  ecd_director = 'ecd_director',
}

export enum UserAccountStatus {
  active = 'active',
  inactive = 'inactive',
}

export enum ChildGender {
  male = 'male',
  female = 'female',
}

export enum ChildStatus {
  active = 'active',
  transferred = 'transferred',
  archived = 'archived',
}

export enum AttendanceStatus {
  present = 'present',
  absent = 'absent',
}

export enum AbsentReason {
  sick = 'sick',
  family = 'family',
  transport = 'transport',
  weather = 'weather',
  unknown = 'unknown',
  other = 'other',
}

export enum NutritionStatus {
  normal = 'normal',
  at_risk = 'at_risk',
  moderate = 'moderate',
  severe = 'severe',
}

export enum TransferStatus {
  pending = 'pending',
  accepted = 'accepted',
  cancelled = 'cancelled',
}

export enum StedAgeBand {
  band_1_3 = 'band_1_3',
  band_4_6 = 'band_4_6',
}

export enum AssessmentType {
  self_assessment = 'self_assessment',
  supportive_supervision = 'supportive_supervision',
  external_audit = 'external_audit',
}

export enum AssessmentStatus {
  draft = 'draft',
  submitted = 'submitted',
  verified = 'verified',
  rejected = 'rejected',
}

export enum ItemResponse {
  met = 'met',
  partially_met = 'partially_met',
  not_met = 'not_met',
  not_applicable = 'not_applicable',
}

export enum GapSeverity {
  low = 'low',
  medium = 'medium',
  high = 'high',
}

export enum GapStatus {
  open = 'open',
  in_progress = 'in_progress',
  resolved = 'resolved',
}

export enum StandardDomain {
  wash = 'wash',
  safety = 'safety',
  nutrition = 'nutrition',
  learning_environment = 'learning_environment',
}

export enum DeviceStatus {
  active = 'active',
  inactive = 'inactive',
}

export enum SyncSessionStatus {
  started = 'started',
  completed = 'completed',
  failed = 'failed',
}

export enum AdministrativeLevel {
  province = 'province',
  sector = 'sector',
  cell = 'cell',
  village = 'village',
}

export enum ClassroomGrade {
  grade_1 = 'grade_1',
  grade_2 = 'grade_2',
  grade_3 = 'grade_3',
}

export enum ClassroomAssignmentReason {
  initial_enrollment = 'initial_enrollment',
  promotion = 'promotion',
  manual_reassignment = 'manual_reassignment',
}

export enum PersonSex {
  male = 'male',
  female = 'female',
}

export enum EducationLevel {
  none = 'none',
  primary = 'primary',
  secondary = 'secondary',
  vocational = 'vocational',
  diploma = 'diploma',
  bachelor = 'bachelor',
  postgraduate = 'postgraduate',
  other = 'other',
}

export enum ParentContributionType {
  cash = 'cash',
  in_kind = 'in_kind',
}

export enum InKindItemType {
  flour = 'flour',
  potatoes = 'potatoes',
  maize = 'maize',
  milk = 'milk',
  firewood = 'firewood',
  other = 'other',
}

export enum CenterSupportCategory {
  food = 'food',
  equipment = 'equipment',
  other = 'other',
}

/** All domain enum objects for bulk validation or OpenAPI registration. */
export const DOMAIN_ENUMS = {
  EcdCenterStatus,
  UserRole,
  UserAccountStatus,
  ChildGender,
  ChildStatus,
  AttendanceStatus,
  AbsentReason,
  NutritionStatus,
  TransferStatus,
  StedAgeBand,
  AssessmentType,
  AssessmentStatus,
  ItemResponse,
  GapSeverity,
  GapStatus,
  StandardDomain,
  DeviceStatus,
  SyncSessionStatus,
  AdministrativeLevel,
  ClassroomGrade,
  ClassroomAssignmentReason,
  PersonSex,
  EducationLevel,
  ParentContributionType,
  InKindItemType,
  CenterSupportCategory,
} as const;
