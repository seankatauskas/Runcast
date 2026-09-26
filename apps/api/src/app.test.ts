import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, cronHealth, schedulerRelease } from './app';

describe('API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a liveness probe without database access', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('exposes non-secret release identity and effective planner flags', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/release' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      release: { sha: expect.any(String), environment: expect.any(String) },
      planner: {
        mode: 'current',
        bundleReader: 3,
        canopyModelMode: 'active',
      },
    });
  });

  it('only exposes release identity actually persisted by the scheduler', () => {
    expect(
      schedulerRelease({
        acquired: true,
        release: { sha: 'abc123', environment: 'staging' },
      }),
    ).toEqual({ sha: 'abc123', environment: 'staging' });
    expect(schedulerRelease({ release: { sha: 'abc123' } })).toBeNull();
    expect(schedulerRelease(null)).toBeNull();
  });

  it.each([
    'evaluation',
    'unavailable',
    'receipts',
    'receipt-unavailable',
    'phase',
    'delivery',
    'deadline',
    'backlog',
  ])('reports a fresh but degraded scheduler for %s failures', (failure) => {
    const now = new Date('2026-09-19T12:00:00Z');
    const details = {
      evaluationFailures: failure === 'evaluation' ? 1 : 0,
      unavailableEvaluations: failure === 'unavailable' ? 1 : 0,
      receiptFailures: failure === 'receipts' ? 1 : 0,
      receiptUnavailable: failure === 'receipt-unavailable' ? 1 : 0,
      phaseFailures: failure === 'phase' ? ['receipts'] : [],
      deliveries: {
        attempted: 1,
        accepted: 0,
        expired: failure === 'deadline' ? 1 : 0,
        failed: 0,
        errors: failure === 'delivery' ? 1 : 0,
      },
      deliveryMetrics: {
        pendingDeliveries: 1,
        oldestPendingAgeMs: failure === 'backlog' ? 31 * 60_000 : 0,
        expiredDeliveries: 0,
        acceptedDeliveries: 0,
        receiptSuccesses: 0,
        receiptFailures: 0,
      },
    };
    const state = cronHealth({ lastSuccessAt: now, details }, now);
    expect(state.healthy).toBe(false);
    expect(state.body).toMatchObject({ status: 'degraded', outcomes: details });
    expect(
      cronHealth({ lastSuccessAt: new Date(now.getTime() - 31 * 60_000), details }, now).body
        .status,
    ).toBe('stale');
  });

  it('does not expose arbitrary persisted heartbeat details', () => {
    const now = new Date();
    const state = cronHealth(
      { lastSuccessAt: now, details: { secret: 'private', evaluationFailures: 'invalid' } },
      now,
    );
    expect(state.body).not.toHaveProperty('outcomes');
    expect(JSON.stringify(state.body)).not.toContain('private');
  });

  it('returns request IDs in structured errors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/nope',
      headers: { 'x-request-id': 'test-request' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.requestId).toBe('test-request');
  });

  it('replaces unsafe client request IDs before they can enter errors or logs', async () => {
    const unsafe = 'authorization=Bearer secret@example.com';
    const response = await app.inject({
      method: 'GET',
      url: '/v1/nope',
      headers: { 'x-request-id': unsafe },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.requestId).not.toBe(unsafe);
    expect(response.json().error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    {
      label: 'fresh',
      heartbeat: {
        lastSuccessAt: new Date('2026-08-15T12:40:00.000Z'),
        details: { release: { sha: 'test-sha', environment: 'staging' } },
      },
      status: 200,
      body: {
        status: 'ok',
        lastSuccessAt: '2026-08-15T12:40:00.000Z',
        schedulerRelease: { sha: 'test-sha', environment: 'staging' },
      },
    },
    {
      label: 'stale',
      heartbeat: {
        lastSuccessAt: new Date('2026-08-15T12:29:59.999Z'),
        details: { release: { sha: 'old-sha', environment: 'staging' } },
      },
      status: 503,
      body: {
        status: 'stale',
        lastSuccessAt: '2026-08-15T12:29:59.999Z',
        schedulerRelease: { sha: 'old-sha', environment: 'staging' },
      },
    },
  ])('reports a $label scheduler heartbeat from /health/cron', async (testCase) => {
    const healthApp = await buildApp({
      loadCronHeartbeat: async () => testCase.heartbeat,
      now: () => new Date('2026-08-15T13:00:00.000Z'),
    });
    try {
      const response = await healthApp.inject({ method: 'GET', url: '/health/cron' });
      expect(response.statusCode).toBe(testCase.status);
      expect(response.json()).toEqual(testCase.body);
    } finally {
      await healthApp.close();
    }
  });
});
