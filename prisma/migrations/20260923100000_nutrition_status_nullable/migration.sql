-- NUTR-WHO-03: stop requiring legacy absolute-MUAC nutrition_status on new screenings.
-- Historical values are preserved. WHO zones are calculated dynamically from measurements.

ALTER TABLE sde.child_nutrition_screening
  ALTER COLUMN nutrition_status DROP NOT NULL;
