/**
 * Cast Prisma TEXT column values to domain enum types.
 * Ingress DTOs validate allowed values; DB/ArcGIS domains enforce at source.
 */
export function asDomainEnum<T extends string>(value: string): T {
  return value as T;
}

export function asDomainEnumNullable<T extends string>(value: string | null | undefined): T | null {
  return value == null ? null : (value as T);
}
