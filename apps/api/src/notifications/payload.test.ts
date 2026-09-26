import { randomUUID } from 'node:crypto';
import { notificationPayloadSchema } from '@runcast/contracts';
import { describe, expect, it } from 'vitest';
import { buildNotificationPayload } from './payload';

describe('watch notification payload', () => {
  it('carries stable route, watch, delivery, snapshot, start, and URL fields', () => {
    const routeId = randomUUID();
    const evaluationId = randomUUID();
    const startTime = Date.parse('2026-08-16T11:00:00.000Z');
    const payload = buildNotificationPayload({
      route: { id: routeId, name: 'Lakefront' },
      watch: { id: randomUUID(), occurrenceDate: '2026-08-16' },
      delivery: { id: randomUUID() },
      snapshot: { engine: 'planning-v2', id: evaluationId, status: 'caution' },
      startTime,
      query: { evaluation: evaluationId },
    });
    expect(notificationPayloadSchema.parse(payload)).toEqual(payload);
    expect(payload.start).toBe('2026-08-16T11:00:00.000Z');
    expect(new URL(payload.url).searchParams.get('start')).toBe(String(startTime));
    expect(new URL(payload.url).searchParams.get('evaluation')).toBe(evaluationId);
  });
});
