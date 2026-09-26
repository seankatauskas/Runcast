CREATE TABLE system_heartbeats (
  name text PRIMARY KEY,
  last_success_at timestamptz NOT NULL,
  details jsonb NOT NULL
);
