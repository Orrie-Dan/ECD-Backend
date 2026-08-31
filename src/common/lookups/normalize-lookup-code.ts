/** Normalize free-text coded fields to lookup.code (matches Phase 1c seed SQL). */
export function normalizeLookupCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}
