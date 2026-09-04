# NOTIF-05 — Notification Deduplication & Reliability

## 1. Problem

Before NOTIF-05, scheduled notifications were re-inserted on every cron evaluation with no logical identity or database constraint:

```text
Day 1 cron
→ "Repeated absences" for child X
→ notification inserted

Day 2 cron
→ same condition still true
→ same notification inserted again

Day 3 cron
→ same condition still true
→ same notification inserted again
```

The same pattern affected all six daily cron producers (STED upcoming, compliance gaps, stale transfers, capacity, attendance absence, attendance low-rate). Event-driven producers (REST/sync) could also duplicate on retries because persistence used bare `createMany` with no dedupe key.

## 2. Root Cause

| Layer | Gap |
|-------|-----|
| **Schema** | `Notification` had no `dedupeKey` and no uniqueness beyond primary key |
| **Persistence** | `NotificationsService.createForMultipleUsers()` always inserted |
| **Cron** | Each daily run called `createForMultipleUsers` unconditionally |
| **Events** | `NotificationEventsService` emitted notifications without logical identity |

There was no equivalent of `(userId, dedupeKey)` enforcement. Application-level `findFirst` alone would not survive concurrent workers.

## 3. Dedupe Model

```text
logical event (type + event + entity + optional period)
        ↓
deterministic dedupeKey string
        ↓
DB unique (user_id, dedupe_key)
        ↓
one inbox row per recipient per logical event
```

Key properties:

- Identity derives from **notification type, event transition, entity, and optional period** — never from title/message text.
- Uniqueness is scoped **per recipient** (`userId`), so different users always receive separate rows.
- `dedupeKey` is **nullable** for legacy rows; PostgreSQL treats `NULL` as distinct in unique indexes, so historical notifications are unaffected.
- Expected collisions are handled as **success** (return existing / skip duplicate), not 500 errors.

## 4. Schema Changes

**Prisma** (`prisma/schema.prisma`):

```prisma
dedupeKey  String?  @map("dedupe_key")

@@unique([userId, dedupeKey])
```

**Migration** (`prisma/migrations/20260902140000_notification_dedupe_key/migration.sql`):

- Adds nullable `dedupe_key TEXT` to `sde.notification`
- Creates unique index `notification_user_id_dedupe_key_key` on `(user_id, dedupe_key)`

**Migration safety:**

- Column is nullable — existing rows keep `dedupe_key = NULL`
- No synthetic keys assigned to historical data
- If pre-existing duplicate rows with identical `(user_id, dedupe_key)` were present, migration would fail explicitly (none expected in greenfield; dedupe keys did not exist before)
- Legacy notifications without keys remain insertable (multiple NULL keys allowed per PostgreSQL semantics)

## 5. Key Strategy

Central builder: `src/modules/notifications/notification-dedupe.ts`

Format: `{type}:{event}:{entityType}:{entityId}[:{period}]`

| Notification type | Event / trigger | Logical identity (dedupe key pattern) |
| ----------------- | --------------- | --------------------------------------- |
| `nutrition_alert` | REST/sync screening created | `nutrition_alert:created:child_nutrition_screening:{screeningId}` |
| `sted_followup` | REST/sync assessment created | `sted_followup:created:sted_assessment:{assessmentId}` |
| `sted_followup` | Cron upcoming (7-day window) | `sted_followup:cron_upcoming:sted_assessment:{assessmentId}` |
| `referral_created` | REST/sync create | `referral_created:created:referral:{referralId}` |
| `referral_updated` | REST/sync status change | `referral_updated:status:referral:{referralId}:{status}` |
| `child_enrolled` | REST/sync enroll | `child_enrolled:created:child:{childId}` |
| `child_archived` | REST/sync archive | `child_archived:archived:child:{childId}` |
| `transfer_request` | REST/sync request | `transfer_request:created:child_transfer:{transferId}` |
| `transfer_request` | Cron stale pending | `transfer_request:cron_stale:child_transfer:{transferId}` |
| `transfer_accepted` | REST/sync accept | `transfer_accepted:accepted:child_transfer:{transferId}` |
| `transfer_cancelled` | REST/sync cancel | `transfer_cancelled:cancelled:child_transfer:{transferId}` |
| `compliance_update` | REST/sync status change | `compliance_update:status:compliance_assessment:{assessmentId}:{status}` |
| `compliance_update` | Cron gap overdue | `compliance_update:cron_gap_overdue:compliance_assessment_item:{itemId}` |
| `capacity_warning` | Cron at capacity | `capacity_warning:cron_at_capacity:ecd_center:{centerId}` |
| `attendance_absence` | Cron absence risk | `attendance_absence:cron:child:{childId}:{windowEndYYYY-MM-DD}` |
| `attendance_low_rate` | Cron low rate | `attendance_low_rate:cron:ecd_center:{centerId}:{windowEndYYYY-MM-DD}` |
| `general` | User provisioned | `general:user_provisioned:user_account:{newUserId}` |

## 6. Cron Behavior

### Before

```text
cron run (day 1) → insert notification
cron run (day 2) → insert duplicate
cron run (day 3) → insert duplicate
```

Every cron producer used unconditional `createForMultipleUsers`.

### After

```text
cron run (day 1) → insert with dedupeKey
cron run (day 2) → DB skipDuplicates / unique conflict → no new row
cron run (day 3) → no new row
```

**Behavior class: A — one notification per unresolved condition** (not daily reminders).

| Cron producer | Dedupe semantics |
|---------------|------------------|
| STED upcoming | One reminder per assessment while in 7-day upcoming window |
| Compliance gap overdue | One per gap item while unresolved |
| Stale transfer | One per pending transfer while stale |
| Capacity at capacity | One per center while continuously at/over capacity |
| Attendance absence | One per child **per 7-day lookback window** (window end date in key) |
| Attendance low rate | One per center **per 7-day lookback window** |

Attendance keys include the lookback window end date so a rolling window produces a new key when the window advances.

## 7. Event Producer Coverage

All NOTIF-01 shared producers in `NotificationEventsService` now pass deterministic `dedupeKey` values:

- Nutrition screening (severe/moderate)
- STED 6-month follow-up on create
- Referral created / status updated
- Child enrolled / archived
- Transfer requested / accepted / cancelled
- Compliance submitted / verified / rejected

Additionally:

- `UsersService` user-provisioning `general` notifications

REST and sync paths share the same keys via `NotificationEventsService` — sync retries with the same entity ID produce the same dedupe key.

## 8. Concurrency

`NotificationsService` enforces dedupe at persistence:

| Method | Strategy |
|--------|----------|
| `create()` | Insert; on Prisma `P2002` unique violation, fetch and return existing (`created: false`) |
| `createForMultipleUsers()` | When `dedupeKey` set, uses `createMany({ skipDuplicates: true })` |
| `notifyAsync()` | Delegates to above; logs duplicate suppression at debug level |

This prevents the race:

```text
worker A checks → none
worker B checks → none
worker A inserts → success
worker B inserts → unique conflict → skipped (not error)
```

Tests in `notifications.service.spec.ts` simulate concurrent `Promise.all` creates against a mock enforcing `(userId, dedupeKey)` uniqueness.

## 9. Recurring Conditions

| Scenario | How re-notification works |
|----------|---------------------------|
| Attendance absence/low-rate | New 7-day window → new `period` in dedupe key → new notification |
| Compliance gap resolved | Cron stops selecting item; new gap item gets new entity ID → new key |
| Stale transfer resolved | Transfer leaves pending; new transfer gets new ID |
| STED follow-up completed | Assessment no longer matches cron query |
| Nutrition screening | Each screening has unique `screeningId` |
| Referral lifecycle | Each status transition uses distinct `period` (status value) |
| Capacity dip then re-rise | **Known limitation** — key is per center (`capacity_warning:cron_at_capacity:ecd_center:{centerId}`); if count drops below capacity then returns to same level, duplicate is suppressed. Documented as deferred gap. |

**Read state does not affect dedupe.** Marking a notification read does not cause cron to regenerate it, and does not clear the dedupe key.

## 10. Tests

| Test file | Coverage | Result |
|-----------|----------|--------|
| `notification-cron.service.spec.ts` | Cron emission; repeated run stable dedupe keys; new window keys | **PASS** |
| `notification-events.service.spec.ts` | Event producers pass dedupeKey | **PASS** |
| `notifications.service.spec.ts` | Dedupe conflict handling; concurrent creates; multi-user skipDuplicates; recipient isolation; lifecycle transitions; window reoccurrence | **PASS** |
| `sync-apply-notifications.spec.ts` | NOTIF-01 sync parity (unchanged behavior) | **PASS** |
| `npm run build` | TypeScript compile | **PASS** |

Run: `npm run test:notifications`

## 11. Deferred Gaps

Explicitly **not** in NOTIF-05:

- Inbox API contract enrichment (priority, child/center names, actionUrl) — NOTIF-03
- Realtime delivery (WebSocket, push, email, SMS)
- Operational alert endpoints (`/alerts/follow-up`) — remain separate
- Capacity reoccurrence after dip-to-same-count (see §9)
- `assessment_due` unused enum value
- Broader `UsersService` silent `.catch(() => {})` cleanup
- Outbox pattern / guaranteed delivery
- Notification preferences / TTL / expiry

---

*Implemented: September 2026. Builds on NOTIF-01 sync producer parity (`docs/notif-01-sync-producer-parity.md`).*
