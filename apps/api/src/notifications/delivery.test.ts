import { describe, expect, it } from 'vitest';
import {
  MAX_PUSH_DELIVERY_ATTEMPTS,
  RETRYABLE_PUSH_TICKET_STATE,
  deliveryAttemptDecision,
} from './delivery';

describe('push delivery retry policy', () => {
  const now = Date.UTC(2026, 7, 16, 12);
  const closesAt = now + 60_000;

  it('allows pending and transient deliveries while attempts and time remain', () => {
    expect(deliveryAttemptDecision({ ticketState: 'pending', attempts: 0, closesAt, now })).toBe(
      'attempt',
    );
    expect(
      deliveryAttemptDecision({
        ticketState: RETRYABLE_PUSH_TICKET_STATE,
        attempts: MAX_PUSH_DELIVERY_ATTEMPTS - 1,
        closesAt,
        now,
      }),
    ).toBe('attempt');
  });

  it('stops after success, permanent failure, the attempt cap, or window close', () => {
    expect(deliveryAttemptDecision({ ticketState: 'ok', attempts: 1, closesAt, now })).toBe(
      'already-delivered',
    );
    expect(deliveryAttemptDecision({ ticketState: 'error', attempts: 1, closesAt, now })).toBe(
      'permanent-failure',
    );
    expect(
      deliveryAttemptDecision({
        ticketState: RETRYABLE_PUSH_TICKET_STATE,
        attempts: MAX_PUSH_DELIVERY_ATTEMPTS,
        closesAt,
        now,
      }),
    ).toBe('attempts-exhausted');
    expect(
      deliveryAttemptDecision({
        ticketState: RETRYABLE_PUSH_TICKET_STATE,
        attempts: 1,
        closesAt,
        now: closesAt,
      }),
    ).toBe('window-closed');
  });
});
