import { LookupResolverService } from './lookup-resolver.service';

/** Minimal LookupResolverService stub for unit tests (no DB). */
export function createMockLookupResolver(): LookupResolverService {
  return {
    requireEnumId: (_cacheKey: string, code: string) => `lookup-${code}`,
    optionalEnumId: (_cacheKey: string, code: string | null | undefined) =>
      code == null ? code : `lookup-${code}`,
    resolveCodedLookupId: async (_db, _table, raw) => {
      if (raw === undefined) return undefined;
      if (raw == null || raw.trim() === '') return null;
      return `coded-${raw.trim().toLowerCase().replace(/\s+/g, '_')}`;
    },
    reload: async () => undefined,
  } as LookupResolverService;
}
