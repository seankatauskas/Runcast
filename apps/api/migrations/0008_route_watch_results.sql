ALTER TABLE recommendation_evaluations
  ADD COLUMN expected_flat_speed_ms real,
  ALTER COLUMN planning_bundle_snapshot DROP NOT NULL;

ALTER TABLE recommendation_evaluations
  DISABLE TRIGGER recommendation_evaluations_immutable;
UPDATE recommendation_evaluations AS evaluation
SET expected_flat_speed_ms = watch.speed
FROM watches AS watch
WHERE evaluation.watch_id = watch.id
  AND evaluation.expected_flat_speed_ms IS NULL;
ALTER TABLE recommendation_evaluations
  ENABLE TRIGGER recommendation_evaluations_immutable;

ALTER TABLE notification_publications
  ADD COLUMN watch_id uuid REFERENCES watches(id) ON DELETE CASCADE,
  ADD COLUMN occurrence_date date,
  ADD COLUMN revision integer CHECK (revision BETWEEN 1 AND 2),
  ADD COLUMN published_start timestamptz,
  ADD COLUMN superseded_publication_id uuid REFERENCES notification_publications(id) ON DELETE SET NULL;

ALTER TABLE notification_publications
  DISABLE TRIGGER notification_publications_immutable;
WITH delivered_publications AS (
  SELECT DISTINCT ON (publication.id)
    publication.id,
    delivery.watch_id,
    delivery.occurrence_date,
    COALESCE(
      to_timestamp((evaluation.winner->>'startTime')::double precision / 1000),
      evaluation.window_start
    ) AS published_start
  FROM notification_publications AS publication
  INNER JOIN recommendation_evaluations AS evaluation
    ON evaluation.id = publication.evaluation_id
  INNER JOIN notification_deliveries AS delivery
    ON delivery.publication_id = publication.id
  WHERE delivery.sent_at IS NOT NULL
  ORDER BY publication.id, delivery.sent_at
)
UPDATE notification_publications AS publication
SET watch_id = delivered.watch_id,
    occurrence_date = delivered.occurrence_date,
    revision = 1,
    published_start = delivered.published_start
FROM delivered_publications AS delivered
WHERE publication.id = delivered.id;
ALTER TABLE notification_publications
  ENABLE TRIGGER notification_publications_immutable;

CREATE UNIQUE INDEX notification_publications_watch_occurrence_revision_unique
  ON notification_publications(watch_id, occurrence_date, revision)
  WHERE revision IS NOT NULL;

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_watch_id_occurrence_date_device_id_key;
DROP INDEX IF EXISTS notification_delivery_occurrence_device_unique;
