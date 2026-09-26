import { describe, expect, it } from 'vitest';
import { PUSH_DELIVERY_WINDOW_CLOSED } from './delivery';
import { publicationDeliveryOutcomes, summarizeDeliveryOutcomes } from './outcomes';

type Outcome = Parameters<typeof summarizeDeliveryOutcomes>[0][number];
const pending: Outcome = {
  ticketState: 'pending',
  sentAt: null,
  receiptState: null,
  receiptReceivedAt: null,
  lastError: null,
};
const date = (minute: number) => new Date(Date.UTC(2026, 8, 19, 12, minute));

describe('notification delivery outcomes', () => {
  it('reports no acceptance or receipt for a publication with no devices', () => {
    expect(summarizeDeliveryOutcomes([])).toEqual({
      providerAcceptedAt: null,
      receiptReceivedAt: null,
      acceptedCount: 0,
      receiptSuccessCount: 0,
      receiptFailureCount: 0,
      receiptUnavailableCount: 0,
      cancelledCount: 0,
      pendingCount: 0,
      expiredCount: 0,
      failedCount: 0,
    });
  });

  it('does not equate queued or retrying publication intents with provider acceptance', () => {
    expect(
      summarizeDeliveryOutcomes([
        pending,
        { ...pending, ticketState: 'retryable-error', lastError: 'Provider unavailable' },
      ]),
    ).toEqual({
      providerAcceptedAt: null,
      receiptReceivedAt: null,
      acceptedCount: 0,
      receiptSuccessCount: 0,
      receiptFailureCount: 0,
      receiptUnavailableCount: 0,
      cancelledCount: 0,
      pendingCount: 2,
      expiredCount: 0,
      failedCount: 0,
    });
  });

  it('uses the earliest actual acceptance across devices and excludes timestamps on failed sends', () => {
    expect(
      summarizeDeliveryOutcomes([
        { ...pending, ticketState: 'ok', sentAt: date(4) },
        { ...pending, ticketState: 'error', sentAt: date(0), lastError: 'Rejected' },
        { ...pending, ticketState: 'ok', sentAt: date(2) },
        { ...pending, ticketState: 'ok', sentAt: null },
      ]),
    ).toMatchObject({
      providerAcceptedAt: date(2).toISOString(),
      acceptedCount: 3,
      failedCount: 1,
      receiptReceivedAt: null,
    });
  });

  it('distinguishes provider acceptance, successful receipts, and failed receipts across devices', () => {
    expect(
      summarizeDeliveryOutcomes([
        {
          ...pending,
          ticketState: 'ok',
          sentAt: date(1),
          receiptState: 'error',
          receiptReceivedAt: date(7),
          lastError: 'DeviceNotRegistered',
        },
        {
          ...pending,
          ticketState: 'ok',
          sentAt: date(2),
          receiptState: 'ok',
          receiptReceivedAt: date(6),
        },
        { ...pending, ticketState: 'ok', sentAt: date(3) },
        pending,
      ]),
    ).toEqual({
      providerAcceptedAt: date(1).toISOString(),
      receiptReceivedAt: date(6).toISOString(),
      acceptedCount: 3,
      receiptSuccessCount: 1,
      receiptFailureCount: 1,
      receiptUnavailableCount: 0,
      cancelledCount: 0,
      pendingCount: 1,
      expiredCount: 0,
      failedCount: 0,
    });
  });

  it('counts missed deadlines separately from failed sends and pending retries', () => {
    expect(
      summarizeDeliveryOutcomes([
        { ...pending, ticketState: 'error', lastError: PUSH_DELIVERY_WINDOW_CLOSED },
        { ...pending, ticketState: 'error', lastError: 'Invalid push token' },
        { ...pending, ticketState: 'retryable-error', lastError: 'Rate limited' },
        pending,
      ]),
    ).toMatchObject({ expiredCount: 1, failedCount: 1, pendingCount: 2, acceptedCount: 0 });
  });

  it('keeps cancellations and unavailable receipts distinct from send or receipt failures', () => {
    expect(
      summarizeDeliveryOutcomes([
        { ...pending, ticketState: 'cancelled' },
        { ...pending, ticketState: 'ok', sentAt: date(1), receiptState: 'unavailable' },
      ]),
    ).toMatchObject({
      cancelledCount: 1,
      receiptUnavailableCount: 1,
      receiptFailureCount: 0,
      failedCount: 0,
      pendingCount: 0,
      receiptReceivedAt: null,
    });
  });

  it('returns no publication outcomes when no publication IDs are requested', async () => {
    expect(await publicationDeliveryOutcomes([])).toEqual(new Map());
  });
});
