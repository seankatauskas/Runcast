import {
  buildSunExposureDisplayBands,
  positionAt,
  type EvaluatedRunV3,
  type Route,
  type RouteConditionsProfile,
  type WeatherAlert,
} from '@runcast/core';

export function safetyAlerts(plan: EvaluatedRunV3 | null): WeatherAlert[] {
  if (!plan) return [];
  const reasons = new Set(plan.safety.reasons);
  const alerts: WeatherAlert[] = [];
  if (reasons.has('safety.thunderstorm')) alerts.push({ kind: 'thunderstorm', peak: 1 });
  if (reasons.has('safety.heavy-rain')) {
    alerts.push({ kind: 'heavy-rain', peak: plan.physicalConditions.peaks.precipitationRateMmH });
  }
  if (reasons.has('safety.extreme-heat')) {
    alerts.push({ kind: 'extreme-heat', peak: plan.physicalConditions.peaks.feelsLikeC });
  }
  if (reasons.has('safety.high-wind')) {
    alerts.push({ kind: 'high-wind', peak: plan.physicalConditions.peaks.gustMs });
  }
  return alerts;
}

export interface PlaybackSample {
  time: number;
  distanceM: number;
}

export interface PlaybackTimeline {
  startTime: number;
  durationMs: number;
  samples: PlaybackSample[];
}

export function planningPlaybackTimeline(
  profile: RouteConditionsProfile | null,
): PlaybackTimeline | null {
  const samples =
    profile?.samples.map((sample) => ({ time: sample.time, distanceM: sample.distanceM })) ?? [];
  if (samples.length < 2) return null;
  const durationMs = samples.at(-1)!.time - samples[0].time;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return { startTime: samples[0].time, durationMs, samples };
}

/** Route coordinates for V2-derived possible-shade/night bands on the map. */
export function outOfSunCoordinates(
  route: Route,
  profile: RouteConditionsProfile | null,
): [number, number][][] {
  if (!profile) return [];
  return buildSunExposureDisplayBands(profile.samples, profile.canopy?.modelMode ?? 'off')
    .filter((band) => !band.segmentDisplay.forecastSunlight)
    .map((band) => {
      const points = [positionAt(route, band.startDistanceM).position];
      route.cumulative.forEach((distanceM, index) => {
        if (distanceM > band.startDistanceM && distanceM < band.endDistanceM) {
          points.push(route.points[index]);
        }
      });
      points.push(positionAt(route, band.endDistanceM).position);
      return points.map((point) => [point.lon, point.lat] as [number, number]);
    });
}
