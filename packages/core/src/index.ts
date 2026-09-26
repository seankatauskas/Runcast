/**
 * @runcast/core — everything portable: the pure engine, the IO clients,
 * the display-unit formatting layer, the transient-event bus, and the data
 * color theme. Consumed as TypeScript source by both apps (web via Vite,
 * mobile via Metro); there is no build step.
 */
export * from './engine/types';
export type {
  CoverageMask as LegacyCoverageMask,
  Route as LegacyRoute,
  RoutePoint as LegacyRoutePoint,
  WeatherField as LegacyWeatherField,
} from './engine/types';
export * from './engine/geo';
export * from './engine/gpx';
export * from './engine/interpolate';
export { SUNRISE_ELEVATION, sunWindows } from './engine/solar';
export type { SunWindows } from './engine/solar';
export * from './engine/gap';
export * from './engine/reverse';
export * from './engine/planning/types';
export * from './engine/planning/identity';
export * from './engine/planning/versions';
export * from './engine/planning/freshness';
export * from './engine/planning/gpx';
export * from './engine/planning/timing';
export * from './engine/planning/weather';
export * from './engine/planning/solar';
export * from './engine/planning/coverage';
export * from './engine/planning/canopy';
export * from './engine/planning/wind';
export * from './engine/planning/conditions';
export * from './engine/planning/presentation';
export * from './engine/planning/routeConditionsPresentation';
export * from './engine/planning/recommendation';
export * from './engine/planning/pipeline';
export * from './io/openMeteo';
export * from './io/overpass';
export * from './io/deadline';
export {
  fetchCoverage as fetchLegacyCoverage,
  unknownMask as unknownLegacyCoverageMask,
} from './io/overpass';
export * from './io/demoRoutes';
export * from './format/units';
export * from './bus';
export * from './theme';

export * from './engine/planning/transforms';
export * from './engine/planning/display';
