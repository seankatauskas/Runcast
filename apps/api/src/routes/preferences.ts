import { updatePreferencesSchema } from '@runcast/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../authenticate';
import { db } from '../db/client';
import { preferences } from '../db/schema';
import { AppError } from '../errors';
import { iso, parseBody } from '../http';

function response(row: typeof preferences.$inferSelect) {
  return {
    units: row.units,
    temperatureUnit: row.temperatureUnit,
    theme: row.theme,
    defaultSpeed: row.defaultSpeed,
    acceptableStartMinutes: row.acceptableStartMinutes,
    acceptableEndMinutes: row.acceptableEndMinutes,
    weeklyStartSchedule: row.weeklyStartSchedule,
    version: row.version,
    updatedAt: iso(row.updatedAt),
  };
}

export async function preferenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/me/preferences', { preHandler: authenticate }, async (request) => {
    const [row] = await db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, request.auth.userId))
      .limit(1);
    if (!row) throw new AppError(404, 'PREFERENCES_NOT_FOUND', 'Preferences were not found');
    return response(row);
  });

  app.put('/v1/me/preferences', { preHandler: authenticate }, async (request) => {
    const body = parseBody(updatePreferencesSchema, request);
    const [row] = await db
      .update(preferences)
      .set({
        units: body.units,
        temperatureUnit: body.temperatureUnit,
        theme: body.theme,
        defaultSpeed: body.defaultSpeed,
        acceptableStartMinutes: body.acceptableStartMinutes,
        acceptableEndMinutes: body.acceptableEndMinutes,
        // Older clients omit this field; preserve a schedule they cannot edit.
        ...(body.weeklyStartSchedule !== undefined
          ? { weeklyStartSchedule: body.weeklyStartSchedule }
          : {}),
        version: body.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(preferences.userId, request.auth.userId), eq(preferences.version, body.version)),
      )
      .returning();
    if (!row) {
      const [server] = await db
        .select()
        .from(preferences)
        .where(eq(preferences.userId, request.auth.userId))
        .limit(1);
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        'Preferences changed on another device',
        server ? response(server) : undefined,
      );
    }
    return response(row);
  });
}
