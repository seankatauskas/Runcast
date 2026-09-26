ALTER TABLE device_installations
  DROP CONSTRAINT device_installations_expo_push_token_key;

CREATE UNIQUE INDEX device_installations_enabled_token_unique
  ON device_installations(expo_push_token)
  WHERE enabled = true;

ALTER TABLE notification_deliveries
  ADD COLUMN payload jsonb;
