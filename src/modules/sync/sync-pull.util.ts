import { Prisma } from '@prisma/client';
import { SyncPullCursor } from './sync.constants';

export type SyncableRow = {
  id: string;
  createdAt: Date;
  lastModifiedAt: Date;
  deletedAt: Date | null;
};

export type TaggedSyncRow = SyncableRow & {
  entityType: string;
};

/**
 * Keyset filter: (lastModifiedAt > t) OR (lastModifiedAt = t AND id > id).
 * When only a legacy timestamp cursor is provided (no id), uses strict
 * `lastModifiedAt > t` to preserve prior client behavior.
 */
export function buildKeysetWhere(
  cursorTime: Date | null,
  cursorId: string | null,
): Prisma.ChildWhereInput {
  if (!cursorTime) {
    return {};
  }

  if (!cursorId) {
    return { lastModifiedAt: { gt: cursorTime } };
  }

  return {
    OR: [
      { lastModifiedAt: { gt: cursorTime } },
      {
        AND: [
          { lastModifiedAt: { equals: cursorTime } },
          { id: { gt: cursorId } },
        ],
      },
    ],
  };
}

export const KEYSET_ORDER_BY = [
  { lastModifiedAt: 'asc' as const },
  { id: 'asc' as const },
];

/**
 * Merge per-entity pages (each already ordered by lastModifiedAt, id),
 * take up to `limit` rows globally, and compute nextCursor / hasMore.
 */
export function paginateMergedRows<T extends SyncableRow>(
  tagged: Array<T & { entityType: string }>,
  limit: number,
): {
  page: Array<T & { entityType: string }>;
  nextCursor: SyncPullCursor | null;
  hasMore: boolean;
} {
  const sorted = [...tagged].sort((a, b) => {
    const t = a.lastModifiedAt.getTime() - b.lastModifiedAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const hasMore = sorted.length > limit;
  const page = sorted.slice(0, limit);
  const last = page[page.length - 1];

  return {
    page,
    hasMore,
    nextCursor: last
      ? {
          lastModifiedAt: last.lastModifiedAt.toISOString(),
          id: last.id,
        }
      : null,
  };
}

export function bucketRows<T extends SyncableRow>(
  rows: T[],
  cursorTime: Date,
): { created: T[]; updated: T[]; deleted: T[] } {
  const created: T[] = [];
  const updated: T[] = [];
  const deleted: T[] = [];

  for (const row of rows) {
    if (row.deletedAt) {
      deleted.push(row);
    } else if (row.createdAt > cursorTime) {
      created.push(row);
    } else {
      updated.push(row);
    }
  }

  return { created, updated, deleted };
}

/** Combine Prisma where fragments without clobbering top-level `OR`. */
export function andWhere(
  ...parts: Array<Record<string, unknown> | object | undefined | null>
): Record<string, unknown> {
  const filtered = parts.filter(
    (p): p is Record<string, unknown> =>
      !!p && typeof p === 'object' && Object.keys(p).length > 0,
  );
  if (filtered.length === 0) return {};
  if (filtered.length === 1) return filtered[0];
  return { AND: filtered };
}
