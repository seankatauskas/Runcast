import { deviceInstallationSchema, type DeviceStatus } from '@runcast/contracts';
import { and, count, eq, ne, or, sql as querySql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../authenticate';
import { db } from '../db/client';
import { deviceInstallations, notificationDeliveries, watches } from '../db/schema';
import { AppError } from '../errors';
import { parseBody } from '../http';
import { logOperationalEvent } from '../observability';

type InstallationStatus = Pick<
  typeof deviceInstallations.$inferSelect,
  'platform' | 'appVersion' | 'enabled' | 'lastSeenAt'
>;

export function deviceStatusResponse(
  installation: InstallationStatus | null,
  enabledWatchCount: number,
): DeviceStatus {
  const state = !installation
    ? 'unregistered'
    : !installation.enabled
      ? 'disabled'
      : enabledWatchCount === 0
        ? 'no-enabled-watches'
        : 'ready';
  return {
    state,
    enabledWatchCount,
    installation: installation
      ? {
          platform: installation.platform as 'ios' | 'android',
          appVersion: installation.appVersion,
          enabled: installation.enabled,
          lastSeenAt: installation.lastSeenAt.toISOString(),
        }
      : null,
  };
}

async function currentStatus(userId: string, deviceId: string): Promise<DeviceStatus> {
  const [[installation], [watchCount]] = await Promise.all([
    db
      .select({
        platform: deviceInstallations.platform,
        appVersion: deviceInstallations.appVersion,
        enabled: deviceInstallations.enabled,
        lastSeenAt: deviceInstallations.lastSeenAt,
      })
      .from(deviceInstallations)
      .where(
        and(eq(deviceInstallations.userId, userId), eq(deviceInstallations.deviceId, deviceId)),
      )
      .limit(1),
    db
      .select({ value: count() })
      .from(watches)
      .where(and(eq(watches.userId, userId), eq(watches.enabled, true))),
  ]);
  return deviceStatusResponse(installation ?? null, watchCount?.value ?? 0);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/devices/current', { preHandler: authenticate }, async (request) =>
    currentStatus(request.auth.userId, request.auth.deviceId),
  );

  app.put('/v1/devices/current', { preHandler: authenticate }, async (request) => {
    const body = parseBody(deviceInstallationSchema, request);
    await db.transaction(async (tx) => {
      // Serialize token ownership changes so a rotated token can safely move to
      // the current authenticated installation without violating uniqueness.
      await tx.execute(
        querySql`select pg_advisory_xact_lock(hashtextextended(${body.expoPushToken}, 0))`,
      );
      if (body.enabled) {
        await tx
          .update(deviceInstallations)
          .set({ enabled: false, lastSeenAt: new Date() })
          .where(
            and(
              eq(deviceInstallations.expoPushToken, body.expoPushToken),
              or(
                ne(deviceInstallations.userId, request.auth.userId),
                ne(deviceInstallations.deviceId, request.auth.deviceId),
              ),
            ),
          );
      }
      await tx
        .insert(deviceInstallations)
        .values({
          userId: request.auth.userId,
          deviceId: request.auth.deviceId,
          expoPushToken: body.expoPushToken,
          platform: body.platform,
          appVersion: body.appVersion,
          enabled: body.enabled,
        })
        .onConflictDoUpdate({
          target: [deviceInstallations.userId, deviceInstallations.deviceId],
          set: {
            expoPushToken: body.expoPushToken,
            platform: body.platform,
            appVersion: body.appVersion,
            enabled: body.enabled,
            lastSeenAt: new Date(),
          },
        });
    });
    return currentStatus(request.auth.userId, request.auth.deviceId);
  });

  app.delete('/v1/devices/current', { preHandler: authenticate }, async (request, reply) => {
    await db
      .update(deviceInstallations)
      .set({ enabled: false, lastSeenAt: new Date() })
      .where(
        and(
          eq(deviceInstallations.userId, request.auth.userId),
          eq(deviceInstallations.deviceId, request.auth.deviceId),
        ),
      );
    return reply.code(204).send();
  });

  app.post<{ Params: { deliveryId: string } }>(
    '/v1/notifications/:deliveryId/opened',
    { preHandler: authenticate },
    async (request, reply) => {
      const [delivery] = await db
        .select({
          id: notificationDeliveries.id,
          watchId: notificationDeliveries.watchId,
          publicationId: notificationDeliveries.publicationId,
        })
        .from(notificationDeliveries)
        .innerJoin(watches, eq(watches.id, notificationDeliveries.watchId))
        .where(
          and(
            eq(notificationDeliveries.id, request.params.deliveryId),
            eq(watches.userId, request.auth.userId),
          ),
        )
        .limit(1);
      if (!delivery)
        throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Notification delivery was not found');
      await db
        .update(notificationDeliveries)
        .set({ openedAt: new Date(), updatedAt: new Date() })
        .where(eq(notificationDeliveries.id, delivery.id));
      logOperationalEvent('info', 'watch.notification-opened', {
        deliveryId: delivery.id,
        watchId: delivery.watchId,
        publicationId: delivery.publicationId,
      });
      return reply.code(204).send();
    },
  );
}
