/**
 * District-risk methodology for NCDA Incamake (Phase 1).
 *
 * STED coverage bands below are ported from the frontend presentation layer
 * (`performance-band.ts`) and applied to the backend-authoritative STED
 * coverage formula (distinct children assessed / active children).
 *
 * Category: presentation rule (B) — not a confirmed national programme policy.
 * Severity from attendance, nutrition, or referrals is intentionally deferred.
 */

export const DISTRICT_RISK_METHODOLOGY_VERSION = 'district-risk-v1';

/** STED coverage percentage thresholds (0–100), aligned with frontend bands. */
export const STED_COVERAGE_PCT_BANDS = {
  normal: 70,
  watch: 50,
  concern: 30,
} as const;

export type DistrictRiskSeverity = 'normal' | 'watch' | 'concern' | 'critical';

export type DistrictRiskPrimaryIssueCode =
  | 'district_inactive'
  | 'sted_coverage_low'
  | 'attendance_low'
  | 'severe_nutrition_elevated'
  | 'referral_backlog'
  | 'insufficient_data'
  | 'none';

export type DistrictRiskDataQuality = 'complete' | 'partial' | 'insufficient';

export function roundRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Backend-authoritative STED coverage (matches MonitoringService.sted summary):
 * distinct children assessed in range / active children in scope × 100.
 */
export function computeStedCoveragePct(
  childrenAssessed: number,
  activeChildren: number,
): number | null {
  return roundRate(childrenAssessed, activeChildren);
}

export function severityFromStedCoverage(
  stedCoveragePct: number | null,
): DistrictRiskSeverity | null {
  if (stedCoveragePct == null || Number.isNaN(stedCoveragePct)) return null;
  if (stedCoveragePct >= STED_COVERAGE_PCT_BANDS.normal) return 'normal';
  if (stedCoveragePct >= STED_COVERAGE_PCT_BANDS.watch) return 'watch';
  if (stedCoveragePct >= STED_COVERAGE_PCT_BANDS.concern) return 'concern';
  return 'critical';
}

const SEVERITY_RANK: Record<DistrictRiskSeverity, number> = {
  critical: 0,
  concern: 1,
  watch: 2,
  normal: 3,
};

export function compareSeverity(a: DistrictRiskSeverity, b: DistrictRiskSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export function interpretDistrictRisk(input: {
  isActive: boolean;
  centersInScope: number;
  activeChildren: number;
  attendanceRecords: number;
  stedCoveragePct: number | null;
  stedAssessmentsCompleted: number;
}): {
  severity: DistrictRiskSeverity;
  primaryIssueCode: DistrictRiskPrimaryIssueCode;
  signalFlags: string[];
  dataQuality: DistrictRiskDataQuality;
  riskScore: null;
} {
  const signalFlags: string[] = [];

  if (!input.isActive) {
    signalFlags.push('inactive_district');
    return {
      severity: 'critical',
      primaryIssueCode: 'district_inactive',
      signalFlags,
      dataQuality: input.centersInScope === 0 ? 'insufficient' : 'partial',
      riskScore: null,
    };
  }

  const stedSeverity = severityFromStedCoverage(input.stedCoveragePct);
  if (stedSeverity === 'critical') signalFlags.push('sted_critical');
  else if (stedSeverity === 'concern') signalFlags.push('sted_concern');
  else if (stedSeverity === 'watch') signalFlags.push('sted_watch');

  if (input.attendanceRecords === 0) signalFlags.push('no_attendance_data');
  else signalFlags.push('attendance_data_available');

  if (
    input.activeChildren > 0 &&
    input.stedCoveragePct == null &&
    input.stedAssessmentsCompleted === 0
  ) {
    signalFlags.push('no_sted_data');
  }

  const dataQuality = resolveDataQuality(input);

  const severity: DistrictRiskSeverity = stedSeverity ?? 'normal';
  let primaryIssueCode: DistrictRiskPrimaryIssueCode = 'none';

  if (stedSeverity === 'critical' || stedSeverity === 'concern') {
    primaryIssueCode = 'sted_coverage_low';
  } else if (dataQuality === 'insufficient') {
    primaryIssueCode = 'insufficient_data';
  }

  return {
    severity,
    primaryIssueCode,
    signalFlags,
    dataQuality,
    riskScore: null,
  };
}

function resolveDataQuality(input: {
  centersInScope: number;
  activeChildren: number;
  attendanceRecords: number;
  stedCoveragePct: number | null;
  stedAssessmentsCompleted: number;
}): DistrictRiskDataQuality {
  if (input.centersInScope === 0) return 'insufficient';

  const missingAttendance = input.attendanceRecords === 0;
  const missingSted =
    input.activeChildren > 0 &&
    input.stedCoveragePct == null &&
    input.stedAssessmentsCompleted === 0;

  if (missingAttendance && missingSted) return 'insufficient';
  if (missingAttendance || missingSted) return 'partial';
  return 'complete';
}
