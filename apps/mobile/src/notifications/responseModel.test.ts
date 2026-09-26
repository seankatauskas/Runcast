import { describe, expect, it } from 'vitest';
import { addHandledDelivery, parseNotificationResponseData } from './responseModel';

const payload = {
  schemaVersion: 1 as const,
  type: 'watch-recommendation' as const,
  route: { id: '018f9f9a-7b5e-7000-8000-000000000001', name: 'Lake Loop' },
  watch: {
    id: '018f9f9a-7b5e-7000-8000-000000000002',
    occurrenceDate: '2026-08-16',
  },
  delivery: { id: '018f9f9a-7b5e-7000-8000-000000000003' },
  snapshot: {
    engine: 'planning-v2' as const,
    id: '018f9f9a-7b5e-7000-8000-000000000004',
    status: 'recommended' as const,
  },
  start: '2026-08-16T12:00:00.000Z',
  url: 'runcast://routes/018f9f9a-7b5e-7000-8000-000000000001?start=1786881600000&evaluation=018f9f9a-7b5e-7000-8000-000000000004',
};

describe('notification response handling', () => {
  it('accepts the strict payload only when URL route, start, and snapshot agree', () => {
    expect(parseNotificationResponseData(payload)?.target).toBe(
      '/routes/018f9f9a-7b5e-7000-8000-000000000001?start=1786881600000',
    );
    expect(
      parseNotificationResponseData({
        ...payload,
        url: 'runcast://settings?start=1786881600000',
      }),
    ).toBeNull();
    expect(
      parseNotificationResponseData({
        ...payload,
        url: payload.url.replace('1786881600000', '1786881600001'),
      }),
    ).toBeNull();
    expect(parseNotificationResponseData({ ...payload, extra: 'not accepted' })).toBeNull();
  });

  it('keeps a bounded, newest-first exactly-once ledger', () => {
    expect(addHandledDelivery(['a', 'b', 'c'], 'b', 3)).toEqual(['b', 'a', 'c']);
    expect(addHandledDelivery(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('routes new planning notifications to the exact immutable result', () => {
    const exact = {
      ...payload,
      url: `runcast://watch-results/${payload.snapshot.id}?watch=${payload.watch.id}`,
    };
    expect(parseNotificationResponseData(exact)?.target).toBe(
      `/watch-results/${payload.snapshot.id}?watchId=${payload.watch.id}`,
    );
    expect(
      parseNotificationResponseData({
        ...exact,
        url: exact.url.replace(payload.watch.id, '018f9f9a-7b5e-7000-8000-000000000099'),
      }),
    ).toBeNull();
  });

  it('accepts only the strict legacy recommendation URL pairing during rollback', () => {
    const legacy = {
      ...payload,
      snapshot: {
        engine: 'legacy-v1' as const,
        id: '018f9f9a-7b5e-7000-8000-000000000005',
        status: 'recommended' as const,
      },
      url: 'runcast://routes/018f9f9a-7b5e-7000-8000-000000000001?start=1786881600000&recommendation=018f9f9a-7b5e-7000-8000-000000000005',
    };
    expect(parseNotificationResponseData(legacy)?.payload.snapshot.engine).toBe('legacy-v1');
    expect(
      parseNotificationResponseData({
        ...legacy,
        url: legacy.url.replace('recommendation=', 'evaluation='),
      }),
    ).toBeNull();
    expect(
      parseNotificationResponseData({
        ...payload,
        url: payload.url.replace('evaluation=', 'recommendation='),
      }),
    ).toBeNull();
  });
});
