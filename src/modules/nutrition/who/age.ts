/**
 * Age at a historical screening date (completed calendar months).
 * WHO indicators must use age at measurement — never "age today".
 * Keep in sync with ECD frontend src/lib/nutrition/who/age.ts.
 */

function parseDateOnly(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/**
 * Completed months between DOB and `atDate` (both YYYY-MM-DD).
 * Returns null when inputs are invalid or screening is before DOB.
 */
export function getAgeInMonthsAtDate(
  dateOfBirth: string | null | undefined,
  atDate: string | null | undefined,
): number | null {
  const dob = parseDateOnly(dateOfBirth);
  const at = parseDateOnly(atDate);
  if (!dob || !at) return null;
  if (at.getTime() < dob.getTime()) return null;

  let months =
    (at.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (at.getUTCMonth() - dob.getUTCMonth());
  if (at.getUTCDate() < dob.getUTCDate()) {
    months -= 1;
  }
  if (months < 0) return null;
  return months;
}
