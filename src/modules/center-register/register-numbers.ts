import { Prisma } from '@prisma/client';

export function toNumberOrNull(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return Number(value);
}

export function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  return toNumberOrNull(value) ?? 0;
}
