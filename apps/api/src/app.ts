import compress from '@fastify/compress';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { config } from './config';
import { sql } from './db/client';
import { db } from './db/client';
import { systemHeartbeats } from './db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from './errors';
import { redactedOperationalFields } from './observability';
import { authRoutes } from './routes/auth';
import { deviceRoutes } from './routes/devices';
import { preferenceRoutes } from './routes/preferences';
import { planningBundleRoutes } from './routes/planning';
import { routeRoutes } from './routes/routes';
import { stravaRoutes } from './routes/strava';
import { watchRoutes } from './routes/watches';

export function releaseDiagnostic() {
  return {
    release: {
      sha: config.release.sha,
      environment: config.release.environment,
    },
    planner: {
      mode: 'current',
      bundleReader: 3,
      canopyModelMode: config.canopyModelMode,
    },
  };
}

export interface SchedulerHeartbeat {
  lastSuccessAt: Date;
  details: unknown;
}

export interface BuildAppOptions {
  loadCronHeartbeat?: () => Promise<SchedulerHeartbeat | null>;
  now?: () => Date;
}

const countSchema = z.number().int().nonnegative();
const schedulerOutcomesSchema = z.object({
  evaluationFailures: countSchema,
  unavailableEvaluations: countSchema,
  receiptFailures: countSchema,
  receiptUnavailable: countSchema.optional(),
  phaseFailures: z.array(z.string()),
  deliveries: z.object({
    attempted: countSchema,
    accepted: countSchema,
    expired: countSchema,
    failed: countSchema,
    errors: countSchema,
    cancelled: countSchema.optional(),
  }),
  deliveryMetrics: z
    .object({
      pendingDeliveries: countSchema,
      oldestPendingAgeMs: z.number().nonnegative(),
      expiredDeliveries: countSchema,
      acceptedDeliveries: countSchema,
      receiptSuccesses: countSchema,
      receiptFailures: countSchema,
      receiptUnavailable: countSchema.optional(),
      pendingReceipts: countSchema.optional(),
      cancelledDeliveries: countSchema.optional(),
    })
    .optional(),
});

export function cronHealth(
  heartbeat: SchedulerHeartbeat | null,
  now = new Date(),
): {
  healthy: boolean;
  body: {
    status: 'ok' | 'stale' | 'degraded';
    lastSuccessAt: string | null;
    schedulerRelease: { sha: string; environment: string } | null;
    outcomes?: z.infer<typeof schedulerOutcomesSchema>;
  };
} {
  const fresh = Boolean(
    heartbeat && now.getTime() - heartbeat.lastSuccessAt.getTime() <= 30 * 60_000,
  );
  const outcomes = schedulerOutcomesSchema.safeParse(heartbeat?.details).data;
  const degraded = Boolean(
    outcomes &&
    (outcomes.evaluationFailures ||
      outcomes.unavailableEvaluations ||
      outcomes.receiptFailures ||
      outcomes.receiptUnavailable ||
      outcomes.phaseFailures.length ||
      outcomes.deliveries.errors ||
      outcomes.deliveries.failed ||
      outcomes.deliveries.expired ||
      (outcomes.deliveryMetrics?.oldestPendingAgeMs ?? 0) > 30 * 60_000),
  );
  return {
    healthy: fresh && !degraded,
    body: {
      status: !fresh ? 'stale' : degraded ? 'degraded' : 'ok',
      lastSuccessAt: heartbeat?.lastSuccessAt.toISOString() ?? null,
      schedulerRelease: schedulerRelease(heartbeat?.details),
      ...(outcomes ? { outcomes } : {}),
    },
  };
}

export function schedulerRelease(details: unknown): { sha: string; environment: string } | null {
  if (!details || typeof details !== 'object' || !('release' in details)) return null;
  const release = details.release;
  if (
    !release ||
    typeof release !== 'object' ||
    !('sha' in release) ||
    typeof release.sha !== 'string' ||
    !('environment' in release) ||
    typeof release.environment !== 'string'
  ) {
    return null;
  }
  return { sha: release.sha, environment: release.environment };
}

async function databaseCronHeartbeat(): Promise<SchedulerHeartbeat | null> {
  const heartbeat = await db.query.systemHeartbeats.findFirst({
    where: eq(systemHeartbeats.name, 'watch-scheduler'),
  });
  return heartbeat ? { lastSuccessAt: heartbeat.lastSuccessAt, details: heartbeat.details } : null;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 2_100_000,
    requestIdHeader: false,
    genReqId: (request) => {
      const candidate = request.headers['x-request-id'];
      return typeof candidate === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(candidate)
        ? candidate
        : randomUUID();
    },
    // Fastify's default request serializer includes the full URL. OAuth callbacks put
    // short-lived codes and state in that query string, so only explicit redacted events
    // are allowed to enter application logs.
    logController: new LogController({ disableRequestLogging: true }),
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'request.body',
                'response.body',
                '*.accessToken',
                '*.refreshToken',
                '*.identityToken',
                '*.authorizationCode',
                '*.expoPushToken',
                '*.gpx',
              ],
              censor: '[redacted]',
            },
          },
  });

  await app.register(cors, { origin: false });
  await app.register(compress, {
    global: true,
    encodings: ['gzip', 'deflate'],
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  if (config.openApiEnabled) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Runcast API', version: '1.0.0' },
        servers: [{ url: `http://localhost:${config.port}` }],
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/release', async () => ({ status: 'ok', ...releaseDiagnostic() }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await sql`select 1`;
      return { status: 'ready', ...releaseDiagnostic() };
    } catch {
      return reply.code(503).send({ status: 'unavailable', ...releaseDiagnostic() });
    }
  });
  app.get('/health/cron', async (request, reply) => {
    try {
      const state = cronHealth(
        await (options.loadCronHeartbeat ?? databaseCronHeartbeat)(),
        options.now?.() ?? new Date(),
      );
      return reply.code(state.healthy ? 200 : 503).send(state.body);
    } catch (error) {
      request.log.error(
        {
          event: 'cron.health-failed',
          ...redactedOperationalFields({ error, requestId: request.id }),
        },
        'cron health check failed',
      );
      return reply
        .code(503)
        .send({ status: 'unavailable', lastSuccessAt: null, schedulerRelease: null });
    }
  });

  await authRoutes(app);
  await preferenceRoutes(app);
  await stravaRoutes(app);
  await routeRoutes(app);
  await planningBundleRoutes(app);
  await watchRoutes(app);
  await deviceRoutes(app);

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint was not found',
        requestId: request.id,
      },
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    const appError =
      error instanceof AppError
        ? error
        : error instanceof ZodError
          ? new AppError(400, 'INVALID_REQUEST', 'Request is invalid', error.flatten())
          : error instanceof Error && 'statusCode' in error && error.statusCode === 413
            ? new AppError(413, 'BODY_TOO_LARGE', 'Request body is too large')
            : new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    if (appError.statusCode >= 500) {
      request.log.error(
        {
          event: 'api.request-failed',
          ...redactedOperationalFields({ error, requestId: request.id }),
        },
        'request failed',
      );
    }
    return reply.code(appError.statusCode).send({
      error: {
        code: appError.code,
        message: appError.message,
        requestId: request.id,
        ...(appError.details === undefined ? {} : { details: appError.details }),
      },
    });
  });

  return app;
}
