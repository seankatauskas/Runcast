import { z } from 'zod';
import { runPlanV2Schema } from './v2';
import { runPlanV3Schema, planningBundleV3Schema } from './v3';

export * from './v2';
export * from './v3';

const uuid = z.string().uuid();
const utcDateTime = z.string().datetime({ offset: true });
const finite = z.number().finite();

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(500),
        requestId: z.string().min(1).max(128),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export const routePointSchema = z
  .object({
    lat: finite.min(-90).max(90),
    lon: finite.min(-180).max(180),
    ele: finite,
  })
  .strict();

export const routeSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    points: z.array(routePointSchema).min(2).max(20_000),
    cumulative: z.array(finite.nonnegative()).min(2).max(20_000),
    totalDistance: finite.positive(),
  })
  .strict()
  .superRefine((route, ctx) => {
    if (route.points.length !== route.cumulative.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'points and cumulative must align',
      });
    }
    if (route.cumulative[0] !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cumulative must start at zero',
      });
    }
  });

export const coverageMaskSchema = z
  .object({
    resolution: finite.positive(),
    values: z
      .array(z.enum(['open', 'tree', 'unknown']))
      .min(1)
      .max(20_000),
  })
  .strict();

const hourlySeriesSchema = z
  .object({
    time: z.array(finite),
    temp: z.array(finite),
    feelsLike: z.array(finite),
    humidity: z.array(finite),
    windSpeed: z.array(finite),
    windDirFrom: z.array(finite),
    gust: z.array(finite),
    cloudCover: z.array(finite),
    precipProb: z.array(finite),
    precip: z.array(finite),
    weatherCode: z.array(finite),
  })
  .strict();

export const weatherFieldSchema = z
  .object({
    anchors: z
      .array(
        z
          .object({
            routeDistance: finite.nonnegative(),
            lat: finite.min(-90).max(90),
            lon: finite.min(-180).max(180),
            hourly: hourlySeriesSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
    fetchedAt: finite,
  })
  .strict();

const acceptableStartMinute = z
  .number()
  .int()
  .min(0)
  .max(23 * 60 + 45)
  .refine((minutes) => minutes % 15 === 0, 'Start times use 15-minute increments');

const scheduleMinute = z.number().int().min(0).max(1440).multipleOf(15);
const scheduledWindowSchema = z
  .object({
    startMinutes: scheduleMinute,
    endMinutes: scheduleMinute,
  })
  .strict()
  .refine((window) => window.endMinutes - window.startMinutes >= 15, {
    message: 'Availability blocks must be at least 15 minutes',
  });
const scheduledDaySchema = z
  .array(scheduledWindowSchema)
  .max(96)
  .refine(
    (blocks) =>
      blocks.every(
        (block, index) => index === 0 || block.startMinutes >= blocks[index - 1].endMinutes,
      ),
    { message: 'Availability blocks must be ordered and must not overlap' },
  );

export const weeklyStartScheduleSchema = z
  .object({
    mon: scheduledDaySchema,
    tue: scheduledDaySchema,
    wed: scheduledDaySchema,
    thu: scheduledDaySchema,
    fri: scheduledDaySchema,
    sat: scheduledDaySchema,
    sun: scheduledDaySchema,
  })
  .strict();

const preferenceValueShape = {
  units: z.enum(['imperial', 'metric']),
  temperatureUnit: z.enum(['fahrenheit', 'celsius']),
  theme: z.enum(['system', 'light', 'dark']),
  defaultSpeed: finite.positive().max(15),
  acceptableStartMinutes: acceptableStartMinute.default(5 * 60),
  acceptableEndMinutes: acceptableStartMinute.default(22 * 60),
  weeklyStartSchedule: weeklyStartScheduleSchema.nullable().optional(),
};

function validateAcceptableStartWindow(
  value: { acceptableStartMinutes: number; acceptableEndMinutes: number },
  context: z.RefinementCtx,
): void {
  if (value.acceptableEndMinutes - value.acceptableStartMinutes >= 60) return;
  context.addIssue({
    code: 'custom',
    path: ['acceptableEndMinutes'],
    message: 'Acceptable start window must be at least one hour',
  });
}

export const preferencesSchema = z
  .object({
    ...preferenceValueShape,
    version: z.number().int().positive(),
    updatedAt: utcDateTime,
  })
  .strict()
  .superRefine(validateAcceptableStartWindow);

export const updatePreferencesSchema = z
  .object({
    ...preferenceValueShape,
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine(validateAcceptableStartWindow);

export const appleIdentityRequestSchema = z
  .object({
    identityToken: z.string().min(32).max(16_384),
    authorizationCode: z.string().min(1).max(4096),
    nonce: z.string().min(16).max(256),
    displayName: z.string().min(1).max(200).optional(),
    email: z.string().email().max(320).optional(),
  })
  .strict();

export const appleAuthRequestSchema = appleIdentityRequestSchema
  .extend({ deviceId: z.string().min(8).max(200) })
  .strict();

export const authTokensSchema = z
  .object({
    accessToken: z.string().min(1),
    accessTokenExpiresAt: utcDateTime,
    refreshToken: z.string().min(32),
    refreshTokenExpiresAt: utcDateTime,
    user: z
      .object({
        id: uuid,
        displayName: z.string().nullable(),
        email: z.string().nullable(),
      })
      .strict(),
    isNewUser: z.boolean(),
  })
  .strict();

export const refreshRequestSchema = z
  .object({
    refreshToken: z.string().min(32).max(512),
    deviceId: z.string().min(8).max(200),
  })
  .strict();

export const logoutRequestSchema = z
  .object({
    refreshToken: z.string().min(32).max(512).optional(),
    allDevices: z.boolean().default(false),
  })
  .strict();

export const routeOriginSchema = z.enum(['demo', 'local', 'cloud-gpx', 'cloud-strava']);

export const routeSummarySchema = z
  .object({
    id: uuid,
    name: z.string(),
    source: z.enum(['gpx', 'strava']),
    origin: z.enum(['cloud-gpx', 'cloud-strava']),
    providerId: z.string().nullable(),
    geometryIdentity: z.string().min(1).max(200),
    distance: finite.nonnegative(),
    importStatus: z.enum(['pending', 'ready', 'failed']),
    version: z.number().int().positive(),
    createdAt: utcDateTime,
    updatedAt: utcDateTime,
  })
  .strict();

/** Route geometry and local timezone remain usable while weather is preparing. */
export const routeDescriptorSchema = z
  .object({
    summary: routeSummarySchema,
    timezone: z.string().min(1).max(100),
    route: planningBundleV3Schema.shape.route,
    woodlandEvidence: planningBundleV3Schema.shape.environment.shape.coverage,
  })
  .strict();
export type RouteDescriptor = z.infer<typeof routeDescriptorSchema>;

export const routeImportResultSchema = routeSummarySchema
  .extend({ deduplicated: z.boolean() })
  .strict();

export const routeListSchema = z.object({ routes: z.array(routeSummarySchema) }).strict();

export const createGpxRouteSchema = z
  .object({
    gpx: z.string().min(20).max(2_000_000),
    name: z.string().min(1).max(200).optional(),
    clientRouteId: uuid.optional(),
    coverage: coverageMaskSchema.optional(),
    idempotencyKey: z.string().min(8).max(200).optional(),
  })
  .strict();

export const updateRouteSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .transform((name) => name.replace(/\s+/g, ' ')),
    version: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(8).max(200).optional(),
  })
  .strict();

export const routeBundleSchema = z
  .object({
    route: routeSchema,
    coverage: coverageMaskSchema,
    weather: weatherFieldSchema.nullable(),
    timezone: z.string().min(1).max(100),
    etag: z.string(),
    weatherFetchedAt: utcDateTime.nullable(),
    weatherExpiresAt: utcDateTime.nullable(),
    version: z.number().int().positive(),
  })
  .strict();

export const watchConfigurationSchema = z
  .object({
    id: uuid,
    routeId: uuid,
    weekdays: z.number().int().min(1).max(127),
    timezone: z.string().min(1).max(100),
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes: z.number().int().min(0).max(1439),
    speed: finite.positive().max(15),
    leadMinutes: z.union([z.literal(30), z.literal(60), z.literal(90)]),
    enabled: z.boolean(),
    version: z.number().int().positive(),
    createdAt: utcDateTime,
    updatedAt: utcDateTime,
  })
  .strict();

function validateWatchWindow(
  watch: { startMinutes: number; endMinutes: number },
  ctx: z.RefinementCtx,
): void {
  if (watch.endMinutes - watch.startMinutes < 60) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Watch window must be at least 60 minutes',
    });
  }
}

function validateQuarterHourWatchWindow(
  watch: { startMinutes?: number; endMinutes?: number },
  ctx: z.RefinementCtx,
): void {
  for (const field of ['startMinutes', 'endMinutes'] as const) {
    const value = watch[field];
    if (value !== undefined && value % 15 !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} must be on a 15-minute boundary`,
      });
    }
  }
}

const watchOccurrenceSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    windowStart: utcDateTime,
    windowEnd: utcDateTime,
  })
  .strict();

export const watchSchema = watchConfigurationSchema
  .extend({
    weekdayNames: z.array(
      z.enum(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']),
    ),
    nextOccurrence: watchOccurrenceSchema.nullable(),
  })
  .strict()
  .superRefine(validateWatchWindow);

export const createWatchSchema = watchConfigurationSchema
  .pick({
    routeId: true,
    weekdays: true,
    timezone: true,
    startMinutes: true,
    endMinutes: true,
    speed: true,
    leadMinutes: true,
    enabled: true,
  })
  .extend({ idempotencyKey: z.string().min(8).max(200).optional() })
  .strict()
  .superRefine((watch, ctx) => {
    validateWatchWindow(watch, ctx);
    validateQuarterHourWatchWindow(watch, ctx);
  });

export const updateWatchSchema = watchConfigurationSchema
  .pick({
    weekdays: true,
    timezone: true,
    startMinutes: true,
    endMinutes: true,
    speed: true,
    leadMinutes: true,
    enabled: true,
    version: true,
  })
  .partial({
    weekdays: true,
    timezone: true,
    startMinutes: true,
    endMinutes: true,
    speed: true,
    leadMinutes: true,
    enabled: true,
  })
  .extend({ idempotencyKey: z.string().min(8).max(200).optional() })
  .strict()
  .superRefine(validateQuarterHourWatchWindow);

export const watchResultStatusSchema = z.enum([
  'recommended',
  'caution',
  'no-suitable-window',
  'unavailable',
]);

export const watchResultSummarySchema = z
  .object({
    evaluationId: uuid,
    watchId: uuid,
    occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: watchResultStatusSchema,
    recommendedStart: utcDateTime.nullable(),
    evaluatedAt: utcDateTime,
    forecastFetchedAt: utcDateTime.nullable(),
    reasonCodes: z.array(z.string().min(1).max(160)),
    notificationRevision: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    notifiedAt: utcDateTime.nullable(),
  })
  .strict();

export const watchResultDetailSchema = watchResultSummarySchema
  .extend({
    windowStart: utcDateTime,
    windowEnd: utcDateTime,
    expectedFlatSpeedMs: finite.positive().max(15),
    runPlan: z.union([runPlanV2Schema, runPlanV3Schema]).nullable(),
  })
  .strict();

// Separate endpoint keeps existing strict V1 result readers compatible.
export const watchNotificationStatusSchema = z
  .object({
    evaluationId: uuid,
    publicationId: uuid.nullable(),
    publishedAt: utcDateTime.nullable(),
    providerAcceptedAt: utcDateTime.nullable(),
    receiptReceivedAt: utcDateTime.nullable(),
    acceptedCount: z.number().int().nonnegative(),
    receiptSuccessCount: z.number().int().nonnegative(),
    receiptFailureCount: z.number().int().nonnegative(),
    receiptUnavailableCount: z.number().int().nonnegative(),
    cancelledCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    expiredCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
  })
  .strict();

export const watchListResponseSchema = z
  .object({
    watches: z.array(watchSchema),
    latestResults: z.array(watchResultSummarySchema),
  })
  .strict();

export const watchResultListResponseSchema = z
  .object({ results: z.array(watchResultSummarySchema).max(7) })
  .strict();

export const deviceInstallationSchema = z
  .object({
    expoPushToken: z
      .string()
      .regex(/^Expo(?:nent)?PushToken\[[^\]]+\]$/)
      .max(256),
    platform: z.enum(['ios', 'android']),
    appVersion: z.string().min(1).max(50),
    enabled: z.boolean().default(true),
  })
  .strict();

export const deviceReadinessStateSchema = z.enum([
  'unregistered',
  'disabled',
  'no-enabled-watches',
  'ready',
]);

export const deviceStatusSchema = z
  .object({
    state: deviceReadinessStateSchema,
    enabledWatchCount: z.number().int().nonnegative(),
    installation: z
      .object({
        platform: z.enum(['ios', 'android']),
        appVersion: z.string().min(1).max(50),
        enabled: z.boolean(),
        lastSeenAt: utcDateTime,
      })
      .strict()
      .nullable(),
  })
  .strict();

const notificationSnapshotSchema = z.discriminatedUnion('engine', [
  z
    .object({
      engine: z.literal('planning-v2'),
      id: uuid,
      status: z.enum(['recommended', 'caution', 'no-suitable-window']),
    })
    .strict(),
  z
    .object({
      engine: z.literal('legacy-v1'),
      id: uuid,
      status: z.enum(['recommended', 'no-suitable-window']),
    })
    .strict(),
]);

/** The only data payload accepted by Runcast watch notifications. */
export const notificationPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('watch-recommendation'),
    route: z.object({ id: uuid, name: z.string().min(1).max(200) }).strict(),
    watch: z.object({ id: uuid, occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
    delivery: z.object({ id: uuid }).strict(),
    snapshot: notificationSnapshotSchema,
    start: utcDateTime,
    url: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          return new URL(value).protocol === 'runcast:';
        } catch {
          return false;
        }
      }, 'url must be a runcast deep link'),
  })
  .strict();

export const stravaAuthorizationSchema = z
  .object({ redirectUri: z.string().url().max(2048) })
  .strict();

export const stravaAuthAuthorizationRequestSchema = z
  .object({
    purpose: z.enum(['sign_in', 'link']),
    deviceId: z.string().min(8).max(200),
    redirectUri: z.string().url().max(2048),
  })
  .strict();

export const stravaAuthorizationResponseSchema = z
  .object({
    authorizationUrl: z.string().url().max(4096),
    expiresAt: utcDateTime,
  })
  .strict();

export const stravaExchangeRequestSchema = z
  .object({
    code: z.string().min(32).max(512),
    deviceId: z.string().min(8).max(200),
  })
  .strict();

export const authProviderSchema = z.enum(['strava', 'apple']);

export const identityStatusSchema = z
  .object({ providers: z.array(authProviderSchema).max(2) })
  .strict()
  .superRefine(({ providers }, ctx) => {
    if (new Set(providers).size !== providers.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'providers must be unique' });
    }
  });

export const stravaImportSchema = z
  .object({ idempotencyKey: z.string().min(8).max(200).optional() })
  .strict();

export const stravaRouteSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    distance: finite.nonnegative(),
    private: z.boolean(),
  })
  .strict();

export const integrationStatusSchema = z
  .object({
    connected: z.boolean(),
    athleteId: z.string().nullable(),
    scopes: z.array(z.string()),
  })
  .strict();

export type ApiError = z.infer<typeof apiErrorSchema>;
export type AppleAuthRequest = z.infer<typeof appleAuthRequestSchema>;
export type AppleIdentityRequest = z.infer<typeof appleIdentityRequestSchema>;
export type AuthTokens = z.infer<typeof authTokensSchema>;
export type AuthProvider = z.infer<typeof authProviderSchema>;
export type IdentityStatus = z.infer<typeof identityStatusSchema>;
export type StravaAuthAuthorizationRequest = z.infer<typeof stravaAuthAuthorizationRequestSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type RouteBundle = z.infer<typeof routeBundleSchema>;
export type RouteSummary = z.infer<typeof routeSummarySchema>;
export type RouteImportResult = z.infer<typeof routeImportResultSchema>;
export type RouteOrigin = z.infer<typeof routeOriginSchema>;
export type Watch = z.infer<typeof watchSchema>;
export type CreateWatch = z.infer<typeof createWatchSchema>;
export type UpdateWatch = z.infer<typeof updateWatchSchema>;
export type WatchResultStatus = z.infer<typeof watchResultStatusSchema>;
export type WatchResultSummary = z.infer<typeof watchResultSummarySchema>;
export type WatchResultDetail = z.infer<typeof watchResultDetailSchema>;
export type WatchListResponse = z.infer<typeof watchListResponseSchema>;
export type DeviceInstallation = z.infer<typeof deviceInstallationSchema>;
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
export type StravaRoute = z.infer<typeof stravaRouteSchema>;
