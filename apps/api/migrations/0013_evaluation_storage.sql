CREATE TABLE planning_bundle_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planning_bundle_artifacts_route_hash_unique UNIQUE(route_id, content_hash)
);
--> statement-breakpoint
ALTER TABLE recommendation_evaluations
  ADD COLUMN planning_bundle_id uuid REFERENCES planning_bundle_artifacts(id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT recommendation_evaluations_snapshot_storage_check
    CHECK (planning_bundle_id IS NULL OR planning_bundle_snapshot IS NULL);
--> statement-breakpoint
CREATE INDEX recommendation_evaluations_bundle_idx ON recommendation_evaluations(planning_bundle_id);
CREATE INDEX recommendation_evaluations_predecessor_idx ON recommendation_evaluations(predecessor_id);
CREATE INDEX recommendation_evaluations_retention_idx ON recommendation_evaluations(evaluated_at, window_end);
--> statement-breakpoint
-- Existing inline snapshots stay immutable and readable. New evaluations share artifacts.
CREATE OR REPLACE FUNCTION guard_evaluation_storage_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cutoff timestamptz;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
     AND NEW.predecessor_id IS NULL
     AND (to_jsonb(NEW) - 'predecessor_id') = (to_jsonb(OLD) - 'predecessor_id')
  THEN RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    cutoff := NULLIF(current_setting('runcast.evaluation_retention_cutoff', true), '')::timestamptz;
    IF cutoff IS NOT NULL AND cutoff <= now() - interval '7 days'
       AND OLD.evaluated_at < cutoff AND OLD.window_end < cutoff
       AND NOT EXISTS (SELECT 1 FROM notification_publications WHERE evaluation_id = OLD.id)
       AND NOT EXISTS (SELECT 1 FROM recommendation_evaluations WHERE predecessor_id = OLD.id)
    THEN RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER recommendation_evaluations_immutable ON recommendation_evaluations;
CREATE TRIGGER recommendation_evaluations_immutable
  BEFORE UPDATE OR DELETE ON recommendation_evaluations
  FOR EACH ROW EXECUTE FUNCTION guard_evaluation_storage_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_planning_bundle_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 OR NOT EXISTS (
      SELECT 1 FROM recommendation_evaluations WHERE planning_bundle_id = OLD.id
    ) THEN RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER planning_bundle_artifacts_immutable
  BEFORE UPDATE OR DELETE ON planning_bundle_artifacts
  FOR EACH ROW EXECUTE FUNCTION guard_planning_bundle_artifact_mutation();
