# ECD work progress — August–September 2026

Status as of **8 September 2026**. Covers both repositories:

| Repo | Path | Latest on `main` |
| --- | --- | --- |
| Backend | `D:\Esri\ECD Backend` | `065ec05` Email service (7 Sep) |
| Frontend | `D:\Esri\ECD` | `c6de9b7` UI refinements (8 Sep) |

---

## Product vocabulary (locked)

NCDA is the naming baseline. District was aligned to it on 7–8 Sep.

| Concept | Standard name | Meaning | District | NCDA | Caretaker |
| --- | --- | --- | --- | --- | --- |
| Performance monitoring | **Gukurikirana** | How are things progressing? Trends, coverage, feeding, STED. | Keep **Imikorere** for now (same job) | **Gukurikirana** | Only if needed |
| Actionable alerts | **Impugukirwa** | What requires attention? Priority, reason, suggested action, geo drill-down. | `/district/impugukirwa` (hierarchy) | **Impugukirwa** | **Impugukirwa** |
| Reports | **Raporo** | Reporting | Raporo | Raporo | Raporo |

Rule: **never use Gukurikirana to mean alerts in one portal and monitoring in another.**

District’s old flat alerts page was removed. The hierarchy (`AlertHierarchyDrilldown`) is the only Impugukirwa surface. `/district/gukurikirana` redirects to `/district/impugukirwa`.

---

## 1. Notifications (backend + app inbox)

**Verdict:** in-app notifications work for REST and offline sync. Daily cron is idempotent. Copy is now Kinyarwanda.

### Architecture

```text
REST write  → domain service → NotificationEventsService → NotificationsService → sde.notification
Sync write  → SyncApplyService → SyncNotificationBridgeService → same NotificationEventsService
Daily cron  → NotificationCronService (06:00 UTC) → NotificationsService
```

Alerts (`GET /alerts/follow-up`) stay **computed current state**. Notifications are a **persisted per-user inbox** with read state.

### Remediation (NOTIF-01 … NOTIF-09)

| ID | Topic | Status |
| --- | --- | --- |
| NOTIF-01 | REST / sync producer parity | Done |
| NOTIF-02 | Failure logging (no silent swallow) | Done |
| NOTIF-03 | Rich inbox (`priority`, `entity`, `context`, `action`) | Done |
| NOTIF-04 | Nutrition event coverage (severe / moderate / at_risk / referral) | Done |
| NOTIF-05 | Durable `dedupeKey` + unique `(userId, dedupeKey)` | Done |
| NOTIF-06 | Time-derived inbox (stale referral, overdue/never-screened nutrition, attendance, capacity, STED, compliance, stale transfer) | Done |
| NOTIF-07 | Context-rich messages | Done for cron; event copy localized 7 Sep |
| NOTIF-08 | Dead `assessment_due` type retired from new writes | Done |
| NOTIF-09 | `GET /notifications?priority=` | Done |

Event producers: nutrition, referral, STED, compliance, child enroll/archive, transfers, center create (sync + Survey123 SQL), user provisioned (center directors).

### 7 Sep inbox bugfix (`480163d`)

Empty inbox after adding a child was a **sync-apply / copy / recipient** issue, not a missing list API.

- Sync apply now fires the same notification events as REST (including child enroll).
- Titles/messages persist in **Kinyarwanda** (`notification-copy.ts`).
- Recipients stay scoped: e.g. `child_enrolled` → active `ecd_director`s on the **same `centerId`**.

### Docs

- `docs/notification-backend-audit.md`
- `docs/notification-remediation-audit.md`
- `docs/notif-01-sync-producer-parity.md`
- `docs/notif-03-inbox-contract.md`
- `docs/notif-05-deduplication-reliability.md`
- `docs/frontend-notifications-alerts.md`

---

## 2. Transactional email (7 Sep)

**Backend** `065ec05` + **frontend** `727caae`.

SMTP module, not OneSignal (docs were reviewed; SMTP is what shipped).

| Template | When |
| --- | --- |
| `security.passwordResetRequested` | Forgot-password request (link via `FRONTEND_URL`) |
| `security.passwordResetCompleted` | Password actually reset |
| `security.accountProvisioned` | Admin creates a user (username + temporary password) |

Sending is **best-effort**: missing SMTP or missing recipient skips send; auth/user APIs still succeed.

Env (see `.env.example`): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `FRONTEND_URL`.

Verify: `npm run smtp:verify`. Tests: `npm run test:email`, `npm run test:auth`.

---

## 3. GIS, Survey123, and maps

### Backend GIS BFF

Portal token + proxy so the SPA does not hold ArcGIS credentials (`118b023`). Env: `ARCGIS_*`.

### Schema / Scenario C

- GIS alignment, PostGIS phases, Survey123 mapping trigger (`ecd_mapping_form` → `ecd_center`).
- **Lookup dual-write removed.** PostgreSQL enums are the single source of truth (`91d9bfe`). Survey123 still writes enum columns directly.

Runbook: `docs/survey123-sync.md`, `docs/gis/scenario-c-implementation-plan.md`.

### Survey123 data check (7 Sep)

Joined `ecd_mapping_form` vs `ecd_center` on `ecd_code` ↔ `code`. Applied pairs (name / status / phone / coords) look aligned. Remaining gaps:

| Side | Key | Issue |
| --- | --- | --- |
| Center only | `RK012` / GS Karambira | No survey row |
| Survey only | objectid `803` / Kagina Ecd | `failed` — **`ecd_code is required`** |

Accreditation, curriculum, services stay on the survey table only; empty capacity/compliance columns on `ecd_center` are expected.

### Frontend map UX (7–8 Sep)

- NCDA **Erekana ku ikarita** / **Reba ku ikarita** zooms to the school (lat/lng/zoom into `ArcGisMapEmbed`).
- Ahantu no longer prints raw coordinates.
- Embed retries `goTo` after the webmap viewpoint settles so zoom is not overwritten.
- District center detail: focused map + large-map link to `/district/ikarita?center=…`.
- Overview dashboards: removed Ikigo search, Akayunguruzo (filters), and Inyandiko (layers) from NCDA and district command UIs.

---

## 4. Follow-up alerts (Impugukirwa)

### Backend

Hierarchical summary so district/NCDA can drill **province → district → sector → center** without loading every child alert up front (`35152ac`).

`GET /alerts/follow-up/summary` + `GET /alerts/follow-up`.

Detectors include: attendance, nutrition, referral, data_quality, **sted, transfer, compliance, capacity**.

### Frontend IA (7–8 Sep)

- NCDA Gukurikirana (monitoring) aligned to district Imikorere (hub + domain tabs).
- NCDA Impugukirwa uses the same hierarchy component as district, national scope.
- District Gukurikirana **renamed to Impugukirwa**; flat duplicate deleted.

### Open product decision

UI still surfaces four “main concerns” well (attendance, nutrition, referral, data_quality). Backend also counts STED / transfer / compliance / capacity. Totals can exceed the leaf cards if category = all.

Choose later:

- **Narrow:** Impugukirwa = four UI categories; stop counting the rest in totals, or
- **Widen:** expose the other four as filters, chips, and suggested actions.

No dismiss/ack loop by design — the page answers “is the detector still firing?”, not “did we follow up?”.

---

## 5. Analytics and NCDA / district overview

- Children demographics + district-risk analytics for NCDA overview and monitoring (`92c6737`).
- Click-through from “total children” into a demographic breakdown.
- District Incamake matched to NCDA overview map layout (`a6bb6d7`, `3c28376`).
- Reduced raw UUID exposure in UI and routes (`bd3c8d7`).
- NCDA children cards: view-details action (`486b9a6`).

---

## 6. Users, roles, and ECD Book register

| Work | Notes |
| --- | --- |
| ECD director role | Caregiver access, caregiver management, list all ECD, transfers restricted to director |
| Gender on users | Especially caregivers; create/update + OpenAPI (`da85764e`) |
| One-time temp password | Returned on create and reset (`b75c690`); now also emailed when SMTP is set |
| NCDA register VIII–XVI | Parent contributions, parenting sessions, committee, educator fields, support, visits, staff trainings. XV–XVI (meal plan / daily timetable) deferred as reference-only. REST only; not in offline sync yet. See `docs/ncda-register-sections-viii-xvi.md`. |
| Classrooms / grades | Promotion workflow (`e396eb3`) |
| Transfer history | History endpoint (`5cc60ea`) |

---

## 7. Offline sync and field ops

Earlier August work that the later notification/GIS work depends on:

- Local-first attendance, children, growth, feeding, STED, referrals
- Device register required on live login
- Feeding apply unblocked when stuck at started/pending
- Caregiver pull scope + child gender mapping
- NCDA monitoring N+1 replaced with scoped aggregations
- CORS preflight for login
- Swagger server URL for hosted deploys

---

## 8. Tooling and ops

- CI quality gate (GitHub Actions): lint / typecheck / unit tests / build. No production migrate/deploy in CI.
- Seed helpers: admin, survey-sync user, test children (attendance + growth).
- `npm run test:all` covers modules including email, GIS, notifications.
- Survey retry: set `sync_status = 'pending'` on a failed `ecd_mapping_form` row (see `docs/survey123-sync.md`).

---

## What is still open

1. **Survey123:** set `ecd_code` on objectid `803` and re-sync; decide whether `RK012` needs a survey row.
2. **Impugukirwa categories:** 4 vs 8 detectors (see §4).
3. **Imikorere vs Gukurikirana on district:** monitoring still labeled Imikorere; rename only if product wants one word everywhere.
4. **Email:** SMTP must be configured in each environment; unset = skip send.
5. **Register VIII–XVI:** no caretaker offline sync yet.
6. **WASH** is not part of Survey123 → center sync.
7. **Push / SMS / OneSignal:** not implemented. In-app + SMTP only.
8. **Notification emails** for operational alerts: not wired; email is security/account only.

---

## Related frontend docs

Handover pack in `D:\Esri\ECD\docs\handover\` (architecture, codebook, role manuals). Notification UI notes: `D:\Esri\ECD\docs\notif-frontend-integration.md`.
