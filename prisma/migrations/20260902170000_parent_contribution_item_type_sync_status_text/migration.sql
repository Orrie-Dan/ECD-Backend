-- parent_contribution: item_type and sync_status → TEXT (GIS domain columns).
-- referral.sync_status keeps record_sync_status enum.

ALTER TABLE sde.parent_contribution
  ALTER COLUMN item_type TYPE TEXT USING item_type::text;

ALTER TABLE sde.parent_contribution
  ALTER COLUMN sync_status DROP DEFAULT;
ALTER TABLE sde.parent_contribution
  ALTER COLUMN sync_status TYPE TEXT USING sync_status::text;
ALTER TABLE sde.parent_contribution
  ALTER COLUMN sync_status SET DEFAULT 'synced';

DROP TYPE IF EXISTS public.in_kind_item_type;
