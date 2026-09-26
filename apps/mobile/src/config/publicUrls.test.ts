import { describe, expect, it } from 'vitest';
import { legalUrl, normalizedLegalBaseUrl } from './publicUrls';

describe('public legal URLs', () => {
  it('uses the temporary published host by default', () => {
    expect(normalizedLegalBaseUrl('')).toBe('https://runcast-legal.onrender.com');
  });

  it('normalizes an environment-specific host', () => {
    expect(normalizedLegalBaseUrl('https://legal.example.test///')).toBe(
      'https://legal.example.test',
    );
  });

  it('builds a supported legal path', () => {
    expect(legalUrl('privacy')).toMatch(/\/privacy$/);
  });
});
