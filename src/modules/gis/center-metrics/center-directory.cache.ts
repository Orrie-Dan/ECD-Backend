import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { DistrictQueryScope } from '../../../common/scope/district-query.scope';
import { PrismaService } from '../../../prisma/prisma.service';

/** Map-facing identity + location of a center, with the keys scope filtering needs. */
export type CenterDirectoryRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  districtId: string;
  villageId: string;
  provinceId: string;
};

/**
 * In-memory mirror of {@link ecdCenterWhere} (same precedence), so cached rows
 * are scoped exactly as the Prisma query was.
 */
export function filterCentersForScope(
  rows: CenterDirectoryRow[],
  scope: DistrictQueryScope,
): CenterDirectoryRow[] {
  if (scope.singleCenterId) {
    return rows.filter((r) => r.id === scope.singleCenterId);
  }
  if (scope.centerIds !== 'all') {
    const ids = new Set(scope.centerIds);
    return rows.filter(
      (r) => ids.has(r.id) && (!scope.districtId || r.districtId === scope.districtId),
    );
  }
  if (scope.villageId) return rows.filter((r) => r.villageId === scope.villageId);
  if (scope.districtId) return rows.filter((r) => r.districtId === scope.districtId);
  if (scope.provinceId) return rows.filter((r) => r.provinceId === scope.provinceId);
  return rows;
}

type Fingerprint = {
  key: string;
  active: number;
  maxUpdatedAt: Date | null;
  maxDeletedAt: Date | null;
};

type Snapshot = {
  fingerprint: Fingerprint;
  byId: Map<string, CenterDirectoryRow>;
  /** Name-ordered, like the original per-request query. */
  rows: CenterDirectoryRow[];
};

const DIRECTORY_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  latitude: true,
  longitude: true,
  districtId: true,
  villageId: true,
  district: { select: { provinceId: true } },
} as const;

function byName(a: CenterDirectoryRow, b: CenterDirectoryRow): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Cached national center directory for the GIS map.
 *
 * The directory is ~32k rows; pulling it per request dominated /gis/center-metrics
 * latency (seconds of row transfer vs ~120 ms of SQL). Every read checks a one-row
 * fingerprint (active count, latest `updated_at`, latest `deleted_at`); when it moves,
 * only rows changed since the snapshot are fetched. Every write path — portal edits,
 * compliance, mobile sync, Survey123 sync — stamps `updated_at`, so no explicit
 * invalidation hooks are needed. If the delta does not reconcile with the active
 * count (e.g. a row inserted with a back-dated `updated_at`), it falls back to a full load.
 */
@Injectable()
export class CenterDirectoryCache implements OnApplicationBootstrap {
  private readonly logger = new Logger(CenterDirectoryCache.name);
  private snapshot: Snapshot | null = null;
  /** Concurrent misses share one refresh per fingerprint. */
  private inflight: { key: string; promise: Promise<CenterDirectoryRow[]> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Warm in the background so the first map visit after a deploy is not the slow one. */
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.rows().catch((err: unknown) =>
      this.logger.warn(
        `Center directory warm-up failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  async centersFor(scope: DistrictQueryScope): Promise<CenterDirectoryRow[]> {
    return filterCentersForScope(await this.rows(), scope);
  }

  private async rows(): Promise<CenterDirectoryRow[]> {
    const fingerprint = await this.fingerprint();
    if (this.snapshot?.fingerprint.key === fingerprint.key) return this.snapshot.rows;
    if (this.inflight?.key === fingerprint.key) return this.inflight.promise;

    // The fingerprint is taken before fetching: a write that lands mid-refresh moves
    // the next fingerprint and triggers another refresh, never a stale hit.
    const base = this.snapshot;
    const promise = (base ? this.applyDelta(base, fingerprint) : this.fullLoad(fingerprint)).then(
      (snapshot) => {
        this.snapshot = snapshot;
        return snapshot.rows;
      },
    );
    const entry = { key: fingerprint.key, promise };
    this.inflight = entry;
    try {
      return await promise;
    } finally {
      if (this.inflight === entry) this.inflight = null;
    }
  }

  private async fingerprint(): Promise<Fingerprint> {
    const [active, agg] = await Promise.all([
      this.prisma.ecdCenter.count({ where: { deletedAt: null } }),
      this.prisma.ecdCenter.aggregate({ _max: { updatedAt: true, deletedAt: true } }),
    ]);
    const maxUpdatedAt = agg._max.updatedAt ?? null;
    const maxDeletedAt = agg._max.deletedAt ?? null;
    return {
      key: [active, maxUpdatedAt?.toISOString() ?? '', maxDeletedAt?.toISOString() ?? ''].join('|'),
      active,
      maxUpdatedAt,
      maxDeletedAt,
    };
  }

  private async fullLoad(fingerprint: Fingerprint): Promise<Snapshot> {
    const started = Date.now();
    const centers = await this.prisma.ecdCenter.findMany({
      where: { deletedAt: null },
      select: DIRECTORY_SELECT,
      orderBy: { name: 'asc' },
    });
    const rows = centers.map(({ district, ...center }) => ({
      ...center,
      provinceId: district.provinceId,
    }));
    this.logger.log(
      `Center directory loaded: ${rows.length} centers in ${Date.now() - started} ms`,
    );
    return { fingerprint, byId: new Map(rows.map((r) => [r.id, r])), rows };
  }

  /** Fetch only rows updated or soft-deleted since `base`; full load if it does not reconcile. */
  private async applyDelta(base: Snapshot, fingerprint: Fingerprint): Promise<Snapshot> {
    const since = base.fingerprint;
    if (!since.maxUpdatedAt) return this.fullLoad(fingerprint);

    const changed = await this.prisma.ecdCenter.findMany({
      where: {
        OR: [
          { updatedAt: { gt: since.maxUpdatedAt } },
          { deletedAt: since.maxDeletedAt ? { gt: since.maxDeletedAt } : { not: null } },
        ],
      },
      select: { ...DIRECTORY_SELECT, deletedAt: true },
    });

    const byId = new Map(base.byId);
    for (const { district, deletedAt, ...center } of changed) {
      if (deletedAt) byId.delete(center.id);
      else byId.set(center.id, { ...center, provinceId: district.provinceId });
    }
    if (byId.size !== fingerprint.active) {
      this.logger.warn(
        `Center directory delta did not reconcile (${byId.size} vs ${fingerprint.active}); reloading`,
      );
      return this.fullLoad(fingerprint);
    }
    return { fingerprint, byId, rows: [...byId.values()].sort(byName) };
  }
}
