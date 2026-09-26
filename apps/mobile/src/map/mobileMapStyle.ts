import { MAP_STYLES } from '@runcast/core';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import type { ThemeName } from '../state';

type LooseLayer = {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
};

type LooseStyle = {
  name?: string;
  layers: LooseLayer[];
  [key: string]: unknown;
};

/**
 * Dark palette tuned for route planning rather than general navigation.
 * Geography stays legible, streets recede, and park/water context remains
 * visible behind Runcast's much brighter route treatment.
 */
const NIGHT = {
  ground: '#080a0b',
  residential: '#0c0f11',
  park: '#101613',
  wood: '#111914',
  water: '#09161a',
  waterLine: '#1e353a',
  building: '#141719',
  buildingEdge: '#22272a',
  path: '#303538',
  road: '#24282b',
  roadMajor: '#2b3033',
  roadEdge: '#15181a',
  rail: '#353a3d',
  boundary: '#4a5052',
  label: '#92999c',
  labelStrong: '#b5bbbd',
  waterLabel: '#78959b',
  labelHalo: 'rgba(8, 10, 11, 0.96)',
} as const;

const FILL_COLORS: Record<string, string> = {
  park: NIGHT.park,
  water: NIGHT.water,
  landcover_ice_shelf: '#c3d0cc',
  landcover_glacier: '#aebfba',
  landuse_residential: NIGHT.residential,
  landcover_wood: NIGHT.wood,
  building: NIGHT.building,
  'aeroway-area': '#15181a',
  road_area_pier: NIGHT.ground,
};

function darkLineColor(id: string): string {
  if (id === 'waterway') return NIGHT.waterLine;
  if (id.includes('boundary')) return NIGHT.boundary;
  if (id.includes('railway')) {
    return id.includes('dashline') ? NIGHT.ground : NIGHT.rail;
  }
  if (id === 'highway_path') return NIGHT.path;
  if (id.includes('casing')) return NIGHT.roadEdge;
  if (id.includes('motorway') || id.includes('highway_major')) return NIGHT.roadMajor;
  return NIGHT.road;
}

function darkLayer(layer: LooseLayer): LooseLayer {
  const layout = layer.layout ? { ...layer.layout } : undefined;
  const isRoadShield = layer.id.startsWith('highway-shield-') || layer.id === 'road_shield_us';
  if (isRoadShield && layout) layout.visibility = 'none';

  const paint = layer.paint ? { ...layer.paint } : undefined;
  if (!paint) return { ...layer, ...(layout ? { layout } : {}) };

  if (layer.type === 'background') paint['background-color'] = NIGHT.ground;

  if (layer.type === 'fill') {
    paint['fill-color'] = FILL_COLORS[layer.id] ?? NIGHT.residential;
    if (layer.id === 'building') paint['fill-outline-color'] = NIGHT.buildingEdge;
  }

  if (layer.type === 'line') paint['line-color'] = darkLineColor(layer.id);

  if (layer.type === 'symbol') {
    if ('text-color' in paint) {
      paint['text-color'] = layer.id.includes('water')
        ? NIGHT.waterLabel
        : layer.id.includes('city') || layer.id.includes('country')
          ? NIGHT.labelStrong
          : NIGHT.label;
    }
    if ('text-halo-color' in paint) paint['text-halo-color'] = NIGHT.labelHalo;
  }

  return { ...layer, ...(layout ? { layout } : {}), paint };
}

const lightStyle = MAP_STYLES.light as unknown as LooseStyle;

const darkStyle = {
  ...lightStyle,
  name: 'Runcast Night Run',
  layers: lightStyle.layers.map(darkLayer),
} as unknown as StyleSpecification;

/** A stable, bundled map style object for both native maps. */
export function mobileMapStyle(themeName: ThemeName): StyleSpecification {
  return themeName === 'dark' ? darkStyle : (MAP_STYLES.light as unknown as StyleSpecification);
}
