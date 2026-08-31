# Scenario C — relationship map

Two layers: (1) full FK inventory in Postgres for engineering reference, and
(2) **Esri relationship classes** for ArcGIS Pro. Only `ecd_center` and
`administrative_unit` carry geometry — everything else attaches as related tables
via `center_id` (or admin hierarchy).

---

## 1. Full foreign key inventory

| Table | FK column | References | Cardinality | Notes |
|---|---|---|---|---|
| administrative_unit | parent_id | administrative_unit.id | 1 parent : many children | Self-referencing hierarchy |
| district | province_id | administrative_unit.id (level=province) | 1 : many | |
| ecd_center | district_id | district.id | 1 : many | |
| ecd_center | village_id | administrative_unit.id (level=village) | 1 : many | |
| child | center_id | ecd_center.id | 1 : many | |
| child | classroom_id | classroom.id | 1 : many, nullable | |
| child | home_village_id | administrative_unit.id (level=village) | 1 : many | Distinct from center village |
| classroom | center_id | ecd_center.id | 1 : many | |
| classroom_assignment_history | child_id | child.id | 1 : many | |
| classroom_assignment_history | classroom_id | classroom.id | 1 : many | |
| attendance_record | child_id | child.id | 1 : many | |
| attendance_record | center_id | ecd_center.id | 1 : many | Denormalized for query performance |
| child_nutrition_screening | child_id | child.id | 1 : many | |
| child_transfer | child_id | child.id | 1 : many | |
| child_transfer | from_center_id / to_center_id | ecd_center.id | many : 1 each | |
| sted_assessment | child_id | child.id | 1 : many | |
| sted_assessment | center_id | ecd_center.id | 1 : many | |
| referral | child_id | child.id | 1 : many | |
| referral | center_id | ecd_center.id | 1 : many | |
| referral | source_id | *(polymorphic)* | — | **No DB FK.** See §3. |
| compliance_assessment | center_id | ecd_center.id | 1 : many | |
| compliance_assessment_item | assessment_id | compliance_assessment.id | 1 : many | |
| compliance_assessment_item | standard_id | ecd_standard.id | 1 : many | |
| wash_indicator | center_id | ecd_center.id | 1 : many | |
| center_feeding_day | center_id | ecd_center.id | 1 : many | |
| center_feeding_month_summary | center_id | ecd_center.id | 1 : many | |
| parent_contribution | center_id | ecd_center.id | 1 : many | |
| parent_contribution | child_id | child.id | 1 : many, nullable | |
| center_support | center_id | ecd_center.id | 1 : many | |
| parenting_session | center_id | ecd_center.id | 1 : many | Out of GIS scope |
| ecd_committee_member | center_id | ecd_center.id | 1 : many | Out of GIS scope |
| center_visit | center_id | ecd_center.id | 1 : many | Out of GIS scope |
| staff_training | center_id | ecd_center.id | 1 : many | Rollup view only (Q5) |

**Multi-hop chains** (geometry two hops away):

- `compliance_assessment_item` → `compliance_assessment` → `ecd_center`
- `child_nutrition_screening` → `child` → `ecd_center`

Phase 6 `gis.*` views perform these joins — do not re-derive in ArcGIS.

---

## 2. Esri relationship classes (ArcGIS Pro)

**Origin** = spatial feature class (`gis.ecd_center` or `gis.administrative_unit`).
**Destination** = related table or view. All **simple**, **one-to-many** unless noted.
Do not enable cascade delete on the GIS side.

| Relationship class | Origin | Destination | Origin PK | Destination FK | Cardinality |
|---|---|---|---|---|---|
| rel_center_nutrition | gis.ecd_center | gis.child_nutrition_screening | id | center_id | 1:M |
| rel_center_sted | gis.ecd_center | gis.sted_assessment | id | center_id | 1:M |
| rel_center_referral | gis.ecd_center | gis.referral | id | center_id | 1:M |
| rel_center_compliance | gis.ecd_center | gis.compliance_assessment_latest | id | center_id | 1:1 (latest) |
| rel_center_wash | gis.ecd_center | gis.wash_indicator_latest | id | center_id | 1:1 (latest) |
| rel_center_attendance | gis.ecd_center | gis.attendance_summary | id | center_id | 1:M (monthly rollup) |
| rel_center_feeding | gis.ecd_center | gis.center_feeding_month_summary | id | center_id | 1:M |
| rel_center_contribution | gis.ecd_center | gis.parent_contribution | id | center_id | 1:M |
| rel_center_support | gis.ecd_center | gis.center_support | id | center_id | 1:M |
| rel_center_classroom | gis.ecd_center | gis.classroom_by_center | id | center_id | 1:M (by grade) |
| rel_center_staff_training | gis.ecd_center | gis.staff_training_by_center | id | center_id | 1:M (by month) |
| rel_admin_unit_parent | gis.administrative_unit | gis.administrative_unit | id | parent_id | 1:M (self) |
| rel_admin_unit_district | gis.administrative_unit | district | id | province_id | 1:M |
| rel_admin_unit_center | gis.administrative_unit | gis.ecd_center | id | village_id | 1:M |

**Not registered (Q6 — no child PII layer):** `rel_center_child` on raw `child`.

**Latest vs full history:** `_latest` views use `DISTINCT ON (center_id)`. For full
compliance/WASH history in ArcGIS, add `gis.compliance_assessment_full` /
`gis.wash_indicator_full` (drop `DISTINCT ON`) and relate as 1:M.

**Compliance items:** single-hop limit — flatten gap counts into
`compliance_assessment_latest` for pop-ups, or chain a non-spatial
`compliance_assessment` → `compliance_assessment_item` relationship off the center relate.

---

## 3. Data integrity gap (pre go-live)

`referral.source_id` is polymorphic (nutrition vs STED) with no enforced FK.
Recommended: split into `nutrition_screening_id` / `sted_assessment_id` with a
`CHECK` that exactly one is set. Run `npm run gis:verify:phase8` to audit orphans.
