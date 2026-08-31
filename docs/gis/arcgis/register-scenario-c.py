"""
Scenario C — create relationship classes in a file geodatabase from an open map.

Run inside ArcGIS Pro (Python window or notebook) after:
  1. Database connection to ECD Postgres is added
  2. gis.ecd_center and related gis.* layers are in the active map

Edit GDB before running. Requires ArcGIS Pro 3.x + arcpy.

This script documents the relationship inventory; it copies layers into a GDB
then creates simple relationship classes. For query-layer-only workflows, create
relates manually in the map (Catalog → Create Relationship Class) using the same
PK/FK pairs from docs/gis/scenario-c-relationship-map.md.
"""

import arcpy

# --- CONFIG ---
GDB = r"C:\GIS\ECD\scenario_c.gdb"  # file GDB to create/populate
SR = arcpy.SpatialReference(4326)

# Origin FC name in GDB : (destination table name in GDB, origin_pk, dest_fk, cardinality)
# Cardinality: "ONE_TO_MANY" or "ONE_TO_ONE"
CENTER_RELATES = [
    ("gis_ecd_center", "gis_child_nutrition_screening", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_sted_assessment", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_referral", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_compliance_assessment_latest", "id", "center_id", "ONE_TO_ONE"),
    ("gis_ecd_center", "gis_wash_indicator_latest", "id", "center_id", "ONE_TO_ONE"),
    ("gis_ecd_center", "gis_attendance_summary", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_center_feeding_month_summary", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_parent_contribution", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_center_support", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_classroom_by_center", "id", "center_id", "ONE_TO_MANY"),
    ("gis_ecd_center", "gis_staff_training_by_center", "id", "center_id", "ONE_TO_MANY"),
]

ADMIN_RELATES = [
    ("gis_administrative_unit", "gis_administrative_unit", "id", "parent_id", "ONE_TO_MANY"),
    ("gis_administrative_unit", "gis_ecd_center", "id", "village_id", "ONE_TO_MANY"),
]


def ensure_gdb():
    if not arcpy.Exists(GDB):
        arcpy.management.CreateFileGDB(*GDB.rsplit("\\", 1))


def copy_from_map_layer(map_layer_name: str, out_name: str):
    """Copy a layer from the active map into GDB (feature class or table)."""
    aprx = arcpy.mp.ArcGISProject("CURRENT")
    m = aprx.activeMap
    lyr = None
    for l in m.listLayers():
        if l.name == map_layer_name or map_layer_name in l.dataSource:
            lyr = l
            break
    if lyr is None:
        raise RuntimeError(f"Layer not found in map: {map_layer_name}")

    out_path = f"{GDB}\\{out_name}"
    if arcpy.Exists(out_path):
        arcpy.management.Delete(out_path)

    desc = arcpy.Describe(lyr)
    if desc.dataType == "FeatureLayer":
        arcpy.management.CopyFeatures(lyr, out_path)
    else:
        arcpy.management.CopyRows(lyr, out_path)
    return out_path


def create_relate(origin_fc: str, dest_table: str, origin_pk: str, dest_fk: str, cardinality: str):
    origin = f"{GDB}\\{origin_fc}"
    dest = f"{GDB}\\{dest_table}"
    rel_name = f"rel_{origin_fc}_to_{dest_table}"
    if arcpy.Exists(f"{GDB}\\{rel_name}"):
        arcpy.management.Delete(f"{GDB}\\{rel_name}")

    card = getattr(arcpy, cardinality, arcpy.OneToMany)
    arcpy.management.CreateRelationshipClass(
        origin,
        dest,
        f"{GDB}\\{rel_name}",
        "SIMPLE",
        forward_label=dest_table.replace("gis_", ""),
        backward_label=origin_fc.replace("gis_", ""),
        message_direction="FORWARD",
        cardinality=card,
        attribute_fields="",
        origin_primary_key=origin_pk,
        origin_foreign_key=dest_fk,
    )
    arcpy.AddMessage(f"Created {rel_name}")


def main():
    ensure_gdb()
    arcpy.AddMessage("Copy layers from the active map into the GDB, then create relates.")
    arcpy.AddMessage("Rename map layers to match gis.* view names before running copy_from_map_layer.")

    # Example: after manual copy, uncomment to create all center relates
    # for _origin, dest, opk, dfk, card in CENTER_RELATES:
    #     create_relate(_origin, dest, opk, dfk, card)


if __name__ == "__main__":
    main()
