import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../authenticate';
import { AppError } from '../errors';
import type { PlanningBundleService } from '../planning/service';
import { defaultPlanningBundleService } from '../planning/runtime';

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function planningBundleRoutes(
  app: FastifyInstance,
  service: PlanningBundleService = defaultPlanningBundleService(),
  authenticateHook: (request: FastifyRequest, reply: FastifyReply) => Promise<void> = authenticate,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/v2/routes/:id/planning-bundle',
    { preHandler: authenticateHook },
    async (request, reply) => {
      reply.header('vary', 'X-Runcast-Bundle-Reader, X-Runcast-Evaluator-Build');
      const result = await service.get({
        ownerId: request.auth.userId,
        routeId: request.params.id,
        reader: header(request.headers['x-runcast-bundle-reader']),
        evaluatorBuild: header(request.headers['x-runcast-evaluator-build']),
        ifNoneMatch: header(request.headers['if-none-match']),
      });
      request.log.info(
        {
          event: 'planning-bundle.response',
          routeId: request.params.id,
          state: result.status,
          evaluatorBuild: header(request.headers['x-runcast-evaluator-build']),
          bundleBytes:
            result.status === 'ready' ? Buffer.byteLength(JSON.stringify(result.bundle)) : null,
        },
        'planning bundle response',
      );
      switch (result.status) {
        case 'ready':
          return reply
            .header('etag', result.etag)
            .header('cache-control', 'private, no-cache')
            .code(200)
            .send(result.bundle);
        case 'not-modified':
          return reply
            .header('etag', result.etag)
            .header('cache-control', 'private, no-cache')
            .code(304)
            .send();
        case 'preparing':
          return reply
            .header('retry-after', String(result.retryAfterSeconds))
            .header('cache-control', 'no-store')
            .code(202)
            .send({ status: 'preparing', retryAfterSeconds: result.retryAfterSeconds });
        case 'update-required':
          throw new AppError(426, 'CLIENT_UPDATE_REQUIRED', result.reason);
        case 'unavailable':
          throw new AppError(503, 'FORECAST_UNAVAILABLE', result.reason);
        case 'not-found':
          throw new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found');
      }
    },
  );
}
