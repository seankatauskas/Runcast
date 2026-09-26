import { describe, expect, it } from 'vitest';
import { operationalEvent } from './observability';

describe('operationalEvent', () => {
  it('retains references and outcomes while redacting provider/user material', () => {
    expect(
      operationalEvent('error', 'push.ticket-error', {
        requestId: 'request-1',
        deliveryId: 'delivery-1',
        routeName: 'Home loop',
        expoPushToken: 'ExponentPushToken[secret]',
        providerPayload: { route: [41.1, -87.6] },
        error: new Error('network failed'),
      }),
    ).toEqual({
      level: 'error',
      event: 'push.ticket-error',
      requestId: 'request-1',
      deliveryId: 'delivery-1',
      routeName: '[redacted]',
      expoPushToken: '[redacted]',
      providerPayload: '[redacted]',
      error: { name: 'Error' },
    });
  });
});
