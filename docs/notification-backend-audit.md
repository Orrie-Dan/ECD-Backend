# Notification Backend Audit

## 1. Executive Summary

**Verdict: NOTIFICATIONS PARTIALLY IMPLEMENTED**

The ECD backend has a **real, persisted notification inbox** (`Notification` model, `GET /api/v1/notifications`, read/unread APIs) alongside **separate operational alert endpoints** that compute follow-up work from domain state (`GET /api/v1/alerts/follow-up`, `GET /api/v1/nutrition/alerts`). The inbox is wired for REST domain mutations and a daily cron job, but it is **not a complete or reliable notification system** for an offline-first platform:

1. **Sync apply bypasses all notification producers** — the dominant field path writes records directly via `SyncApplyService` with zero calls to `NotificationsService`.
2. **Two parallel UX mechanisms** (persisted inbox vs computed alerts) cover overlapping domains with different shapes, scoping, and freshness semantics.
3. **Daily cron creates duplicate notifications** with no idempotency keys or unique constraints.
4. **Notification side effects are fire-and-forget** (non-transactional, errors swallowed), so domain records can exist without corresponding notifications.
5. **No external delivery** (push, email, SMS, WebSocket) — in-app polling only.

The system is not “missing entirely,” but it is **architecturally split and operationally unreliable** for offline users and time-based alerts.

---

## 2. Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TRIGGERS                                                                     │
├──────────────────────────────┬──────────────────────────────────────────────┤
│ REST mutations               │ Time-based (cron @ 06:00 UTC daily)          │
│ (Nutrition, Referrals, STED, │ (STED upcoming, compliance gaps, transfers,  │
│  Children, Transfers,        │  capacity, attendance absence/low-rate)      │
│  Compliance, Users)          │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│ SYNC mutations (SyncApplyService) → NO notification hook                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PRODUCER: NotificationsService.notifyAsync() / createForMultipleUsers()    │
│  • Async, non-blocking                                                       │
│  • Recipient lookup: findUserIdsByRoleAndCenter / findUserIdsByRoleAndDistrict│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PERSISTENCE: sde.notification (Prisma Notification model)                    │
│  • Per-user rows (userId FK → user_account)                                  │
│  • isRead / readAt                                                           │
│  • entityType + entityId + optional metadata JSON                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ API: GET /notifications, GET /notifications/unread-count                     │
│      POST /notifications/:id/read, POST /notifications/read-all            │
│  • Scoped strictly to JWT user.id                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLIENT: Poll inbox (no realtime channel)                                     │
└─────────────────────────────────────────────────────────────────────────────┘

PARALLEL PATH (not persisted notifications):

┌─────────────────────────────────────────────────────────────────────────────┐
│ QUERY-TIME OPERATIONAL ALERTS                                                │
│  GET /alerts/follow-up  → AlertsService (8 categories, computed on read)    │
│  GET /nutrition/alerts  → NutritionService.getAlerts (computed on read)     │
│  Monitoring dashboards  → MonitoringService (aggregates, no inbox rows)     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Notification Data Model

### `Notification` (`sde.notification`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID PK | `@default(uuid())` |
| `userId` | UUID FK | Required → `user_account.id`, ON DELETE RESTRICT |
| `type` | `NotificationType` enum (public schema) | See enum below |
| `title` | String | Required |
| `message` | Text | Required |
| `isRead` | Boolean | Default `false` |
| `readAt` | DateTime? | Set on mark-as-read |
| `entityType` | String? | e.g. `referral`, `child_nutrition_screening` |
| `entityId` | String? | UUID of related entity |
| `metadata` | JSON? | Cron adds `cronBatchDate`; attendance adds extra fields |
| `createdAt` | DateTime | Default now |

**Indexes:** `(userId, isRead)`, `(userId, createdAt)`, `(type)`

**Missing fields (vs ideal inbox UX):** `priority`, `centerId`, `childId`, `centerName`, `childName`, `actionUrl`, `dedupeKey`, `expiresAt`, `acknowledgedAt`

**No uniqueness constraint** on `(userId, type, entityId)` or dedupe key → duplicates allowed.

### `NotificationType` enum

```
transfer_request, transfer_accepted, transfer_cancelled,
child_enrolled, child_archived, assessment_due,
referral_created, referral_updated, nutrition_alert,
sted_followup, compliance_update, capacity_warning,
attendance_absence, attendance_low_rate, general
```

**Unused in code:** `assessment_due` — defined in schema/DTOs but never emitted by any producer.

### No other notification-related models

There are **no** `NotificationRecipient`, `NotificationPreference`, `FollowUpAlert`, or `UserNotification` tables. Follow-up alerts are **not persisted** — they are DTOs assembled at query time.

### Schema / migration note

Original migration `20260819130938_add_notifications` creates unqualified `"notification"` table. Current `schema.prisma` declares `@@schema("sde")`. In EGDB deployments, table location must match Prisma expectations (`sde.notification`). Local/dev DBs created before multi-schema patching may differ — verify with `migrate status` and `\dt sde.notification`.

---

## 4. Notification Producers

| Trigger | Code path | Recipient | Notification generated? | Status |
|---------|-----------|-----------|-------------------------|--------|
| Severe/moderate nutrition screening (REST) | `NutritionService.createScreening()` | `ecd_director` @ center + `district_focal_person` @ district | Yes (`nutrition_alert`) | REST only; **sync bypasses** |
| `at_risk` nutrition / `requiresReferral` flag | — | — | **No** persisted notification | Only in `/alerts/follow-up` and `/nutrition/alerts` |
| Overdue nutrition screening (30+ days) | — | — | **No** persisted notification | Computed in alerts only |
| Referral created (REST) | `ReferralsService.create()` | `ecd_director` @ center | Yes (`referral_created`) | REST only |
| Referral status updated (REST) | `ReferralsService.updateStatus()` | `ecd_director` + `caregiver` @ center | Yes (`referral_updated`) | REST only; sync update bypasses |
| STED with 6-month follow-up (REST) | `StedService.create()` | `ecd_director` + `caregiver` @ center | Yes (`sted_followup`) | REST only |
| Child enrolled (REST) | `ChildrenService.create()` | `ecd_director` @ center | Yes (`child_enrolled`) | REST only |
| Child archived (REST) | `ChildrenService.archive()` | `caregiver` @ center | Yes (`child_archived`) | REST only |
| Child reactivated | `ChildrenService.reactivate()` | — | **No** | Gap |
| Transfer requested (REST) | `TransfersService.create()` | `ecd_director` @ **to** center | Yes (`transfer_request`) | REST only |
| Transfer accepted (REST) | `TransfersService.accept()` | `ecd_director` + `caregiver` @ **from** center | Yes (`transfer_accepted`) | REST only |
| Transfer cancelled (REST) | `TransfersService.cancel()` | `ecd_director` @ **to** center | Yes (`transfer_cancelled`) | REST only |
| Compliance submitted (REST) | `ComplianceService.updateAssessment()` | `district_focal_person` @ district | Yes (`compliance_update`) | REST only |
| Compliance verified/rejected (REST) | same | `ecd_director` @ center | Yes (`compliance_update`) | REST only |
| New user provisioned | `UsersService.create()` | Other `ecd_director`s @ center | Yes (`general`) | REST only |
| STED follow-up due within 7 days | `NotificationCronService.notifyStedFollowUps()` | `ecd_director` + `caregiver` @ center | Yes (`sted_followup`) | Daily; **duplicates** |
| Compliance gap overdue | `NotificationCronService.notifyComplianceGaps()` | `ecd_director` @ center | Yes (`compliance_update`) | Daily; **duplicates** |
| Stale pending transfer (7+ days) | `NotificationCronService.notifyStaleTransfers()` | `ecd_director` @ **to** center | Yes (`transfer_request`) | Daily; **duplicates** |
| Center at capacity | `NotificationCronService.notifyCapacity()` | `ecd_director` @ center | Yes (`capacity_warning`) | Daily; **duplicates** |
| Repeated child absences | `NotificationCronService.notifyAttendanceAbsence()` | `ecd_director` + `caregiver` @ center | Yes (`attendance_absence`) | Daily; **duplicates** |
| Low center attendance rate | `NotificationCronService.notifyAttendanceLowRate()` | Center staff + `district_focal_person` | Yes (`attendance_low_rate`) | Daily; **duplicates** |
| Attendance record created | — | — | **No** | Alerts/cron only |
| WASH indicator issues | — | — | **No** | Not implemented |
| Feeding diversity gaps | — | — | **No** | Computed in `/alerts/follow-up` only |
| Sync failure / session error | — | — | **No** | Not implemented |
| NCDA escalation | — | — | **No** persisted notifications | NCDA uses national-scope alert queries |

### Producer implementation patterns

| Pattern | Where | Risk |
|---------|-------|------|
| `notifyAsync()` fire-and-forget | All REST producers | Failure after HTTP 200; no retry |
| `.catch(() => {})` on recipient lookup | Nutrition, Referrals, STED, Children, Compliance, Users, Transfers | Silent loss if lookup fails |
| Outside `$transaction` | All REST producers | Record committed even if notification fails |
| No idempotency | Cron + REST | Duplicate rows on retry/cron |

---

## 5. Notification Consumers / APIs

### Persisted notification inbox

| Endpoint | Purpose | Scope | Status |
|----------|---------|-------|--------|
| `GET /api/v1/notifications` | Paginated inbox, optional `type` + `isRead` filters; includes `unreadCount` | `userId = JWT sub` | **Works** (read API) |
| `GET /api/v1/notifications/unread-count` | Badge count | Same user | **Works** |
| `POST /api/v1/notifications/:id/read` | Mark one read | Owner only (`findFirst` where id + userId) | **Works** |
| `POST /api/v1/notifications/read-all` | Mark all unread read | Owner only | **Works** (NestJS prioritizes static `read-all` over `:id`) |

**Controller:** `NotificationsController`  
**Service:** `NotificationsService`  
**Auth:** JWT + `@Roles(caregiver, ecd_director, district_focal_person, ncda_admin)`  
**Pagination:** `page`, `pageSize` (max 100); sorted `createdAt DESC`  
**No admin create endpoint** — `create()` is internal-only.

**Response gaps for frontend bell UI:**

- No `priority` (cron embeds priority in `metadata` for attendance only)
- No denormalized `centerName` / `childName` (generic messages like "A child has been screened…")
- No `actionUrl`
- `metadata` shape inconsistent across producers

### Operational alert endpoints (NOT the notification inbox)

| Endpoint | Purpose | Scope | Status |
|----------|---------|-------|--------|
| `GET /api/v1/alerts/follow-up` | Multi-domain computed follow-up queue | Role-scoped centers/districts | **Works** (query-time) |
| `GET /api/v1/nutrition/alerts` | Nutrition-specific computed alerts | SyncAccess scope | **Works** (query-time) |

`/alerts/follow-up` is **not** a notification system — it dynamically queries children, screenings, referrals, attendance, STED, transfers, compliance, capacity and returns ephemeral DTOs with synthetic IDs like `nutrition-severe-{screeningId}`. No DB writes, no read state, no per-user delivery.

---

## 6. Alerts vs Notifications

| Concept | Implementation | Persisted? | Per-user? | Read state? |
|---------|----------------|------------|-----------|-------------|
| **Operational alert** | `AlertsService`, `NutritionService.getAlerts`, `MonitoringService` | No | No (scope by role/center/district at query time) | No |
| **Notification (inbox)** | `Notification` table + `/notifications` | Yes | Yes (`userId`) | Yes (`isRead`, `readAt`) |
| **Domain event** | Audit log entries | Yes (audit) | No | N/A |

**Conflation problem:** The same business conditions appear in **both** systems with different contracts:

| Condition | Follow-up alert | Persisted notification |
|-----------|-----------------|------------------------|
| Severe nutrition | Yes (`NUTRITION_SEVERE`) | REST create only (`nutrition_alert`) |
| STED follow-up overdue | Yes (`STED_FOLLOWUP_OVERDUE`) | Cron upcoming only, not overdue |
| Attendance absence risk | Yes (`ATTENDANCE_ABSENCE_RISK`) | Cron daily (`attendance_absence`) |
| Pending referral 7+ days | Yes (`REFERRAL_FOLLOW_UP`) | **No** |
| Compliance gap overdue | Yes (`COMPLIANCE_GAP_OVERDUE`) | Cron daily (`compliance_update`) |

Frontend integrating **both** `/notifications` and `/alerts/follow-up` will show **duplicate signals** with different IDs, no unified read state, and inconsistent priority/title shapes.

---

## 7. REST vs Sync Behaviour

| Domain | REST notification | Sync notification | Consistent? |
|--------|-------------------|-------------------|-------------|
| `child_nutrition_screening` create | Yes (severe/moderate) | **No** — `SyncApplyService.createRecord()` writes row only | **NO** |
| `sted_assessment` create | Yes (if followUpIn6Months) | **No** | **NO** |
| `referral` create | Yes | **No** — direct `db.referral.create()` | **NO** |
| `referral` update (status) | Yes | **No** — `applyReferralUpdate()` CAS only | **NO** |
| `child` create (enroll) | Yes | **No** — direct `db.child.create()` | **NO** |
| `child` archive/update | Yes (archive only) | **No** — CAS update, no hook | **NO** |
| `child_transfer` create/accept/cancel | Yes (REST TransfersService) | **No** — lifecycle via `TransferLifecycleService` in sync | **NO** |
| `compliance_assessment` status change | Yes (REST) | **No** — sync CAS update | **NO** |
| `attendance_record` create | No (cron/alerts only) | No | N/A (consistent absence) |
| `wash_indicator`, `center_feeding_day` | No | No | N/A |

**Evidence:** `grep notification` across `src/modules/sync/` returns **zero matches**. `SyncApplyService` has no `NotificationsService` dependency.

For an offline-first platform where caregivers sync from devices, **most notification-producing events likely never reach the inbox**.

---

## 8. Recipient Resolution Audit

### Mechanism

```typescript
// Center-scoped
findUserIdsByRoleAndCenter(centerId, roles[])
  → user_account WHERE centerId = centerId AND role IN roles AND status = active

// District-scoped
findUserIdsByRoleAndDistrict(districtId, roles[])
  → user_account WHERE districtId = districtId AND role IN roles AND status = active
```

### Role mapping (actual `UserRole` enum)

| Event | Roles notified |
|-------|----------------|
| Nutrition alert | `ecd_director`, `district_focal_person` |
| Referral created | `ecd_director` only |
| Referral updated | `ecd_director`, `caregiver` |
| STED follow-up | `ecd_director`, `caregiver` |
| Transfer request | `ecd_director` @ destination |
| Transfer accepted | `ecd_director`, `caregiver` @ source |
| Compliance submitted | `district_focal_person` |
| Compliance verified/rejected | `ecd_director` |
| Child enrolled | `ecd_director` |
| Child archived | `caregiver` |
| Cron attendance low rate | center staff + `district_focal_person` |

### Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Empty recipient set silently skipped | P1 | `notifyAsync` returns early if `userIds.length === 0` — no log at call sites |
| No fallback if center lacks director | P1 | Center with only caregivers gets no referral/nutrition inbox items |
| NCDA never receives persisted notifications | P2 | National admins rely on query-scoped alerts; no inbox rows |
| District isolation on inbox API | OK | `where: { userId: user.id }` — no cross-user read |
| District isolation on alerts API | OK | `AlertsService.resolveScope()` enforces center/district boundaries |
| Caregiver who performed action may also be notified | P3 | No exclusion of actor (except new-user notify filters self) |
| `district_focal_person` requires `districtId` on user row | P1 | Missing districtId → zero district recipients |

**No IDOR on notification read APIs** — ownership enforced at service layer.

---

## 9. Root Causes

### P0 — Broken / security / data integrity

#### P0-1: Sync path completely bypasses notification producers

- **Problem:** Offline sync is the primary mutation path for field users; no notifications are created.
- **Evidence:** `SyncApplyService` — no `NotificationsService` import or calls; direct Prisma writes for nutrition, STED, referral, child, transfer.
- **File/function:** `src/modules/sync/sync-apply.service.ts` — `createRecord()`, `applyChildTransferCreate()`, `applyReferralUpdate()`, `applyChildTransferUpdate()`
- **Impact:** Inbox empty or stale for majority of real-world events; frontend bell badge misleading.
- **Recommended correction:** Extract shared post-commit notification hooks invoked from both REST services and sync apply (after successful transaction).

#### P0-2: Fire-and-forget notifications with swallowed errors

- **Problem:** Notification failures invisible to callers and clients.
- **Evidence:** `notifyAsync()` + `.catch(() => {})` on recipient resolution in all domain services.
- **File/function:** `NotificationsService.notifyAsync()`; e.g. `NutritionService.createScreening()` lines 119–131
- **Impact:** Silent notification loss; debugging requires log diving.
- **Recommended correction:** At minimum log at warn level in empty catches; consider awaited hooks in post-commit callbacks with structured error logging/metrics.

### P1 — Notifications silently missing or incorrect

#### P1-1: Daily cron duplicates notifications

- **Problem:** Same entity notified every cron run with no dedupe.
- **Evidence:** `NotificationCronService` loops create `createForMultipleUsers` without checking existing rows; no unique index.
- **File/function:** `notification-cron.service.ts` — all `notify*` methods
- **Impact:** Inbox spam; unread count inflation; user desensitization.
- **Recommended correction:** Add `dedupeKey` or unique `(userId, type, entityId, cronBatchDate)` / upsert pattern.

#### P1-2: Nutrition notification scope mismatch with alerts

- **Problem:** REST notifies on `severe` + `moderate` only; alerts also flag `at_risk`, `requiresReferral`, never-screened, overdue.
- **Evidence:** `NutritionService.createScreening()` condition vs `AlertsService.nutritionAlerts()`
- **Impact:** Inbox incomplete relative to follow-up dashboard.
- **Recommended correction:** Align trigger conditions or document intentional split.

#### P1-3: Overdue/time-based conditions not pushed to inbox (except cron subset)

- **Problem:** Referral stale, nutrition overdue, STED overdue exist only as computed alerts — no cron/inbox for referrals or nutrition overdue.
- **Evidence:** Cron covers STED upcoming, not overdue; no referral cron.
- **Impact:** Users must poll `/alerts/follow-up` separately from `/notifications`.
- **Recommended correction:** Either extend cron producers or unify on one mechanism.

#### P1-4: Generic notification messages lack entity context

- **Problem:** Messages like "A child has been screened with severe nutrition status" omit child/center names.
- **Evidence:** `NutritionService.createScreening()` notifData
- **Impact:** Poor inbox UX; frontend must join entityId.
- **Recommended correction:** Enrich at creation or expand DTO with denormalized fields.

### P2 — Architecture / UX contract gaps

#### P2-1: Dual systems without unified contract

- **Problem:** Frontend must integrate inbox + follow-up alerts + nutrition alerts with different DTOs.
- **Evidence:** Three separate controllers/services/DTOs
- **Impact:** Duplicate UI entries, inconsistent priority/read semantics.
- **Recommended correction:** Define product model: inbox for discrete events, alerts for work queues — or merge with adapter layer.

#### P2-2: `assessment_due` enum value unused

- **Problem:** Dead enum value suggests incomplete feature.
- **Evidence:** Grep shows no producer emits `assessment_due`.
- **Impact:** Confusion in API docs and client type unions.
- **Recommended correction:** Implement or remove from enum/DTOs.

#### P2-3: Notification API missing priority filter

- **Problem:** `ListNotificationsQueryDto` supports `type` and `isRead` only.
- **Impact:** Cannot filter critical items in inbox (priority only in cron metadata).
- **Recommended correction:** Add priority column or standardize metadata schema.

### P3 — Improvements

- Add notification preferences per user/role
- Add TTL/expiry for stale cron reminders
- Add `actionUrl` generation helper per notification type
- Consider outbox pattern for reliable delivery
- Add integration tests for full producer → inbox → read flow

---

## 10. End-to-End Trace

### Scenario A: Nutrition screening detects severe status

```
Caregiver submits screening (offline sync)
  ↓
POST /sync/... OR REST POST /children/:id/nutrition-screenings
  ↓
[SYNC PATH]
SyncApplyService.createRecord('child_nutrition_screening')
  ↓
db.childNutritionScreening.create({ nutritionStatus: 'severe', ... })
  ↓
❌ STOP — no NotificationsService call
  ↓
No notification persisted
  ↓
GET /notifications → empty for director
  ↓
GET /alerts/follow-up → ✅ shows NUTRITION_SEVERE (computed)

[REST PATH]
NutritionService.createScreening()
  ↓
Transaction: screening + audit ✅
  ↓
if severe|moderate → findUserIdsByRoleAndCenter + District
  ↓
notifyAsync(allIds, { type: 'nutrition_alert', ... })
  ↓
✅ notification row(s) persisted (async, may fail silently)
  ↓
GET /notifications → ✅ visible to director/district officer
```

**Break point (sync):** `sync-apply.service.ts` → `case 'child_nutrition_screening'` (line ~1325)

---

### Scenario B: Referral requires district follow-up (pending 7+ days)

```
Referral created (status: pending)
  ↓
[REST] ReferralsService.create() → notifyAsync ecd_director (referral_created)
[SYNC] SyncApplyService → db.referral.create() → ❌ no notification
  ↓
7 days pass, no status change
  ↓
No user action → no new notification event
  ↓
NotificationCronService — ❌ no referral stale job
  ↓
GET /notifications → only initial referral_created (if REST path); nothing on day 7
  ↓
GET /alerts/follow-up → ✅ REFERRAL_FOLLOW_UP (computed from pending + age)
```

**Break point:** Stale referral follow-up exists **only** as operational alert, not inbox notification.

---

### Scenario C: Growth measurement / screening becomes overdue (30 days)

```
Last screening 35 days ago
  ↓
No domain mutation on day 30
  ↓
NotificationCronService — ❌ no nutrition overdue job
  ↓
GET /notifications → ❌ nothing
  ↓
GET /alerts/follow-up → ✅ NUTRITION_OVERDUE (computed)
GET /nutrition/alerts → ✅ overdue_screening (computed)
```

**Break point:** Time-based overdue is **query-time only** — no scheduler pushes to inbox.

---

## 11. Database / Index Audit

| Item | Status | Notes |
|------|--------|-------|
| FK `user_id → user_account` | OK | ON DELETE RESTRICT |
| Index `(userId, isRead)` | OK | Supports unread queries |
| Index `(userId, createdAt)` | OK | Supports inbox sort |
| Index `(type)` | OK | Low selectivity alone |
| Unique dedupe constraint | **Missing** | Cron duplicates |
| `(userId, type, entityId)` index | **Missing** | Would help dedupe lookups |
| Cascade on user delete | RESTRICT | Orphan notifications block user delete — acceptable |
| Cascade on entity delete | **None** | Notifications remain pointing at deleted entities |
| `recipientId` nullable | N/A | Always required via `userId` |
| Schema location | **Verify** | Migration unqualified; Prisma expects `sde` |
| Soft-delete interaction | **Gap** | Notifications not soft-deleted with source entities |

---

## 12. Delivery Infrastructure

| Channel | Implemented? |
|---------|--------------|
| In-app (REST poll) | **YES** |
| WebSocket | **NO** — no `@WebSocketGateway`, no Socket.IO |
| Push (FCM) | **NO** — no Firebase/FCM references |
| Email | **NO** — no SendGrid/mailer integration for notifications |
| SMS | **NO** — no Twilio/Africa's Talking |

**Conclusion:** The current implementation supports **only in-app notifications via REST polling**, plus **computed operational alerts** that are not delivered push-style.

No notification-related environment variables in `.env.example`.

---

## 13. Test Coverage

### What exists

| Test file | Covers |
|-----------|--------|
| `notification-cron.service.spec.ts` | Cron attendance absence/low-rate emission |
| `alerts.service.spec.ts` | Follow-up alert computation (nutrition, attendance, referral, data quality) |
| `nutrition.service.spec.ts` | `getAlerts()` computed alerts; **mocks** `notifyAsync` (no assertion) |
| Domain service specs | All mock `notifyAsync: () => {}` — **no notification creation tests** |

### Missing

- `NotificationsService` unit tests (list, read, mark read, scoping)
- Notification creation from REST producers (recipient IDs, types, entity refs)
- Authorization / IDOR tests for `/notifications`
- Sync-originated notification tests (currently would fail — document expected gap)
- Duplicate prevention / cron idempotency tests
- Transaction failure scenarios (record saved, notification failed)
- Mark-all-read / unread-count integration tests
- End-to-end producer → API read flow

---

## 14. Recommended Architecture

**Smallest fit for this codebase** — reuse existing pieces, don't introduce message brokers:

1. **Single post-commit hook layer** (`NotificationEmitter` or extend `NotificationsService`):
   - Accepts `{ eventType, entityType, entityId, centerId, districtId, payload }`
   - Resolves recipients via existing `findUserIdsByRoleAndCenter/District`
   - Supports dedupe via `(userId, type, entityId)` or explicit `dedupeKey`
   - Called from REST services **and** `SyncApplyService` after successful apply

2. **Keep operational alerts separate** but document clearly:
   - **Inbox** = discrete events + time-based reminders with read state
   - **Follow-up queues** = current operational state snapshots (no read state)
   - Frontend should not double-render the same condition from both without dedupe UX

3. **Cron becomes idempotent reminder engine** — upsert or skip-if-exists per `(user, type, entity, batchDate)`

4. **Optional later:** outbox table for retry; WebSocket for live badge updates — not required for MVP fix

---

## 15. Proposed Implementation Phases

### NOTIF-01 — Fix broken notification producers (sync parity)

| | |
|---|---|
| **Goal** | Every notification-triggering domain mutation emits the same side effects via REST and sync |
| **Files likely affected** | `sync-apply.service.ts`, extract shared hooks from `nutrition.service.ts`, `referrals.service.ts`, `sted.service.ts`, `children.service.ts`, `transfers`/`transfer-lifecycle.service.ts`, `compliance.service.ts` |
| **Database changes** | None |
| **API changes** | None (behavioral) |
| **Risk** | Medium — must not block sync apply on notification failure |
| **Acceptance criteria** | Sync-created severe nutrition screening creates `nutrition_alert` rows; sync referral create notifies director; tests prove parity |

### NOTIF-02 — Normalize recipient/scoping logic

| | |
|---|---|
| **Goal** | Consistent role maps, logging when recipient set empty, optional actor exclusion |
| **Files likely affected** | `notifications.service.ts`, new `notification-recipients.config.ts`, domain producers |
| **Database changes** | None |
| **API changes** | None |
| **Risk** | Low |
| **Acceptance criteria** | Documented recipient matrix; warn log when zero recipients; district/center isolation tests pass |

### NOTIF-03 — Inbox contract enrichment

| | |
|---|---|
| **Goal** | Richer notification payload for frontend bell (names, priority, consistent metadata) |
| **Files likely affected** | `notification.mapper.ts`, `notification-response.dto.ts`, producers, optional schema migration |
| **Database changes** | Optional: `priority`, `centerId`, `childId` columns |
| **API changes** | Extended response DTO |
| **Risk** | Low |
| **Acceptance criteria** | Nutrition alert includes child name; priority filter works |

### NOTIF-04 — Fix REST/sync parity tests + producer reliability

| | |
|---|---|
| **Goal** | Replace silent `.catch(() => {})` with structured logging; post-commit async with metrics |
| **Files likely affected** | All producers, `notifications.service.ts` |
| **Database changes** | None |
| **API changes** | None |
| **Risk** | Low |
| **Acceptance criteria** | Failed notification logged with entity context; no unhandled rejections |

### NOTIF-05 — Idempotency + cron dedupe

| | |
|---|---|
| **Goal** | Prevent daily duplicate cron notifications |
| **Files likely affected** | `notification-cron.service.ts`, migration for unique index |
| **Database changes** | `dedupe_key` column + unique index, or `(user_id, type, entity_id, metadata->cronBatchDate)` |
| **API changes** | None |
| **Risk** | Medium — migration on existing duplicates |
| **Acceptance criteria** | Running cron twice same day does not increase row count for same entity |

### NOTIF-06 — Optional realtime/external delivery

| | |
|---|---|
| **Goal** | WebSocket badge push or FCM for critical alerts |
| **Files likely affected** | New gateway module, env config |
| **Database changes** | Optional device push tokens |
| **API changes** | Optional subscribe endpoint |
| **Risk** | High (infra) |
| **Acceptance criteria** | Critical `nutrition_alert` pushes to mobile within N seconds |

---

*Audit completed without code modifications. Generated from static analysis of `src/modules/notifications`, `src/modules/alerts`, domain services, `sync-apply.service.ts`, Prisma schema/migrations, and test files.*
