# NCDA register sections VIII–XVI (backend foundation)

This note records the architecture decisions for digitizing *Igitabo cy’Urugo Mbonezamikurire y’Abana Bato* from Section VIII onward. It is backend/data only; no frontend screens were added in this phase.

## Audit summary

| Section | Existing overlap | Decision | Model / API |
| --- | --- | --- | --- |
| VIII Parent contributions | None. Child stores `guardianName` / phones; no parent person table. | **New model.** Optional `childId`. Totals derived. | `ParentContribution` · `GET/POST /api/v1/contributions` · `GET /api/v1/contributions/summary` |
| IX Parenting sessions | None. | **New model.** Facilitator need not be a `UserAccount`. Attendance total derived. | `ParentingSession` · `/api/v1/parenting-sessions` |
| X Centre committee | No staff/committee table besides `UserAccount`. Committee members are usually community members. | **New model.** Optional `userId`. History via `isActive` / `endDate`. | `EcdCommitteeMember` · `/api/v1/committee-members` |
| XI Educators / caregivers | `UserAccount` with `role=caregiver` and `centerId`. Phone already exists. No gender/education. | **Extend `UserAccount`.** Do not add a parallel person table. One centre assignment via `centerId`. Trainings are events (`StaffTraining`). | `GET /api/v1/users?role=caregiver&centerId=` · fields `gender`, `educationLevel` |
| XII Support received | None. Distinct from feeding execution. | **New model.** No signature blob. | `CenterSupport` · `/api/v1/center-support` |
| XIII Visitors | None. | **New model.** No signature blob. | `CenterVisit` · `/api/v1/center-visits` |
| XIV Trainings received | None. Must not be a text field on the user. | **New event model** linked to `traineeUserId` when the trainee is a platform user. `certificateReceived` is boolean. Date + `durationDays` (not start/end pair). | `StaffTraining` · `/api/v1/staff-trainings` |
| XV Sample meal schedule | `center_feeding_day` + `center_feeding_month_summary` record **actual** food served. No meal-plan/template tables. | **Reference-only / deferred.** No new tables. Feeding execution stays as-is. | — |
| XVI Sample daily timetable | No schedule/template tables. Attendance is a child presence log, not a timetable. | **Reference-only / deferred.** No product workflow edits daily schedules today. | — |

## Sections XV–XVI

| Section | Status | Why |
| --- | --- | --- |
| XV Meal schedule | **Reference-only** | The book page is a sample weekly menu. The product already persists what was actually served (`CenterFeedingDay`). A configurable `CenterMealPlan` would be a new planning workflow that does not exist yet. |
| XVI Daily ECD schedule | **Reference-only** | The book page is a sample timetable. There is no monitoring or editing workflow for daily activity templates. |

If a later sprint needs editable plans, add `CenterMealPlan` / `CenterDailySchedule` as **planning** tables and keep feeding/attendance as **execution**.

## Conventions followed

- `centerId` (not `ecdCenterId`) to match existing Prisma models.
- UUID ids, `version` + CAS on updates, `deletedAt` soft delete, `recordedById`, audit via `AuditService`.
- Centre staff (`caregiver`, `ecd_director`) mutate their centre; district and NCDA read within existing scope helpers.
- Paper monthly totals are **not** stored; use `GET /contributions/summary`.
- Paper signature columns are **not** stored; authenticated `recordedById` + audit logs provide provenance.
- Sync columns exist on the new tables for a later sprint; entities are **not** registered in `SYNCABLE_ENTITY_TYPES` yet.

## Offline sync (this phase)

| Entity | REST | SYNC PUSH | SYNC PULL | Reason |
| --- | --- | --- | --- | --- |
| parent_contribution | YES | NO | NO | REST foundation first; full sync apply/pull is a follow-up |
| parenting_session | YES | NO | NO | Same |
| ecd_committee_member | YES | NO | NO | Same |
| UserAccount educator fields | YES (existing `/users`) | NO extra | NO extra | Users are not a caretaker offline entity today |
| center_support | YES | NO | NO | Same |
| center_visit | YES | NO | NO | Same |
| staff_training | YES | NO | NO | Same |
| meal plan / daily schedule | NO | NO | NO | Reference-only |
