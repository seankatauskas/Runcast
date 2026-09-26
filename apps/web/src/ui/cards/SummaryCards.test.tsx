import { renderToStaticMarkup } from 'react-dom/server';
import type { EvaluatedRunV3 } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import type { Planner } from '../../app/state';
import { SummaryCards } from './SummaryCards';

const evaluatedRun = {
  durationSeconds: 3600,
  timingQuality: 'grade-adjusted',
  safety: { tier: 'eligible' },
  physicalConditions: {
    meanTemperatureC: 22,
    radiationDoseJm2: 1_080_000,
    meanApparentAirflowMs: 4,
  },
  exposureSummary: { daylightFraction: 1 },
  conditionsFit: {
    value: 0.76,
    label: 'favorable',
    factors: {
      temperature: 0.04,
      radiation: 0.12,
      aerodynamicOpposition: 0.05,
      precipitation: 0.01,
    },
  },
} as unknown as EvaluatedRunV3;

describe('web runner-facing conditions summary', () => {
  it('leads with plain labels and keeps measurements in disclosure details', () => {
    const planner = {
      routeConditionsProfile: null,
      evaluatedRun,
      recommendation: null,
      units: 'imperial',
      weatherStatus: 'ready',
      retryWeather: () => undefined,
      timezone: 'America/Chicago',
    } as unknown as Planner;

    const markup = renderToStaticMarkup(<SummaryCards planner={planner} />);

    expect(markup).toContain('Run conditions');
    expect(markup).toContain('Sun exposure');
    expect(markup).toContain('Wind effect');
    expect(markup).toContain('Moderate');
    expect(markup).toContain('Light resistance');
    expect(markup).toContain('9 mph average air moving past you');
    expect(markup).toContain('Planning index 76/100');
    expect(markup).not.toMatch(/Radiation|Apparent air|Aerodynamic opposition|m\/s/);
  });
});
