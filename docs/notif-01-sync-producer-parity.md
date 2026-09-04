# NOTIF-01 — Sync Notification Producer Parity

## 1. Before

```
REST domain mutation
  → domain service (Nutrition, Referrals, STED, …)
  → inline notifyAsync + recipient lookup
  → sde.notification

SYNC domain mutation
  → SyncApplyService
  → Prisma write
  → ❌ no notification hook
```

Offline-originated creates/updates (nutrition screenings, referrals, transfers, etc.) persisted correctly but **never reached the notification inbox**.

## 2. Root Cause

`SyncApplyService` (`src/modules/sync/sync-apply.service.ts`) applied sync operations by writing directly to Prisma via `createRecord()`, specialized transfer/referral handlers, and `casUpdate()`. It had **no dependency on `NotificationsService`** and no post-apply side-effect layer.

REST domain services each implemented notification logic locally with duplicated recipient resolution and silent `.catch(() => {})` error swallowing.

## 3. Implementation

| File | Responsibility |
|------|----------------|
| `src/modules/notifications/notification-events.service.ts` | **Shared domain notification producers** — single place for business rules, recipient resolution, and logging |
| `src/modules/sync/sync-notification-bridge.service.ts` | Loads persisted entities after sync apply and delegates to `NotificationEventsService` |
| `src/modules/sync/sync-apply.service.ts` | Calls bridge **only after successful apply** (`applied` status, not `conflict`/`failed`) |
| `src/modules/notifications/notifications.service.ts` | Enhanced `notifyAsync()` — logs empty recipient sets and accepts optional `logContext` |
| `src/modules/notifications/notifications.module.ts` | Exports `NotificationEventsService` |
| `src/modules/sync/sync.module.ts` | Imports `NotificationsModule`, registers bridge |
| Domain services (nutrition, sted, referrals, children, transfers, compliance) | Refactored to call `NotificationEventsService` instead of inline notification code |

## 4. Shared Producer Architecture

```
REST domain service                SYNC SyncApplyService
        │                                    │
        └──────────► NotificationEventsService ◄──────────┐
                   (business rules + recipients)            │
                            │                               │
                            ▼                               │
                   NotificationsService.notifyAsync         │
                            │                               │
                            ▼                               │
                   sde.notification                         │
                                                            │
                   SyncNotificationBridgeService ──────────┘
                   (loads entity after sync apply)
```

**Boundary:** Domain mutation commits first. Notification is **best-effort** post-commit (see §7).

## 5. Domain Coverage

| Domain event | REST | Sync apply path | Parity |
|--------------|------|-----------------|--------|
| Nutrition screening (severe/moderate) | `NutritionService.createScreening` | `createRecord` → bridge `afterEntityCreated` | **Yes** |
| STED 6-month follow-up | `StedService.create` | `createRecord` → bridge | **Yes** |
| Referral created | `ReferralsService.create` | `createRecord` → bridge | **Yes** |
| Referral status updated | `ReferralsService.updateStatus` | `applyReferralUpdate` → bridge | **Yes** |
| Child enrolled | `ChildrenService.create` | `createRecord` (active child) → bridge | **Yes** |
| Child archived | `ChildrenService.archive` | `casUpdate` child status → archived → bridge | **Yes** |
| Transfer requested | `TransfersService.create` | `applyChildTransferCreate` → bridge | **Yes** |
| Transfer accepted | `TransfersService.accept` | `applyChildTransferUpdate` → bridge | **Yes** |
| Transfer cancelled | `TransfersService.cancel` | `applyChildTransferUpdate` → bridge | **Yes** |
| Compliance status change (submitted/verified/rejected) | `ComplianceService.updateAssessment` | `casUpdate` compliance_assessment → bridge | **Yes** |
| User provisioned (`general`) | `UsersService.create` | N/A (not sync-applied) | **Out of scope** — no sync entity |
| Child reactivated | Not implemented on REST | Not implemented | **N/A** |
| Attendance / WASH / feeding | Not implemented on REST | Not implemented | **N/A** |

## 6. Recipient Resolution

All recipient logic remains in `NotificationsService.findUserIdsByRoleAndCenter` / `findUserIdsByRoleAndDistrict`. **`NotificationEventsService` is the only caller** for domain events — both REST and sync paths invoke the same methods with the same role matrices:

| Event | Roles | Scope |
|-------|-------|-------|
| Nutrition alert | `ecd_director`, `district_focal_person` | center + district |
| STED follow-up | `ecd_director`, `caregiver` | center |
| Referral created | `ecd_director` | center |
| Referral updated | `ecd_director`, `caregiver` | center |
| Child enrolled | `ecd_director` | center |
| Child archived | `caregiver` | center |
| Transfer request | `ecd_director` | destination center |
| Transfer accepted | `ecd_director`, `caregiver` | source center |
| Transfer cancelled | `ecd_director` | destination center |
| Compliance submitted | `district_focal_person` | district |
| Compliance verified/rejected | `ecd_director` | center |

Sync bridge loads `centerId` / `districtId` from persisted rows after apply — no duplicate resolution logic in `SyncApplyService`.

## 7. Failure Semantics

All NOTIF-01 notification producers are **best-effort**:

| Layer | Behavior |
|-------|----------|
| REST | `void notificationEvents.on*()` — domain HTTP/sync response succeeds even if notification fails |
| Sync apply | `runNotificationSideEffect()` wraps bridge calls; logs errors, does not change `ApplyResult` |
| `NotificationEventsService` | Logs recipient-resolution failures; does not throw to callers |
| `NotificationsService.notifyAsync` | Logs `createForMultipleUsers` failures; warns when recipient set is empty |

**None** are transactionally required — consistent with pre-NOTIF-01 REST behavior.

## 8. Idempotency

Sync create idempotency is preserved by existing apply guards:

```text
applyCreate()
  → findRecord(entityId)
  → if exists → return conflict (NO notification)
  → else create + emitCreateNotifications()
```

Replay of the same entity ID therefore **does not re-apply mutation or re-trigger the bridge**.

Update paths only emit notifications when `casUpdate` / lifecycle returns `applied` (version match, valid state transition). Failed/conflict updates do not notify.

**Remaining risk (deferred to NOTIF-05):** If notification creation itself succeeds once but sync operation status is lost and a *different* entity ID is used for the same business event, duplicate inbox rows are still possible — no DB dedupe constraint exists yet. Normal sync clientOperationId + entityId conflict semantics prevent the common retry case.

## 9. Tests

| Test file | Coverage | Result |
|-----------|----------|--------|
| `notification-events.service.spec.ts` | Severe nutrition recipients, normal screening no-op, STED follow-up, compliance district scoping | **PASS** |
| `sync-apply-notifications.spec.ts` | Sync create triggers bridge; entity conflict skips bridge | **PASS** |
| `sync-apply-attendance.spec.ts` | Updated constructor (noop bridge) | **PASS** |
| `sync-apply-feeding.spec.ts` | Updated constructor (noop bridge) | **PASS** |
| `notification-cron.service.spec.ts` | Unchanged cron behavior | **PASS** |
| `nutrition.service.spec.ts` | Updated mock | **PASS** |
| `referral.service.spec.ts` | Updated mock | **PASS** |
| `sted.service.spec.ts` | Updated mock | **PASS** |
| `compliance.service.spec.ts` | Updated mock | **PASS** |
| `npm run build` | TypeScript compile | **PASS** |

Run: `npm run test:notifications`

## 10. Remaining Notification Gaps

Explicitly **not** addressed in NOTIF-01:

- Daily cron duplicate notifications (NOTIF-05)
- User provisioning notifications via sync (no sync path)
- `assessment_due` unused enum value
- Inbox API enrichment (priority, child/center names, actionUrl)
- Broader repository-wide removal of silent `.catch(() => {})` in untouched services (e.g. `UsersService`)
- WebSocket / push / email / SMS delivery
- Operational alert endpoints (`/alerts/follow-up`) — remain separate from inbox
- DB dedupe unique constraints

---

*Implemented: September 2026. Verified against audit `docs/notification-backend-audit.md`.*
