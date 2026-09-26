-- Beta reset: authenticated beta data is intentionally discarded instead of
-- attempting to infer provider-neutral identities from Apple-owned users.
DELETE FROM users;

DROP TABLE oauth_states;

ALTER TABLE users DROP COLUMN apple_subject;
ALTER TABLE users RENAME COLUMN relay_email TO email;

ALTER TABLE users
  DROP COLUMN apple_refresh_token_encrypted;

CREATE TABLE auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('strava', 'apple')),
  provider_subject text NOT NULL,
  provider_refresh_token_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, provider_subject),
  CONSTRAINT auth_identities_provider_user_unique UNIQUE (provider, user_id)
);
CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);

ALTER TABLE strava_connections
  ADD CONSTRAINT strava_connections_athlete_id_unique UNIQUE (athlete_id);

CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('sign_in', 'link')),
  device_id text NOT NULL,
  state_hash text NOT NULL UNIQUE,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_states_purpose_user_check CHECK (
    (purpose = 'sign_in' AND user_id IS NULL) OR
    (purpose = 'link' AND user_id IS NOT NULL)
  )
);

CREATE TABLE strava_exchange_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  device_id text NOT NULL,
  is_new_user boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX strava_exchange_codes_expiry_idx ON strava_exchange_codes(expires_at);
