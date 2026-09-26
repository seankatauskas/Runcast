ALTER TABLE notification_deliveries
  ADD COLUMN receipt_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN receipt_next_check_at timestamptz;
--> statement-breakpoint
CREATE INDEX notification_delivery_receipt_due_idx
ON notification_deliveries (COALESCE(receipt_next_check_at, sent_at), id)
WHERE ticket_state = 'ok' AND receipt_state IS NULL;
