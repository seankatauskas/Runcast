export type StravaCallback =
  | { type: 'code'; code: string }
  | { type: 'connected' }
  | { type: 'cancelled' }
  | { type: 'error'; code: string };

export function parseStravaCallbackUrl(value: string): StravaCallback {
  const url = new URL(value);
  if (
    url.protocol !== 'runcast:' ||
    !(
      (url.hostname === 'auth' && url.pathname === '/strava') ||
      (url.hostname === 'strava-routes' && (url.pathname === '' || url.pathname === '/'))
    )
  ) {
    throw new Error('Strava returned to an unexpected app route');
  }
  const error = url.searchParams.get('error');
  if (error) return { type: 'error', code: error.slice(0, 64) };
  const code = url.searchParams.get('code');
  if (code) {
    if (code.length < 32 || code.length > 512) throw new Error('Strava returned an invalid code');
    return { type: 'code', code };
  }
  if (url.searchParams.get('strava') === 'connected') return { type: 'connected' };
  if (url.searchParams.get('strava') === 'denied') return { type: 'cancelled' };
  throw new Error('Strava did not complete authentication');
}

export function stravaCallbackError(callback: Extract<StravaCallback, { type: 'error' }>): Error {
  if (callback.code === 'IDENTITY_ALREADY_LINKED') {
    return new Error('That Strava athlete is already linked to another Runcast account.');
  }
  return new Error('Strava could not complete authentication.');
}
