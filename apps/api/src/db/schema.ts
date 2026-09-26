import type {
  CanopyEvidenceV3,
  NotificationPayload,
  PlanningBundleV2,
  PlanningBundleV3,
  RecommendationV2,
  RecommendationV3,
} from '@runcast/contracts';
import { sql } from 'drizzle-orm';
import type {
  CoverageMask,
  NormalizedRouteForecast,
  PlanningRoute,
  Route,
  RouteQuality,
  PlanningAlgorithmVersionManifest,
  PlanningAlgorithmVersionManifestV3,
  WeatherField,
} from '@runcast/core';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name'),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    providerRefreshTokenEncrypted: text('provider_refresh_token_encrypted'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('auth_identities_provider_subject_unique').on(
      table.provider,
      table.providerSubject,
    ),
    uniqueIndex('auth_identities_provider_user_unique').on(table.provider, table.userId),
    index('auth_identities_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedToId: uuid('rotated_to_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_refresh_hash_unique').on(table.refreshTokenHash),
    index('sessions_user_device_idx').on(table.userId, table.deviceId),
  ],
);

export const stravaConnections = pgTable('strava_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull().unique(),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scopes: text('scopes').array().notNull(),
  ...timestamps,
});

export const oauthStates = pgTable('oauth_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),
  deviceId: text('device_id').notNull(),
  stateHash: text('state_hash').notNull().unique(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stravaExchangeCodes = pgTable(
  'strava_exchange_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    deviceId: text('device_id').notNull(),
    isNewUser: boolean('is_new_user').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('strava_exchange_codes_hash_unique').on(table.codeHash),
    index('strava_exchange_codes_expiry_idx').on(table.expiresAt),
  ],
);

export const preferences = pgTable('preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  units: text('units').notNull().default('imperial'),
  temperatureUnit: text('temperature_unit').notNull().default('fahrenheit'),
  theme: text('theme').notNull().default('system'),
  defaultSpeed: real('default_speed').notNull().default(3.04),
  acceptableStartMinutes: integer('acceptable_start_minutes').notNull().default(300),
  acceptableEndMinutes: integer('acceptable_end_minutes').notNull().default(1320),
  weeklyStartSchedule:
    jsonb('weekly_start_schedule').$type<import('@runcast/core').WeeklyStartSchedule>(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const routes = pgTable(
  'routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    providerId: text('provider_id'),
    canonicalRoute: jsonb('canonical_route').$type<Route>().notNull(),
    canonicalRouteV2: jsonb('canonical_route_v2').$type<PlanningRoute>(),
    routeQualityV2: jsonb('route_quality_v2').$type<RouteQuality>(),
    v2ContentIdentity: text('v2_content_identity'),
    geometryIdentity: text('geometry_identity'),
    name: text('name').notNull(),
    distance: real('distance').notNull(),
    coverageMask: jsonb('coverage_mask').$type<CoverageMask>().notNull(),
    importStatus: text('import_status').notNull().default('ready'),
    timezone: text('timezone').notNull().default('UTC'),
    coordinateHash: text('coordinate_hash').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('routes_owner_provider_unique').on(table.ownerId, table.source, table.providerId),
    uniqueIndex('routes_owner_geometry_unique').on(table.ownerId, table.geometryIdentity),
    index('routes_owner_updated_idx').on(table.ownerId, table.updatedAt),
  ],
);

export const routeForecasts = pgTable('route_forecasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  routeId: uuid('route_id')
    .notNull()
    .unique()
    .references(() => routes.id, { onDelete: 'cascade' }),
  coordinateHash: text('coordinate_hash').notNull(),
  weather: jsonb('weather').$type<WeatherField>(),
  weatherV2: jsonb('weather_v2').$type<NormalizedRouteForecast>(),
  providerName: text('provider_name'),
  providerModel: text('provider_model'),
  providerRun: text('provider_run'),
  fetchIdentity: text('fetch_identity'),
  contentIdentity: text('content_identity'),
  normalizationVersion: text('normalization_version'),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  preparationLeaseOwner: text('preparation_lease_owner'),
  preparationLeaseExpiresAt: timestamp('preparation_lease_expires_at', {
    withTimezone: true,
  }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  providerStatus: text('provider_status').notNull().default('pending'),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const routeCanopyProfiles = pgTable(
  'route_canopy_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    coordinateHash: text('coordinate_hash').notNull(),
    profileV3: jsonb('profile_v3').$type<CanopyEvidenceV3>(),
    contentHash: text('content_hash'),
    sourceVersion: text('source_version').notNull(),
    status: text('status').notNull().default('pending'),
    preparationLeaseOwner: text('preparation_lease_owner'),
    preparationLeaseExpiresAt: timestamp('preparation_lease_expires_at', {
      withTimezone: true,
    }),
    retryAfter: timestamp('retry_after', { withTimezone: true }),
    failureCode: text('failure_code'),
    failureDetail: text('failure_detail'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('route_canopy_profiles_route_geometry_source_unique').on(
      table.routeId,
      table.coordinateHash,
      table.sourceVersion,
    ),
    index('route_canopy_profiles_lookup_idx').on(
      table.routeId,
      table.coordinateHash,
      table.sourceVersion,
    ),
    index('route_canopy_profiles_retry_idx')
      .on(table.retryAfter)
      .where(sql`${table.status} = 'failed'`),
    index('route_canopy_profiles_lease_idx')
      .on(table.preparationLeaseExpiresAt)
      .where(sql`${table.preparationLeaseOwner} IS NOT NULL`),
  ],
);

export const watches = pgTable(
  'watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    weekdays: integer('weekdays').notNull(),
    timezone: text('timezone').notNull(),
    startMinutes: integer('start_minutes').notNull(),
    endMinutes: integer('end_minutes').notNull(),
    speed: real('speed').notNull(),
    leadMinutes: integer('lead_minutes').notNull().default(60),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [index('watches_enabled_idx').on(table.enabled)],
);

export const watchRecommendations = pgTable(
  'watch_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchId: uuid('watch_id')
      .notNull()
      .references(() => watches.id, { onDelete: 'cascade' }),
    occurrenceDate: date('occurrence_date').notNull(),
    bestStart: timestamp('best_start', { withTimezone: true }).notNull(),
    summary: jsonb('summary').notNull(),
    engineVersion: text('engine_version').notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('watch_recommendation_occurrence_unique').on(table.watchId, table.occurrenceDate),
  ],
);

export const planningBundleArtifacts = pgTable(
  'planning_bundle_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    snapshot: jsonb('snapshot').$type<PlanningBundleV2 | PlanningBundleV3>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('planning_bundle_artifacts_route_hash_unique').on(table.routeId, table.contentHash),
  ],
);

export const recommendationEvaluations = pgTable(
  'recommendation_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    watchId: uuid('watch_id').references(() => watches.id, { onDelete: 'cascade' }),
    occurrenceDate: date('occurrence_date'),
    predecessorId: uuid('predecessor_id'),
    status: text('status')
      .$type<RecommendationV2['status'] | RecommendationV3['status']>()
      .notNull(),
    winner: jsonb('winner').$type<RecommendationV2['winner'] | RecommendationV3['winner']>(),
    candidateAssessments: jsonb('candidate_assessments')
      .$type<RecommendationV2['candidates'] | RecommendationV3['candidates']>()
      .notNull(),
    decisionTime: timestamp('decision_time', { withTimezone: true }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    minimumNoticeMs: integer('minimum_notice_ms').notNull(),
    versions: jsonb('versions')
      .$type<PlanningAlgorithmVersionManifest | PlanningAlgorithmVersionManifestV3>()
      .notNull(),
    inputHash: text('input_hash').notNull().unique(),
    planningBundleId: uuid('planning_bundle_id').references(() => planningBundleArtifacts.id),
    planningBundleSnapshot: jsonb('planning_bundle_snapshot').$type<
      PlanningBundleV2 | PlanningBundleV3
    >(),
    expectedFlatSpeedMs: real('expected_flat_speed_ms'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('recommendation_evaluations_bundle_idx').on(table.planningBundleId),
    index('recommendation_evaluations_predecessor_idx').on(table.predecessorId),
    index('recommendation_evaluations_route_time_idx').on(table.routeId, table.evaluatedAt),
    index('recommendation_evaluations_watch_occurrence_idx').on(
      table.watchId,
      table.occurrenceDate,
      table.evaluatedAt,
    ),
  ],
);

export const notificationPublications = pgTable(
  'notification_publications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .unique()
      .references(() => recommendationEvaluations.id, { onDelete: 'cascade' }),
    watchId: uuid('watch_id').references(() => watches.id, { onDelete: 'cascade' }),
    occurrenceDate: date('occurrence_date'),
    revision: integer('revision').$type<1 | 2>(),
    publishedStart: timestamp('published_start', { withTimezone: true }),
    supersededPublicationId: uuid('superseded_publication_id').references(
      (): AnyPgColumn => notificationPublications.id,
      { onDelete: 'set null' },
    ),
    status: text('status').$type<Exclude<RecommendationV2['status'], 'unavailable'>>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    deepLink: text('deep_link').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'notification_publications_revision_check',
      sql`${table.revision} IS NULL OR ${table.revision} BETWEEN 1 AND 2`,
    ),
    uniqueIndex('notification_publications_watch_occurrence_revision_unique')
      .on(table.watchId, table.occurrenceDate, table.revision)
      .where(sql`${table.revision} IS NOT NULL`),
  ],
);

export const deviceInstallations = pgTable(
  'device_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    expoPushToken: text('expo_push_token').notNull(),
    platform: text('platform').notNull(),
    appVersion: text('app_version').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('device_installations_user_device_unique').on(table.userId, table.deviceId),
    uniqueIndex('device_installations_enabled_token_unique')
      .on(table.expoPushToken)
      .where(sql`${table.enabled} = true`),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchId: uuid('watch_id')
      .notNull()
      .references(() => watches.id, { onDelete: 'cascade' }),
    occurrenceDate: date('occurrence_date').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => deviceInstallations.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id').references(() => watchRecommendations.id, {
      onDelete: 'set null',
    }),
    publicationId: uuid('publication_id').references(() => notificationPublications.id, {
      onDelete: 'set null',
    }),
    ticketId: text('ticket_id'),
    ticketState: text('ticket_state').notNull().default('pending'),
    receiptState: text('receipt_state'),
    receiptAttempts: integer('receipt_attempts').notNull().default(0),
    receiptNextCheckAt: timestamp('receipt_next_check_at', { withTimezone: true }),
    receiptReceivedAt: timestamp('receipt_received_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    payload: jsonb('payload').$type<NotificationPayload>(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_deliveries_publication_device_unique').on(
      table.publicationId,
      table.deviceId,
    ),
    index('notification_delivery_receipts_idx').on(table.ticketState, table.receiptState),
    index('notification_delivery_receipt_due_idx')
      .on(sql`coalesce(${table.receiptNextCheckAt}, ${table.sentAt})`, table.id)
      .where(sql`${table.ticketState} = 'ok' AND ${table.receiptState} IS NULL`),
    index('notification_deliveries_pending_age_idx')
      .on(table.createdAt)
      .where(sql`${table.ticketState} IN ('pending', 'retryable-error')`),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    operation: text('operation').notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idempotency_user_operation_key_unique').on(
      table.userId,
      table.operation,
      table.key,
    ),
  ],
);

export const deletionAudits = pgTable('deletion_audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const systemHeartbeats = pgTable('system_heartbeats', {
  name: text('name').primaryKey(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }).notNull(),
  details: jsonb('details').notNull(),
});
