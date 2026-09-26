import {
  fmtPrecipRate,
  fmtTemp,
  fmtWindSpeed,
  type TemperatureUnit,
  type UnitSystem,
  type WeatherAlert,
} from '@runcast/core';

export interface AlertPresentation {
  title: string;
  metric: string;
  detail: string;
}

/** Keeps warning language and measurements identical across every surface. */
export function presentWeatherAlert(
  alert: WeatherAlert,
  units: UnitSystem,
  temperatureUnit: TemperatureUnit,
): AlertPresentation {
  switch (alert.kind) {
    case 'thunderstorm':
      return {
        title: 'Thunderstorm',
        metric: 'Lightning',
        detail: 'Lightning is possible during this run. Choose another start time.',
      };
    case 'heavy-rain':
      return {
        title: 'Heavy rain',
        metric: fmtPrecipRate(alert.peak, units),
        detail: 'Peak rainfall along the route.',
      };
    case 'extreme-heat':
      return {
        title: 'High heat',
        metric: fmtTemp(alert.peak, temperatureUnit),
        detail: 'Peak feels-like temperature. Hydrate and ease the pace.',
      };
    case 'high-wind':
      return {
        title: 'High wind',
        metric: fmtWindSpeed(alert.peak, units),
        detail: 'Peak gusts along the route.',
      };
  }
}
