CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apple_subject text NOT NULL UNIQUE,
  display_name text,
  relay_email text,
  apple_refresh_token_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_to_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_device_idx ON sessions(user_id, device_id);

CREATE TABLE strava_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  athlete_id text NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  units text NOT NULL DEFAULT 'imperial' CHECK (units IN ('imperial', 'metric')),
  temperature_unit text NOT NULL DEFAULT 'fahrenheit' CHECK (temperature_unit IN ('fahrenheit', 'celsius')),
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  default_speed real NOT NULL DEFAULT 3.04 CHECK (default_speed > 0 AND default_speed <= 15),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('gpx', 'strava')),
  provider_id text,
  canonical_route jsonb NOT NULL,
  name text NOT NULL,
  distance real NOT NULL CHECK (distance > 0),
  coverage_mask jsonb NOT NULL,
  import_status text NOT NULL DEFAULT 'ready' CHECK (import_status IN ('pending', 'ready', 'failed')),
  timezone text NOT NULL DEFAULT 'UTC',
  coordinate_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source, provider_id)
);
CREATE INDEX routes_owner_updated_idx ON routes(owner_id, updated_at DESC);

CREATE TABLE route_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL UNIQUE REFERENCES routes(id) ON DELETE CASCADE,
  coordinate_hash text NOT NULL,
  weather jsonb,
  fetched_at timestamptz,
  expires_at timestamptz,
  provider_status text NOT NULL DEFAULT 'pending',
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  weekdays integer NOT NULL CHECK (weekdays BETWEEN 1 AND 127),
  timezone text NOT NULL,
  start_minutes integer NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
  end_minutes integer NOT NULL CHECK (end_minutes BETWEEN 0 AND 1439 AND end_minutes - start_minutes >= 60),
  speed real NOT NULL CHECK (speed > 0 AND speed <= 15),
  lead_minutes integer NOT NULL DEFAULT 60 CHECK (lead_minutes IN (30, 60, 90)),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX watches_enabled_idx ON watches(enabled) WHERE enabled = true;

CREATE TABLE watch_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  best_start timestamptz NOT NULL,
  summary jsonb NOT NULL,
  engine_version text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, occurrence_date)
);

CREATE TABLE device_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  device_id uuid NOT NULL REFERENCES device_installations(id) ON DELETE CASCADE,
  recommendation_id uuid REFERENCES watch_recommendations(id) ON DELETE SET NULL,
  ticket_id text,
  ticket_state text NOT NULL DEFAULT 'pending',
  receipt_state text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  opened_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, occurrence_date, device_id)
);
CREATE INDEX notification_delivery_receipts_idx ON notification_deliveries(ticket_state, receipt_state);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  operation text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation, key)
);

CREATE TABLE deletion_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
