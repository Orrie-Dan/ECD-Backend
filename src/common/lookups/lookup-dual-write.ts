import {
  AbsentReason,
  AssessmentStatus,
  AssessmentType,
  AttendanceStatus,
  CenterSupportCategory,
  ChildGender,
  ChildStatus,
  ComplianceClassification,
  EcdCenterStatus,
  GapSeverity,
  GapStatus,
  InKindItemType,
  ItemResponse,
  NutritionStatus,
  ParentContributionType,
  ReferralSourceType,
  ReferralStatus,
  StedAgeBand,
  StandardDomain,
  TransferStatus,
} from '@prisma/client';
import { LookupResolverService } from './lookup-resolver.service';

/** Dual-write fragments: enum/string field + matching lookup *_id for GIS Phase 7. */
export class LookupDualWrite {
  constructor(private readonly lookups: LookupResolverService) {}

  ecdCenterStatus(status: EcdCenterStatus) {
    return {
      status,
      statusId: this.lookups.requireEnumId('ecdCenterStatus', status),
    };
  }

  optionalEcdCenterStatus(status: EcdCenterStatus | null | undefined) {
    if (status === undefined) return {};
    if (status == null) return { status: null, statusId: null };
    return this.ecdCenterStatus(status);
  }

  complianceClassificationForCenter(value: ComplianceClassification) {
    return {
      currentComplianceLevel: value,
      currentComplianceLevelId: this.lookups.requireEnumId('complianceClassification', value),
    };
  }

  assessmentOverallClassification(value: ComplianceClassification | null | undefined) {
    if (value === undefined) return {};
    if (value == null) {
      return { overallClassification: null, overallClassificationId: null };
    }
    return {
      overallClassification: value,
      overallClassificationId: this.lookups.requireEnumId('complianceClassification', value),
    };
  }

  childGender(gender: ChildGender) {
    return {
      gender,
      genderId: this.lookups.requireEnumId('childGender', gender),
    };
  }

  childStatus(status: ChildStatus) {
    return {
      status,
      statusId: this.lookups.requireEnumId('childStatus', status),
    };
  }

  attendanceStatus(status: AttendanceStatus) {
    return {
      status,
      statusId: this.lookups.requireEnumId('attendanceStatus', status),
    };
  }

  absentReason(reason: AbsentReason | null) {
    return {
      absentReason: reason,
      absentReasonId: reason ? this.lookups.requireEnumId('absentReason', reason) : null,
    };
  }

  nutritionStatus(status: NutritionStatus) {
    return {
      nutritionStatus: status,
      nutritionStatusId: this.lookups.requireEnumId('nutritionStatus', status),
    };
  }

  stedAgeBand(ageBand: StedAgeBand) {
    return {
      ageBand,
      ageBandId: this.lookups.requireEnumId('stedAgeBand', ageBand),
    };
  }

  referralSourceType(sourceType: ReferralSourceType) {
    return {
      sourceType,
      sourceTypeId: this.lookups.requireEnumId('referralSourceType', sourceType),
    };
  }

  referralStatus(status: ReferralStatus) {
    return {
      status,
      statusId: this.lookups.requireEnumId('referralStatus', status),
    };
  }

  transferStatus(status: TransferStatus) {
    return {
      status,
      statusId: this.lookups.requireEnumId('transferStatus', status),
    };
  }

  assessmentType(assessmentType: AssessmentType) {
    return {
      assessmentType,
      assessmentTypeId: this.lookups.requireEnumId('assessmentType', assessmentType),
    };
  }

  assessmentStatus(status: AssessmentStatus) {
    return {
      status,
      statusId: this.lookups.requireEnumId('assessmentStatus', status),
    };
  }

  itemResponse(response: ItemResponse) {
    return {
      response,
      responseId: this.lookups.requireEnumId('itemResponse', response),
    };
  }

  optionalGapSeverity(severity: GapSeverity | null | undefined) {
    if (severity === undefined) return {};
    if (severity == null) return { gapSeverity: null, gapSeverityId: null };
    return {
      gapSeverity: severity,
      gapSeverityId: this.lookups.requireEnumId('gapSeverity', severity),
    };
  }

  optionalGapStatus(status: GapStatus | null | undefined) {
    if (status === undefined) return {};
    if (status == null) return { gapStatus: null, gapStatusId: null };
    return {
      gapStatus: status,
      gapStatusId: this.lookups.requireEnumId('gapStatus', status),
    };
  }

  standardDomain(domain: StandardDomain) {
    return {
      domain,
      domainId: this.lookups.requireEnumId('standardDomain', domain),
    };
  }

  parentContributionType(contributionType: ParentContributionType) {
    return {
      contributionType,
      contributionTypeId: this.lookups.requireEnumId('parentContributionType', contributionType),
    };
  }

  optionalInKindItemType(itemType: InKindItemType | null | undefined) {
    if (itemType === undefined) return {};
    if (itemType == null) return { itemType: null, itemTypeId: null };
    return {
      itemType,
      itemTypeId: this.lookups.requireEnumId('inKindItemType', itemType),
    };
  }

  centerSupportCategory(supportCategory: CenterSupportCategory) {
    return {
      supportCategory,
      supportCategoryId: this.lookups.requireEnumId('centerSupportCategory', supportCategory),
    };
  }
}
