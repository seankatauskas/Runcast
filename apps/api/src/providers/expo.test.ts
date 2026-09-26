import { describe, expect, it } from 'vitest';
import { expoPushStatusIsRetryable, expoTicketErrorIsRetryable } from './expo';

describe('Expo push failure classification', () => {
  it('retries rate limits and server failures but not permanent HTTP failures', () => {
    expect(expoPushStatusIsRetryable(429)).toBe(true);
    expect(expoPushStatusIsRetryable(500)).toBe(true);
    expect(expoPushStatusIsRetryable(503)).toBe(true);
    expect(expoPushStatusIsRetryable(400)).toBe(false);
    expect(expoPushStatusIsRetryable(401)).toBe(false);
  });

  it('retries Expo message rate limits but not invalid tokens or credentials', () => {
    expect(expoTicketErrorIsRetryable('MessageRateExceeded')).toBe(true);
    expect(expoTicketErrorIsRetryable('DeviceNotRegistered')).toBe(false);
    expect(expoTicketErrorIsRetryable('InvalidCredentials')).toBe(false);
    expect(expoTicketErrorIsRetryable(undefined)).toBe(false);
  });
});
