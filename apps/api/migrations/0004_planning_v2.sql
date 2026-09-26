ALTER TABLE routes
  ADD COLUMN canonical_route_v2 jsonb,
  ADD COLUMN route_quality_v2 jsonb,
  ADD COLUMN v2_content_identity text;

ALTER TABLE route_forecasts
  ADD COLUMN weather_v2 jsonb,
  ADD COLUMN provider_name text,
  ADD COLUMN provider_model text,
  ADD COLUMN provider_run text,
  ADD COLUMN fetch_identity text,
  ADD COLUMN content_identity text,
  ADD COLUMN normalization_version text,
  ADD COLUMN valid_from timestamptz,
  ADD COLUMN valid_until timestamptz,
  ADD COLUMN preparation_lease_owner text,
  ADD COLUMN preparation_lease_expires_at timestamptz;

CREATE INDEX route_forecasts_v2_validity_idx
  ON route_forecasts(valid_until)
  WHERE weather_v2 IS NOT NULL;
CREATE INDEX route_forecasts_preparation_lease_idx
  ON route_forecasts(preparation_lease_expires_at)
  WHERE preparation_lease_owner IS NOT NULL;

CREATE TABLE recommendation_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  watch_id uuid REFERENCES watches(id) ON DELETE CASCADE,
  occurrence_date date,
  predecessor_id uuid REFERENCES recommendation_evaluations(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('recommended', 'caution', 'no-suitable-window', 'unavailable')),
  winner jsonb,
  candidate_assessments jsonb NOT NULL,
  decision_time timestamptz NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  minimum_notice_ms integer NOT NULL CHECK (minimum_notice_ms >= 0),
  versions jsonb NOT NULL,
  input_hash text NOT NULL UNIQUE,
  planning_bundle_snapshot jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_evaluations_watch_occurrence_check CHECK (
    (watch_id IS NULL AND occurrence_date IS NULL) OR
    (watch_id IS NOT NULL AND occurrence_date IS NOT NULL)
  )
);
CREATE INDEX recommendation_evaluations_route_time_idx
  ON recommendation_evaluations(route_id, evaluated_at DESC);
CREATE INDEX recommendation_evaluations_watch_occurrence_idx
  ON recommendation_evaluations(watch_id, occurrence_date, evaluated_at DESC)
  WHERE watch_id IS NOT NULL;

CREATE TABLE notification_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL UNIQUE REFERENCES recommendation_evaluations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('recommended', 'caution', 'no-suitable-window')),
  title text NOT NULL,
  body text NOT NULL,
  deep_link text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_deliveries
  ADD COLUMN publication_id uuid REFERENCES notification_publications(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX notification_deliveries_publication_device_unique
  ON notification_deliveries(publication_id, device_id)
  WHERE publication_id IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_planning_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Account/route cascades execute below the initiating delete trigger depth
  -- and remain permitted for user-data deletion. Direct mutation is rejected.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER recommendation_evaluations_immutable
  BEFORE UPDATE OR DELETE ON recommendation_evaluations
  FOR EACH ROW EXECUTE FUNCTION reject_planning_snapshot_mutation();
CREATE TRIGGER notification_publications_immutable
  BEFORE UPDATE OR DELETE ON notification_publications
  FOR EACH ROW EXECUTE FUNCTION reject_planning_snapshot_mutation();

CREATE OR REPLACE FUNCTION reject_delivery_reference_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Foreign-key actions caused by account/route deletion remain permitted.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF (OLD.recommendation_id IS NOT NULL AND
      OLD.recommendation_id IS DISTINCT FROM NEW.recommendation_id) OR
     (OLD.publication_id IS NOT NULL AND
      OLD.publication_id IS DISTINCT FROM NEW.publication_id) THEN
    RAISE EXCEPTION 'notification delivery references are immutable once set'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_deliveries_references_immutable
  BEFORE UPDATE OF recommendation_id, publication_id ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION reject_delivery_reference_reassignment();
