ALTER TABLE preferences
  ADD COLUMN acceptable_start_minutes integer NOT NULL DEFAULT 300,
  ADD COLUMN acceptable_end_minutes integer NOT NULL DEFAULT 1320,
  ADD CONSTRAINT preferences_acceptable_start_minutes_check
    CHECK (acceptable_start_minutes >= 0 AND acceptable_start_minutes <= 1425 AND acceptable_start_minutes % 15 = 0),
  ADD CONSTRAINT preferences_acceptable_end_minutes_check
    CHECK (acceptable_end_minutes >= 0 AND acceptable_end_minutes <= 1425 AND acceptable_end_minutes % 15 = 0),
  ADD CONSTRAINT preferences_acceptable_start_window_check
    CHECK (acceptable_end_minutes - acceptable_start_minutes >= 60);
