/** Lookback for absence risk and center attendance-rate window. */
export const ATTENDANCE_RISK_DAYS = 7;
/** Absent count threshold within lookback (not necessarily consecutive). */
export const ATTENDANCE_ABSENT_THRESHOLD = 3;
/** Centers below this present-rate (%) over the lookback emit ATTENDANCE_LOW_RATE. */
export const LOW_CENTER_ATTENDANCE_THRESHOLD = 80;
/** Rate below this (%) is high priority; otherwise medium. */
export const HIGH_PRIORITY_LOW_RATE_THRESHOLD = 70;

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Inclusive UTC window of ATTENDANCE_RISK_DAYS ending today. */
export function attendanceLookbackRange(now = new Date()): { from: Date; to: Date } {
  const to = startOfUtcDay(now);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (ATTENDANCE_RISK_DAYS - 1));
  return { from, to };
}
