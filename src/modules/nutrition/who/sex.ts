import type { WhoSex } from './types';

/**
 * Map ECD gender values to WHO sex tables.
 * Accepts DB/domain (`male`/`female`) and API/UI (`Umuhungu`/`Umukobwa`).
 * Keep in sync with ECD frontend src/lib/nutrition/who/sex.ts.
 */
export function toWhoSex(gender: string | null | undefined): WhoSex | null {
  if (gender == null) return null;
  const raw = String(gender).trim();
  if (raw === 'male' || raw === 'Umuhungu') return 'boys';
  if (raw === 'female' || raw === 'Umukobwa') return 'girls';
  return null;
}
