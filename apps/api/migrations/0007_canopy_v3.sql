CREATE TABLE route_canopy_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  coordinate_hash text NOT NULL,
  profile_v3 jsonb,
  content_hash text,
  source_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'preparing', 'ready', 'partial', 'failed', 'unsupported')),
  preparation_lease_owner text,
  preparation_lease_expires_at timestamptz,
  retry_after timestamptz,
  failure_code text,
  failure_detail text,
  acquired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, coordinate_hash, source_version)
);

CREATE INDEX route_canopy_profiles_lookup_idx
  ON route_canopy_profiles(route_id, coordinate_hash, source_version);
CREATE INDEX route_canopy_profiles_retry_idx
  ON route_canopy_profiles(retry_after)
  WHERE status = 'failed';
CREATE INDEX route_canopy_profiles_lease_idx
  ON route_canopy_profiles(preparation_lease_expires_at)
  WHERE preparation_lease_owner IS NOT NULL;
