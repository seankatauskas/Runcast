-- Preserve historical accepted tickets and receipts. Retired intents must never be retried.
UPDATE notification_deliveries
SET ticket_state = 'cancelled',
    last_error = 'Legacy planning retired before notification delivery',
    updated_at = now()
WHERE publication_id IS NULL
  AND ticket_state IN ('pending', 'retryable-error');
