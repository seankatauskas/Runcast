ALTER TABLE routes ADD COLUMN geometry_identity text;

-- Backfill one canonical row for each existing exact geometry. Casting JSON
-- numbers through float8 matches JavaScript's number serialization, and the
-- whitespace-free JSON array matches the shared canonical identity input.
WITH route_points AS (
  SELECT
    r.id,
    r.owner_id,
    r.updated_at,
    encode(
      digest(
        replace(
          jsonb_agg(
            jsonb_build_array(
              (point.value->>'lat')::double precision,
              (point.value->>'lon')::double precision,
              CASE
                WHEN r.canonical_route_v2 IS NOT NULL
                  THEN (point.value->>'elevationM')::double precision
                ELSE (point.value->>'ele')::double precision
              END
            ) ORDER BY point.ordinality
          )::text,
          ' ',
          ''
        ),
        'sha256'
      ),
      'hex'
    ) AS identity
  FROM routes r
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN r.canonical_route_v2 IS NOT NULL
        THEN r.canonical_route_v2->'part'->'points'
      ELSE r.canonical_route->'points'
    END
  ) WITH ORDINALITY AS point(value, ordinality)
  GROUP BY r.id, r.owner_id, r.updated_at
), ranked AS (
  SELECT
    id,
    identity,
    row_number() OVER (
      PARTITION BY owner_id, identity
      ORDER BY updated_at DESC, id
    ) AS duplicate_rank
  FROM route_points
)
UPDATE routes
SET geometry_identity = ranked.identity
FROM ranked
WHERE routes.id = ranked.id AND ranked.duplicate_rank = 1;

CREATE UNIQUE INDEX routes_owner_geometry_unique
  ON routes(owner_id, geometry_identity)
  WHERE geometry_identity IS NOT NULL;
