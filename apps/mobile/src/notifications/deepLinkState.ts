export type DeepLinkTerminal = 'missing' | 'deleted' | 'offline' | 'signed-out';

export function missingRouteTerminal(input: {
  authenticated: boolean;
  syncOffline: boolean;
  wasKnown: boolean;
}): DeepLinkTerminal {
  if (!input.authenticated) return 'signed-out';
  if (input.syncOffline) return 'offline';
  return input.wasKnown ? 'deleted' : 'missing';
}

export function validDeepLinkStart(value: string | undefined): number | null {
  if (!value || !/^\d{10,16}$/.test(value)) return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}
