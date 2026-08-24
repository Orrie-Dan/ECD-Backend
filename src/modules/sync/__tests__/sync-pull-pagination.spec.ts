/**
 * Sync pull keyset pagination tests.
 * Run: npx ts-node src/modules/sync/__tests__/sync-pull-pagination.spec.ts
 */
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../auth/interfaces/jwt-payload.interface';
import { SyncService } from '../sync.service';
import { andWhere, buildKeysetWhere, paginateMergedRows } from '../sync-pull.util';
import { SYNC_PULL_DEFAULT_LIMIT } from '../sync.constants';

function assert(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (e) {
      console.error(`FAIL: ${name}`);
      throw e;
    }
  })();
}

function eq(actual: unknown, expected: unknown, label?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ?? 'eq'} expected ${e} got ${a}`);
  }
}

function adminUser(): AuthUser {
  return {
    id: randomUUID(),
    username: 'admin',
    email: null,
    fullName: 'Admin',
    role: UserRole.ncda_admin,
    centerId: null,
    districtId: null,
    status: 'active',
  };
}

type ChildRow = {
  id: string;
  createdAt: Date;
  lastModifiedAt: Date;
  deletedAt: Date | null;
  centerId: string;
  firstName: string;
};

function makeChildren(count: number, sharedTs?: Date): ChildRow[] {
  const base = sharedTs ?? new Date('2026-08-05T12:00:00.000Z');
  const rows: ChildRow[] = [];
  for (let i = 0; i < count; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const ts = sharedTs ? sharedTs : new Date(base.getTime() + i * 1000);
    rows.push({
      id,
      createdAt: ts,
      lastModifiedAt: ts,
      deletedAt: null,
      centerId: 'center-1',
      firstName: `Child-${i}`,
    });
  }
  return rows;
}

function createPullHarness(children: ChildRow[]) {
  const emptyFind = async () => [];

  const prisma = {
    device: { findUnique: async () => null },
    child: {
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where: Record<string, unknown>;
        orderBy: Array<{ lastModifiedAt?: string; id?: string }>;
        take: number;
      }) => {
        let rows = [...children];
        const keyset = extractKeyset(where);
        if (keyset) {
          rows = rows.filter((r) => afterKeyset(r, keyset));
        }
        rows.sort((a, b) => {
          const t = a.lastModifiedAt.getTime() - b.lastModifiedAt.getTime();
          if (t !== 0) return t;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return rows.slice(0, take);
      },
    },
    attendanceRecord: { findMany: emptyFind },
    childNutritionScreening: { findMany: emptyFind },
    childTransfer: { findMany: emptyFind },
    ecdCenter: { findMany: emptyFind },
    complianceAssessment: { findMany: emptyFind },
    complianceAssessmentItem: { findMany: emptyFind },
    washIndicator: { findMany: emptyFind },
    centerFeedingDay: { findMany: emptyFind },
    centerFeedingMonthSummary: { findMany: emptyFind },
    stedAssessment: { findMany: emptyFind },
    referral: { findMany: emptyFind },
  };

  const syncAccess = {
    resolveScope: async () => ({ centerIds: 'all' as const, districtId: null }),
    centerFilter: () => ({}),
    ecdCenterFilter: () => ({}),
  };

  const queue = {
    add: async () => ({ id: 'job' }),
    getJobs: async () => [],
  };

  const service = new SyncService(prisma as never, syncAccess as never, queue as never);

  return { service, prisma };
}

function extractKeyset(where: Record<string, unknown>): { time: Date; id: string | null } | null {
  const flatten = (w: Record<string, unknown>): Record<string, unknown>[] => {
    if (Array.isArray(w.AND)) {
      return (w.AND as Record<string, unknown>[]).flatMap((p) => flatten(p));
    }
    return [w];
  };

  for (const part of flatten(where)) {
    if (part.lastModifiedAt && typeof part.lastModifiedAt === 'object') {
      const lm = part.lastModifiedAt as { gt?: Date };
      if (lm.gt) return { time: lm.gt, id: null };
    }
    if (Array.isArray(part.OR)) {
      const gt = (part.OR as Array<Record<string, unknown>>).find(
        (o) => (o.lastModifiedAt as { gt?: Date })?.gt,
      );
      const eq = (part.OR as Array<Record<string, unknown>>).find((o) => Array.isArray(o.AND));
      if (gt && eq) {
        const ands = eq.AND as Array<Record<string, unknown>>;
        const time = (
          ands.find((a) => a.lastModifiedAt)?.lastModifiedAt as {
            equals: Date;
          }
        ).equals;
        const id = (ands.find((a) => a.id)?.id as { gt: string }).gt;
        return { time, id };
      }
    }
  }
  return null;
}

function afterKeyset(
  row: { lastModifiedAt: Date; id: string },
  keyset: { time: Date; id: string | null },
): boolean {
  if (!keyset.id) {
    return row.lastModifiedAt.getTime() > keyset.time.getTime();
  }
  const t = row.lastModifiedAt.getTime() - keyset.time.getTime();
  if (t > 0) return true;
  if (t < 0) return false;
  return row.id > keyset.id;
}

async function main() {
  await assert('util: buildKeysetWhere legacy timestamp only', () => {
    const t = new Date('2026-08-05T12:00:00.000Z');
    eq(buildKeysetWhere(t, null), { lastModifiedAt: { gt: t } });
  });

  await assert('util: buildKeysetWhere composite keyset', () => {
    const t = new Date('2026-08-05T12:00:00.000Z');
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const where = buildKeysetWhere(t, id);
    eq(where, {
      OR: [
        { lastModifiedAt: { gt: t } },
        {
          AND: [{ lastModifiedAt: { equals: t } }, { id: { gt: id } }],
        },
      ],
    });
  });

  await assert('util: andWhere does not clobber OR', () => {
    const keyset = buildKeysetWhere(new Date('2026-01-01'), 'id-1');
    const scope = {
      OR: [{ fromCenterId: { in: ['c1'] } }, { toCenterId: { in: ['c1'] } }],
    };
    const merged = andWhere(keyset, scope);
    eq(Object.keys(merged), ['AND']);
    eq((merged.AND as unknown[]).length, 2);
  });

  await assert('util: paginateMergedRows same-timestamp ordering', () => {
    const ts = new Date('2026-08-05T12:00:00.000Z');
    const rows = [
      {
        id: 'b',
        createdAt: ts,
        lastModifiedAt: ts,
        deletedAt: null,
        entityType: 'child',
      },
      {
        id: 'a',
        createdAt: ts,
        lastModifiedAt: ts,
        deletedAt: null,
        entityType: 'child',
      },
    ];
    const { page, nextCursor, hasMore } = paginateMergedRows(rows, 1);
    eq(page.length, 1);
    eq(page[0].id, 'a');
    eq(hasMore, true);
    eq(nextCursor, { lastModifiedAt: ts.toISOString(), id: 'a' });
  });

  await assert('scenario 1: 1000 records / limit 100 → 10 pages', async () => {
    const children = makeChildren(1000);
    const { service } = createPullHarness(children);
    const user = adminUser();

    let cursor: Date | undefined;
    let cursorId: string | undefined;
    let pages = 0;
    const seen = new Set<string>();

    for (;;) {
      const result = await service.pull(user, {
        cursor,
        cursorId,
        limit: 100,
      });
      pages += 1;
      const batch = [
        ...result.created.child,
        ...result.updated.child,
        ...result.deleted.child,
      ] as ChildRow[];
      for (const row of batch) {
        if (seen.has(row.id)) {
          throw new Error(`duplicate ${row.id} on page ${pages}`);
        }
        seen.add(row.id);
      }
      eq(batch.length <= 100, true, `page ${pages} size`);
      if (!result.hasMore) break;
      if (!result.nextCursor) {
        throw new Error('hasMore without nextCursor');
      }
      cursor = new Date(result.nextCursor.lastModifiedAt);
      cursorId = result.nextCursor.id;
      if (pages > 20) throw new Error('too many pages');
    }

    eq(pages, 10, 'page count');
    eq(seen.size, 1000, 'total records');
  });

  await assert('scenario 2: same timestamp — both returned exactly once', async () => {
    const ts = new Date('2026-08-05T12:00:00.000Z');
    const children = makeChildren(2, ts);
    // Ensure deterministic ids for ordering
    children[0].id = '00000000-0000-4000-8000-00000000000a';
    children[1].id = '00000000-0000-4000-8000-00000000000b';
    const { service } = createPullHarness(children);
    const user = adminUser();

    const page1 = await service.pull(user, { limit: 1 });
    eq(page1.hasMore, true);
    const first = [...page1.created.child, ...page1.updated.child] as ChildRow[];
    eq(first.length, 1);
    eq(first[0].id, children[0].id);

    const page2 = await service.pull(user, {
      cursor: new Date(page1.nextCursor!.lastModifiedAt),
      cursorId: page1.nextCursor!.id,
      limit: 1,
    });
    const second = [...page2.created.child, ...page2.updated.child] as ChildRow[];
    eq(second.length, 1);
    eq(second[0].id, children[1].id);
    eq(page2.hasMore, false);
    eq(page2.nextCursor, null);

    // Timestamp-only cursor would skip B — prove keyset is required
    const legacy = await service.pull(user, {
      cursor: ts,
      limit: 10,
    });
    const legacyRows = [...legacy.created.child, ...legacy.updated.child] as ChildRow[];
    eq(legacyRows.length, 0, 'legacy gt cursor skips same-timestamp rows');
  });

  await assert('scenario 3: resume after interruption — no dupes/gaps', async () => {
    const children = makeChildren(250);
    const { service } = createPullHarness(children);
    const user = adminUser();

    // Simulate client getting pages 1-2 then failing; resume from page 2 cursor
    const p1 = await service.pull(user, { limit: 50 });
    const p2 = await service.pull(user, {
      cursor: new Date(p1.nextCursor!.lastModifiedAt),
      cursorId: p1.nextCursor!.id,
      limit: 50,
    });
    const resumeCursor = p2.nextCursor!;

    const seen = new Set<string>();
    for (const row of [
      ...p1.created.child,
      ...p1.updated.child,
      ...p2.created.child,
      ...p2.updated.child,
    ] as ChildRow[]) {
      seen.add(row.id);
    }
    eq(seen.size, 100);

    let cursor = new Date(resumeCursor.lastModifiedAt);
    let cursorId = resumeCursor.id;
    for (;;) {
      const page = await service.pull(user, { cursor, cursorId, limit: 50 });
      const batch = [...page.created.child, ...page.updated.child] as ChildRow[];
      for (const row of batch) {
        if (seen.has(row.id)) throw new Error(`duplicate on resume: ${row.id}`);
        seen.add(row.id);
      }
      if (!page.hasMore) break;
      cursor = new Date(page.nextCursor!.lastModifiedAt);
      cursorId = page.nextCursor!.id;
    }

    eq(seen.size, 250, 'all records after resume');
  });

  await assert('default limit applied when omitted', async () => {
    const children = makeChildren(SYNC_PULL_DEFAULT_LIMIT + 50);
    const { service } = createPullHarness(children);
    const result = await service.pull(adminUser(), {});
    eq(result.limit, SYNC_PULL_DEFAULT_LIMIT);
    const count =
      result.created.child.length + result.updated.child.length + result.deleted.child.length;
    eq(count, SYNC_PULL_DEFAULT_LIMIT);
    eq(result.hasMore, true);
  });

  console.log('\nAll sync pull pagination tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
