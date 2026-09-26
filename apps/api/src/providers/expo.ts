import { EXPO_PUSH_TIMEOUT_MS, fetchWithDeadline } from '@runcast/core';
import { config } from '../config';
import { logOperationalEvent } from '../observability';

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export class ExpoPushProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ExpoPushProviderError';
  }
}

export function expoPushStatusIsRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function expoTicketErrorIsRetryable(error: string | undefined): boolean {
  return error === 'MessageRateExceeded';
}

function headers(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(config.expoAccessToken ? { authorization: `Bearer ${config.expoAccessToken}` } : {}),
  };
}

export async function sendExpoPush(message: {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<ExpoTicket> {
  try {
    const response = await fetchWithDeadline(
      'https://exp.host/--/api/v2/push/send',
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...message, sound: 'default', priority: 'high' }),
      },
      EXPO_PUSH_TIMEOUT_MS,
    );
    if (!response.ok) {
      logOperationalEvent('error', 'push.provider-send-failed', { status: response.status });
      throw new ExpoPushProviderError(
        `Expo push service returned ${response.status}`,
        expoPushStatusIsRetryable(response.status),
        response.status,
      );
    }
    const result = (await response.json()) as { data?: ExpoTicket };
    if (!result.data) {
      logOperationalEvent('error', 'push.provider-ticket-invalid');
      throw new ExpoPushProviderError('Expo push service returned an invalid ticket', true);
    }
    return result.data;
  } catch (error) {
    if (error instanceof ExpoPushProviderError) throw error;
    throw new ExpoPushProviderError(
      error instanceof Error ? error.message : 'Expo push request failed',
      true,
    );
  }
}

export async function fetchExpoReceipts(ids: string[]): Promise<Record<string, ExpoTicket>> {
  const response = await fetchWithDeadline(
    'https://exp.host/--/api/v2/push/getReceipts',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ids }),
    },
    EXPO_PUSH_TIMEOUT_MS,
  );
  if (!response.ok) {
    logOperationalEvent('error', 'push.provider-receipts-failed', { status: response.status });
    throw new Error(`Expo receipt service returned ${response.status}`);
  }
  const result = (await response.json()) as {
    data?: Record<string, ExpoTicket>;
  };
  return result.data ?? {};
}
