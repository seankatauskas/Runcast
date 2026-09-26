import { describe, expect, it } from 'vitest';
import { presentWeatherAlert } from './alertPresentation';

describe('presentWeatherAlert', () => {
  it.each([
    ['thunderstorm', 1, 'Thunderstorm', 'Lightning'],
    ['heavy-rain', 8, 'Heavy rain', '0.3 in/h'],
    ['extreme-heat', 37, 'High heat', '99°'],
    ['high-wind', 10, 'High wind', '22 mph'],
  ] as const)('presents %s warnings consistently', (kind, peak, title, metric) => {
    expect(presentWeatherAlert({ kind, peak }, 'imperial', 'fahrenheit')).toMatchObject({
      title,
      metric,
    });
  });

  it('formats warning measurements using metric preferences', () => {
    expect(presentWeatherAlert({ kind: 'high-wind', peak: 10 }, 'metric', 'celsius').metric).toBe(
      '36 km/h',
    );
    expect(
      presentWeatherAlert({ kind: 'extreme-heat', peak: 37 }, 'metric', 'celsius').metric,
    ).toBe('37°');
  });
});
