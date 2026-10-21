/**
 * NCDA ECD facility code: PPDDSSCCVV/T/YYYY/NN
 * (Guidelines for coding ECD facilities, NCDA 24.9.2024)
 *
 * Codes are issued by the database (survey.issue_ecd_code) so Survey123 and the
 * API share one generator. This module only validates input and maps errors.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import { EcdFacilityType } from '../../common/domain';

export const NCDA_ECD_CODE_PATTERN = /^\d{10}\/[A-E]\/\d{4}\/\d{2}$/;

export const NCDA_TYPE_CODES = ['A', 'B', 'C', 'D', 'E'] as const;
export type NcdaTypeCode = (typeof NCDA_TYPE_CODES)[number];

/** Earliest accepted start year (matches DB check constraint). */
export const MIN_START_YEAR = 1950;

export const NCDA_TYPE_TO_FACILITY_TYPE: Readonly<Record<NcdaTypeCode, EcdFacilityType>> =
  Object.freeze({
    A: EcdFacilityType.daycare,
    B: EcdFacilityType.home_based,
    C: EcdFacilityType.community_based,
    D: EcdFacilityType.ecd_3_5,
    E: EcdFacilityType.ecd_3_5,
  });

export function isNcdaEcdCode(code: string | null | undefined): boolean {
  return code != null && NCDA_ECD_CODE_PATTERN.test(code);
}

export function isValidStartYear(year: number, now = new Date()): boolean {
  return Number.isInteger(year) && year >= MIN_START_YEAR && year <= now.getUTCFullYear();
}

function isFacilityTypeCompatible(letter: NcdaTypeCode, facilityType: string): boolean {
  return NCDA_TYPE_TO_FACILITY_TYPE[letter] === facilityType;
}

/**
 * Resolve the (ncdaTypeCode, facilityType) pair for an update so the pair stays
 * consistent (DB constraint ecd_center_ncda_type_matches_facility_type).
 * - New letter: facilityType is derived; an explicit conflicting facilityType is rejected.
 * - facilityType only: allowed when the center has no letter or the letter still agrees.
 * Returns only the fields that change.
 */
export function resolveTypeUpdate(
  current: { ncdaTypeCode: string | null; facilityType: string | null },
  input: { ncdaTypeCode?: NcdaTypeCode; facilityType?: string | null },
): { ncdaTypeCode?: NcdaTypeCode; facilityType?: string | null } {
  if (input.ncdaTypeCode !== undefined) {
    const derived = NCDA_TYPE_TO_FACILITY_TYPE[input.ncdaTypeCode];
    if (input.facilityType !== undefined && input.facilityType !== derived) {
      throw new BadRequestException(
        `facilityType ${input.facilityType ?? 'null'} does not match ncdaTypeCode ${input.ncdaTypeCode} (${derived})`,
      );
    }
    return { ncdaTypeCode: input.ncdaTypeCode, facilityType: derived };
  }

  if (input.facilityType !== undefined) {
    const letter = current.ncdaTypeCode as NcdaTypeCode | null;
    if (
      letter &&
      (input.facilityType === null || !isFacilityTypeCompatible(letter, input.facilityType))
    ) {
      throw new BadRequestException(
        `Center is coded as type ${letter}; change ncdaTypeCode instead of facilityType`,
      );
    }
    return { facilityType: input.facilityType };
  }

  return {};
}

const DB_ERROR_PATTERN = /ECD_CODE_([A-Z_]+): ([^`\n"]*)/;

const CONFLICT_REASONS = new Set([
  'SEQUENCE_EXHAUSTED',
  'ALREADY_ISSUED',
  'IMMUTABLE',
  'NOT_ISSUED',
]);

/**
 * Translate a database ECD_CODE_* exception into an HTTP exception.
 * Returns null for unrelated errors so callers can rethrow them unchanged.
 */
export function mapEcdCodeDbError(error: unknown): BadRequestException | ConflictException | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = DB_ERROR_PATTERN.exec(message);
  if (!match) return null;
  const [, reason, detail] = match;
  const text = detail.trim();
  return CONFLICT_REASONS.has(reason) ? new ConflictException(text) : new BadRequestException(text);
}
