import { Prisma, StedAgeBand, StedAssessment } from '@prisma/client';
import { Mapper } from '../../../common/mappers/base.mapper';
import { CreateStedAssessmentDto } from '../dto/create-sted-assessment.dto';
import {
  ApiStedAgeBand,
  StedAssessmentResponseDto,
} from '../dto/sted-response.dto';

export type StedAssessmentEntity = StedAssessment;

export type StedCreateMapped = {
  ageBand: StedAgeBand;
  physicalAssessment: Prisma.InputJsonValue;
  milestoneResults: Prisma.InputJsonValue;
  outcome: Prisma.InputJsonValue;
  followUpIn6Months: boolean;
  followUpDueDate: Date | null;
  notes: string | null;
  consentObtained: boolean;
};

/**
 * Future Referral module may use these signals from STED payloads.
 * Do NOT create Referral records from this module yet.
 *
 * Likely triggers:
 * - outcome.referred === true (or outcome.referralRequested)
 * - physicalAssessment problems / flags indicating medical concerns
 * - milestoneResults with failed / delayed milestones
 */
export type StedReferralSignal = {
  referred: boolean;
  hasPhysicalProblems: boolean;
  hasFailedMilestones: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toDateKey(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function toApiAgeBand(band: StedAgeBand): ApiStedAgeBand {
  return band === StedAgeBand.band_1_3 ? '1_3' : '4_6';
}

export function toDbAgeBand(band: ApiStedAgeBand): StedAgeBand {
  return band === '1_3' ? StedAgeBand.band_1_3 : StedAgeBand.band_4_6;
}

/**
 * Resolve age band from sync payload (API `1_3`/`4_6` or Prisma enum).
 */
export function resolveStedAgeBandFromPayload(
  payload: Record<string, unknown>,
): StedAgeBand {
  const raw = payload.ageBand;
  if (raw === '1_3' || raw === StedAgeBand.band_1_3) {
    return StedAgeBand.band_1_3;
  }
  if (raw === '4_6' || raw === StedAgeBand.band_4_6) {
    return StedAgeBand.band_4_6;
  }
  throw new Error('sted_assessment requires ageBand of 1_3 or 4_6');
}

/**
 * Extract referral-prep signals without creating Referral rows.
 */
export function extractStedReferralSignals(input: {
  physicalAssessment: unknown;
  milestoneResults: unknown;
  outcome: unknown;
}): StedReferralSignal {
  const outcome = asRecord(input.outcome);
  const physical = asRecord(input.physicalAssessment);
  const milestones = asRecord(input.milestoneResults);

  const referred = Boolean(
    outcome.referred === true ||
      outcome.referralRequested === true ||
      outcome.requiresReferral === true,
  );

  const hasPhysicalProblems = Boolean(
    physical.hasProblems === true ||
      physical.problemsDetected === true ||
      (Array.isArray(physical.problems) && physical.problems.length > 0) ||
      (Array.isArray(physical.flags) && physical.flags.length > 0),
  );

  const failed = milestones.failed;
  const delayed = milestones.delayed;
  const hasFailedMilestones = Boolean(
    milestones.hasFailed === true ||
      (Array.isArray(failed) && failed.length > 0) ||
      (Array.isArray(delayed) && delayed.length > 0) ||
      milestones.anyFailed === true,
  );

  return { referred, hasPhysicalProblems, hasFailedMilestones };
}

export class StedMapper
  implements Mapper<StedAssessmentEntity, StedAssessmentResponseDto>
{
  toDto(entity: StedAssessmentEntity): StedAssessmentResponseDto {
    return {
      id: entity.id,
      childId: entity.childId,
      centerId: entity.centerId,
      assessmentDate: toDateKey(entity.assessmentDate)!,
      ageBand: toApiAgeBand(entity.ageBand),
      consentObtained: entity.consentObtained,
      physicalAssessment: asRecord(entity.physicalAssessment),
      milestoneResults: asRecord(entity.milestoneResults),
      outcome: asRecord(entity.outcome),
      followUpIn6Months: entity.followUpIn6Months,
      followUpDueDate: toDateKey(entity.followUpDueDate),
      notes: entity.notes,
      assessedBy: entity.assessedById,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  toCreateData(dto: CreateStedAssessmentDto): StedCreateMapped {
    return {
      ageBand: toDbAgeBand(dto.ageBand),
      physicalAssessment: dto.physicalAssessment as Prisma.InputJsonValue,
      milestoneResults: dto.milestoneResults as Prisma.InputJsonValue,
      outcome: dto.outcome as Prisma.InputJsonValue,
      followUpIn6Months: dto.followUpIn6Months,
      followUpDueDate: dto.followUpDueDate
        ? new Date(`${dto.followUpDueDate.slice(0, 10)}T00:00:00.000Z`)
        : null,
      notes: dto.notes?.trim() || null,
      consentObtained: dto.consentObtained,
    };
  }
}

export const stedMapper = new StedMapper();
