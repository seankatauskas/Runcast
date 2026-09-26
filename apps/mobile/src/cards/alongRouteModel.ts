import {
  M_PER_MI,
  presentRouteConditionsProfile,
  type RouteConditionsProfile,
  type RouteConditionsSample,
  type RouteWindStory,
  type UnitSystem,
  type WeatherAlert,
} from '@runcast/core';

export const ROUTE_PROGRESS_STEPS = 20;
export const FEELS_LIKE_DIFFERENCE_C = 1;

export type AlongRouteLane = 'air' | 'sun' | 'wind' | 'rain' | 'hills';

const WIND_STORY_COPY: Record<RouteWindStory, string> = {
  'headwind-out-tailwind-home': 'headwind out, tailwind home',
  'tailwind-out-headwind-home': 'tailwind out, headwind home',
  'mostly-headwind': 'mostly headwind',
  'mostly-tailwind': 'mostly tailwind',
  'mostly-crosswind': 'mostly crosswind',
  'mostly-calm': 'mostly calm',
  mixed: 'mixed wind',
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function maximumSample(
  samples: readonly RouteConditionsSample[],
  value: (sample: RouteConditionsSample) => number,
): RouteConditionsSample {
  return samples.reduce((highest, sample) => (value(sample) > value(highest) ? sample : highest));
}

function shortDistance(distanceM: number, units: UnitSystem): string {
  const converted = units === 'metric' ? distanceM / 1000 : distanceM / M_PER_MI;
  return `${converted.toFixed(1)} ${units === 'metric' ? 'km' : 'mi'}`;
}

export function routeLocationLabel(
  distanceM: number,
  totalDistanceM: number,
  units: UnitSystem,
): string {
  if (totalDistanceM <= 0) return 'near start';
  const fraction = clamp(distanceM / totalDistanceM, 0, 1);
  if (fraction <= 0.1) return 'near start';
  if (fraction >= 0.9) return 'near finish';
  return `near ${shortDistance(distanceM, units)}`;
}

export function routeProgressBucket(
  distanceM: number,
  totalDistanceM: number,
  steps = ROUTE_PROGRESS_STEPS,
): number {
  if (totalDistanceM <= 0 || steps <= 0) return 0;
  return Math.round(clamp(distanceM / totalDistanceM, 0, 1) * steps);
}

export function routeDistanceForBucket(
  bucket: number,
  totalDistanceM: number,
  steps = ROUTE_PROGRESS_STEPS,
): number {
  if (totalDistanceM <= 0 || steps <= 0) return 0;
  return (clamp(Math.round(bucket), 0, steps) / steps) * totalDistanceM;
}

export function shouldShowFeelsLike(airTemperatureC: number, feelsLikeC: number): boolean {
  return Math.abs(feelsLikeC - airTemperatureC) >= FEELS_LIKE_DIFFERENCE_C;
}

export function alongRouteLanes(profile: RouteConditionsProfile): AlongRouteLane[] {
  const lanes: AlongRouteLane[] = ['air', 'sun', 'wind', 'rain'];
  if (profile.samples.every((sample) => sample.elevationM !== null)) lanes.push('hills');
  return lanes;
}

interface InsightCandidate {
  score: number;
  copy: string;
  category: 'air' | 'sun' | 'rain';
}

function strongestChange(
  profile: RouteConditionsProfile,
  units: UnitSystem,
  excludedCategory: InsightCandidate['category'] | null,
): string | null {
  const { samples } = profile;
  const totalDistanceM = samples.at(-1)?.distanceM ?? 0;
  const airValues = samples.map((sample) => sample.airTemperatureC);
  const radiationValues = samples.map((sample) => sample.radiationWm2);
  const warmest = maximumSample(samples, (sample) => sample.airTemperatureC);
  const brightest = maximumSample(samples, (sample) => sample.radiationWm2);
  const rainiest = maximumSample(samples, (sample) =>
    Math.max(sample.precipitationRateMmH / 7, sample.precipitationProbabilityPct / 100),
  );
  const candidates: InsightCandidate[] = [];
  const airRange = Math.max(...airValues) - Math.min(...airValues);
  if (airRange >= 1) {
    candidates.push({
      category: 'air',
      score: airRange / 4,
      copy: `Warmest ${routeLocationLabel(warmest.distanceM, totalDistanceM, units)}`,
    });
  }
  const radiationRange = Math.max(...radiationValues) - Math.min(...radiationValues);
  if (radiationRange >= 50 && samples.some((sample) => sample.daylight)) {
    candidates.push({
      category: 'sun',
      score: radiationRange / 600,
      copy: `Sun strongest ${routeLocationLabel(brightest.distanceM, totalDistanceM, units)}`,
    });
  }
  if (rainiest.precipitationRateMmH >= 0.1 || rainiest.precipitationProbabilityPct >= 20) {
    candidates.push({
      category: 'rain',
      score: Math.max(
        rainiest.precipitationRateMmH / 7,
        rainiest.precipitationProbabilityPct / 100,
      ),
      copy: `Rain peaks ${routeLocationLabel(rainiest.distanceM, totalDistanceM, units)}`,
    });
  }
  return (
    candidates
      .filter((candidate) => candidate.category !== excludedCategory)
      .sort((a, b) => b.score - a.score)[0]?.copy ?? null
  );
}

function alertInsight(
  profile: RouteConditionsProfile,
  alert: WeatherAlert | null,
  units: UnitSystem,
): { copy: string; category: InsightCandidate['category'] | null } | null {
  if (!alert) return null;
  const { samples } = profile;
  const totalDistanceM = samples.at(-1)?.distanceM ?? 0;
  if (alert.kind === 'heavy-rain' || alert.kind === 'thunderstorm') {
    const peak = maximumSample(samples, (sample) => sample.precipitationRateMmH);
    return {
      copy: `Rain peaks ${routeLocationLabel(peak.distanceM, totalDistanceM, units)}`,
      category: 'rain',
    };
  }
  if (alert.kind === 'extreme-heat') {
    const peak = maximumSample(samples, (sample) => sample.feelsLikeC);
    return {
      copy: `Feels hottest ${routeLocationLabel(peak.distanceM, totalDistanceM, units)}`,
      category: 'air',
    };
  }
  const peak = maximumSample(samples, (sample) => sample.gustMs);
  return {
    copy: `Gusts peak ${routeLocationLabel(peak.distanceM, totalDistanceM, units)}`,
    category: null,
  };
}

export function alongRouteIdleStory(
  profile: RouteConditionsProfile,
  alerts: readonly WeatherAlert[],
  units: UnitSystem,
): string {
  const primary = alertInsight(profile, alerts[0] ?? null, units);
  const change = strongestChange(profile, units, primary?.category ?? null);
  const wind = WIND_STORY_COPY[presentRouteConditionsProfile(profile).wind.story];
  const fragments = [primary?.copy ?? null, change, wind].filter(
    (fragment): fragment is string => fragment !== null,
  );
  if (fragments.length === 1) fragments.unshift('Conditions stay fairly steady');
  return fragments.join(' · ');
}

/** Full-run observations shared by Explorer and Planner, with no generated claims. */
export function prerunObservations(
  profile: RouteConditionsProfile,
  alerts: readonly WeatherAlert[],
  units: UnitSystem,
  outAndBack = false,
): string[] {
  if (profile.samples.length < 2) return [];
  const primary = alertInsight(profile, alerts[0] ?? null, units);
  const change = strongestChange(profile, units, primary?.category ?? null);
  const story = presentRouteConditionsProfile(profile).wind.story;
  let wind = WIND_STORY_COPY[story];
  if (!outAndBack && story === 'headwind-out-tailwind-home')
    wind = 'headwind first half, tailwind second half';
  if (!outAndBack && story === 'tailwind-out-headwind-home')
    wind = 'tailwind first half, headwind second half';
  const first = primary
    ? alerts[0].kind === 'thunderstorm'
      ? 'Lightning possible during this run'
      : primary.copy
    : null;
  const observations = [first, change?.replace('Sun strongest', 'Estimated sun strongest'), wind]
    .filter((copy): copy is string => typeof copy === 'string')
    .map((copy) => copy.charAt(0).toUpperCase() + copy.slice(1));
  if (observations.length === 1) observations.unshift('Conditions stay fairly steady');
  return observations.slice(0, 3);
}
