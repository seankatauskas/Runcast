const DEFAULT_LEGAL_BASE_URL = 'https://runcast-legal.onrender.com';

export function normalizedLegalBaseUrl(value = process.env.EXPO_PUBLIC_LEGAL_BASE_URL): string {
  const candidate = value?.trim() || DEFAULT_LEGAL_BASE_URL;
  return candidate.replace(/\/+$/, '');
}

export function legalUrl(
  path: 'privacy' | 'support' | 'data-deletion' | 'forecast-disclaimer',
): string {
  return `${normalizedLegalBaseUrl()}/${path}`;
}
