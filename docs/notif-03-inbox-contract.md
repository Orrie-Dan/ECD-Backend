# NOTIF-03 — Notification Inbox Contract

## 1. Before

`GET /api/v1/notifications` returned a thin persistence projection. The frontend had to parse `title` / `message` and invent navigation from `entityType` + `entityId` (and that mapping was wrong for nutrition/STED, because `entityId` is a screening/assessment id, not a child id).

```json
{
  "id": "uuid",
  "type": "nutrition_alert",
  "title": "Severe nutrition status",
  "message": "A child has been screened with severe nutrition status.",
  "isRead": false,
  "readAt": null,
  "entityType": "child_nutrition_screening",
  "entityId": "screening-uuid",
  "metadata": null,
  "createdAt": "2026-09-02T12:00:00.000Z"
}
```

| Field | Exists | Source | Useful to frontend? |
| ----- | -----: | ------ | ------------------: |
| `id` | Yes | PK | Yes |
| `type` | Yes | enum | Yes |
| `title` | Yes | producer | Yes |
| `message` | Yes | producer | Partial — no names |
| `priority` | **No** | — | Needed |
| `createdAt` | Yes | DB | Yes |
| `readAt` / `isRead` | Yes | DB | Yes |
| `entityType` / `entityId` | Yes | producer | Partial — raw FK |
| `entity` | **No** | — | Structured ref |
| `context.child/center` | **No** | — | Needed |
| `action` | **No** | — | Needed |
| `metadata` | Yes | producer | Inconsistent |
| `userId` | DB only | not in DTO | Correctly omitted |
| `unreadCount` | List envelope | count query | Yes |

Unread-count, mark-one-read, and mark-all-read already existed. No schema change was required for this phase.

## 2. After

Additive inbox fields. Existing keys are unchanged.

```json
{
  "id": "uuid",
  "type": "nutrition_alert",
  "title": "Severe nutrition status",
  "message": "A child has been screened with severe nutrition status.",
  "priority": "critical",
  "isRead": false,
  "readAt": null,
  "entityType": "child_nutrition_screening",
  "entityId": "screening-uuid",
  "entity": {
    "type": "child_nutrition_screening",
    "id": "screening-uuid"
  },
  "context": {
    "child": { "id": "child-uuid", "name": "Jane Doe" },
    "center": { "id": "center-uuid", "name": "Kigali ECD Center" },
    "district": { "id": "district-uuid", "name": "Gasabo" }
  },
  "action": { "type": "route", "path": "/children/child-uuid" },
  "metadata": null,
  "createdAt": "2026-09-02T12:00:00.000Z"
}
```

Paginated envelope is unchanged: `items`, `total`, `page`, `pageSize`, `totalPages`, `unreadCount`.

## 3. Field Definitions

| Field | Meaning | Nullable |
| ----- | ------- | -------- |
| `id` | Notification id | No |
| `type` | `NotificationType` enum value | No |
| `title` | Short heading | No |
| `message` | Body text | No |
| `priority` | Derived `low` \| `medium` \| `high` \| `critical` | No |
| `isRead` | Read state | No |
| `readAt` | ISO timestamp when marked read | Yes |
| `entityType` | Stored source entity type (backward compatible) | Yes |
| `entityId` | Stored source entity id (backward compatible) | Yes |
| `entity` | Structured `{ type, id }` of the stored source record | Yes |
| `context.child` | Display child `{ id, name }` | Yes |
| `context.center` | Display center `{ id, name }` | Yes |
| `context.district` | Display district `{ id, name }` | Yes |
| `action` | `{ type: "route", path }` SPA target, or `null` | Yes |
| `metadata` | Producer JSON (cron codes, etc.) | Yes |
| `createdAt` | ISO created timestamp | No |

`context` is always an object (possibly empty). Missing related records omit nested keys; they do not fail the request.

## 4. Priority Mapping

Priority is **not persisted**. It is derived in `notification-priority.ts`.

| Notification type | Priority | Notes |
| ----------------- | -------- | ----- |
| `nutrition_alert` | `critical` if screening is `severe`; otherwise `high` | Status loaded in the screening batch |
| `referral_created` | `high` | |
| `referral_updated` | `medium` | |
| `transfer_request` | `high` | Includes stale-transfer cron |
| `transfer_accepted` | `medium` | |
| `transfer_cancelled` | `low` | |
| `sted_followup` | `medium` | Create + cron upcoming |
| `compliance_update` | `high` when entity is a gap item; else `medium` | |
| `capacity_warning` | `medium` | |
| `attendance_absence` | `high` | |
| `attendance_low_rate` | metadata `priority` if `high`/`critical`; else `medium` | Cron already stores this |
| `child_enrolled` | `low` | |
| `child_archived` | `low` | |
| `general` | `low` | |
| `assessment_due` | `medium` | Unused producer |

**Unsupported filter:** `priority` is not a query param. Filtering it in SQL would require a persisted column or an in-memory scan of the full inbox.

Supported list filters remain `type` and `isRead`.

## 5. Context Enrichment

Read-time batching in `notification-inbox.context.ts`:

1. Load the page of `sde.notification` rows (already scoped to `userId`).
2. Group stored `entityId`s by `entityType`.
3. One batched query per needed source type (skipped when the id set is empty):
   - `child_nutrition_screening` → `childId`, `nutritionStatus`
   - `sted_assessment` → `childId`, `centerId`
   - `referral` → `childId`, `centerId`
   - `child_transfer` → `childId`, `fromCenterId`, `toCenterId`
   - `compliance_assessment` → `centerId`
   - `compliance_assessment_item` → parent assessment `centerId`
4. Union resolved child ids (plus direct `entityType=child`) → one `child` query (`id`, names, `centerId`).
5. Union resolved center ids → one `ecd_center` query (`id`, `name`, district `{ id, name }`).

Attendance metadata (`childName`, `centerName`, `childId`) is used only when the DB row is missing.

Deleted/unavailable source records: notification still returns; `context` is partial; `action` may be `null`.

## 6. Action Mapping

SPA paths come from `docs/frontend-notifications-alerts.md`. Role gating follows backend `@Roles` so caregivers are not sent director-only transfer/user URLs.

| Notification type | Role | Action |
| ----------------- | ---- | ------ |
| `nutrition_alert` | caregiver, ecd_director, district_focal_person, ncda_admin | `/children/{childId}` |
| `sted_followup` | same | `/children/{childId}` |
| `referral_created` / `referral_updated` | same | `/referrals/{referralId}` |
| `transfer_*` | `ecd_director` | `/transfers/{transferId}` |
| `transfer_*` | caregiver / district / ncda | `/children/{childId}` if known, else `null` |
| `child_enrolled` / `child_archived` / `attendance_absence` | all inbox roles | `/children/{childId}` |
| `compliance_update` | all inbox roles | `/compliance/{assessmentId}` (item rows resolve the parent assessment) |
| `capacity_warning` / `attendance_low_rate` | all inbox roles | `/centers/{centerId}` |
| `general` (`user_account`) | ecd_director, district_focal_person, ncda_admin | `/users/{userId}` |
| `general` (`user_account`) | caregiver | `null` |
| unknown / missing entity | any | `null` |

Nutrition/STED **never** use the screening/assessment id as a child route.

## 7. Read APIs

Unchanged endpoints, enriched list/read payloads:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/notifications` | Paginated inbox + `unreadCount` |
| `GET` | `/api/v1/notifications/unread-count` | `{ "unreadCount": n }` |
| `POST` | `/api/v1/notifications/:id/read` | Mark one owned notification read |
| `POST` | `/api/v1/notifications/read-all` | Mark all owned unread notifications read → `{ "markedCount": n }` |

`POST` is kept (not switched to PATCH) for existing frontend clients documented in `docs/frontend-notifications-alerts.md`.

`GET /unread-count` keeps `unreadCount` rather than renaming to `count`.

## 8. Pagination

Existing ECD list contract:

| Param | Default | Max |
| ----- | ------- | --- |
| `page` | 1 | — |
| `pageSize` | 20 | 100 |

Ordering: `createdAt DESC`, `id DESC`.

Response: `items`, `total`, `page`, `pageSize`, `totalPages`, `unreadCount`.

No cursor pagination.

## 9. Performance

A 50-item page does **not** issue 50 child/center queries.

Typical cost:

```text
notification page + 2 counts (existing transaction)
+ up to 6 entity-type batches (parallel, skipped if empty)
+ 1 child batch
+ 1 center(+district) batch
```

That is O(1) queries relative to page size, not O(n).

Indexes used: `(user_id, created_at)` for list, `(user_id, is_read)` for unread count. No new index.

## 10. Security

- List / unread-count / mark-all: `where: { userId: authenticatedUser.id }` only. No client `userId`.
- Mark-one: `findFirst({ id, userId })` then update. Other-user ids return 404 `Notification not found`.
- JWT `@Roles(caregiver, ecd_director, district_focal_person, ncda_admin)`.
- Action paths hide transfer-detail and user-admin routes from roles that cannot call those APIs.

## 11. Tests

| Test file | Coverage | Result |
|-----------|----------|--------|
| `notification-inbox.contract.spec.ts` | Priority, role-aware actions, own-inbox list, newest-first, nutrition/referral/transfer/compliance enrichment, missing relations, unread count, mark read, IDOR, mark-all, pagination | **PASS** |
| `notification-cron.service.spec.ts` | NOTIF-05 cron idempotency | **PASS** |
| `notification-events.service.spec.ts` | NOTIF-01 producers | **PASS** |
| `notifications.service.spec.ts` | NOTIF-05 dedupe / concurrency | **PASS** |
| `sync-apply-notifications.spec.ts` | NOTIF-01 sync parity | **PASS** |
| `npm run build` | TypeScript compile | **PASS** |

Run: `npm run test:notifications`

## 12. Deferred

- WebSocket realtime delivery
- Push notifications
- Email / SMS
- `/alerts/follow-up` unification with inbox
- Outbox / guaranteed delivery
- Capacity re-rise edge case (NOTIF-05)
- Persisted priority column / SQL priority filter
- `assessment_due` producer
- Frontend route implementation (backend only emits documented SPA paths)

---

*Implemented: September 2026. Does not change notification production or deduplication (NOTIF-01 / NOTIF-05).*
