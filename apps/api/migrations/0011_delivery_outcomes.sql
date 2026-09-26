ALTER TABLE notification_deliveries
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN receipt_received_at timestamptz;
--> statement-breakpoint
-- Historical enqueue time is not recorded; use the earliest known delivery event.
UPDATE notification_deliveries
SET created_at = COALESCE(sent_at, updated_at),
    receipt_received_at = CASE WHEN receipt_state IS NOT NULL THEN updated_at ELSE NULL END;
--> statement-breakpoint
CREATE INDEX notification_deliveries_pending_age_idx
ON notification_deliveries (created_at)
WHERE ticket_state IN ('pending', 'retryable-error');
