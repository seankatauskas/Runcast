/**
 * Runcast's "calm performance instrument" token system. Chrome owns one
 * luminous teal; weather colors are reserved for measured signals. The
 * neutral scale is graphite-black so weather and route signals carry the
 * color instead of tinting every surface.
 */

export interface Chrome {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textFaint: string;
  controlBg: string;
  controlActive: string;
  controlActiveText: string;
  accentInk: string;
  /** High-contrast material used for map-overlay planning chrome in the active theme. */
  cockpit: string;
  cockpitRaised: string;
  cockpitBorder: string;
  cockpitText: string;
  cockpitTextSecondary: string;
  cockpitAccent: string;
  cockpitAccentText: string;
  route: string;
  routeCasing: string;
  warn: string;
  warnInk: string;
  good: string;
  danger: string;
  temperature: string;
  temperatureInk: string;
  sun: string;
  sunInk: string;
  rain: string;
  rainInk: string;
  elevation: string;
  elevationInk: string;
  wind: string;
  windInk: string;
  storm: string;
  stormInk: string;
}

/**
 * Brand accent. Interactive elements wear teal; coral means temperature,
 * amber means direct sun, while weather and terrain use semantic colors
 * that remain distinct from interactive teal.
 */
const ACCENT_INK_LIGHT = '#007e78';
const ACCENT_BRIGHT = '#5ce0d6';

export const LIGHT: Chrome = {
  bg: '#eceeee',
  surface: '#f4f5f5',
  surfaceRaised: '#ffffff',
  surfaceMuted: '#e1e4e4',
  border: '#d0d4d3',
  borderStrong: '#747b79',
  text: '#111514',
  textSecondary: '#4f5755',
  textFaint: '#626a68',
  controlBg: '#e6e8e8',
  controlActive: '#55d9cf',
  controlActiveText: '#06221f',
  accentInk: ACCENT_INK_LIGHT,
  cockpit: '#ffffff',
  cockpitRaised: '#eef3f0',
  cockpitBorder: '#747b79',
  cockpitText: '#111514',
  cockpitTextSecondary: '#525a58',
  cockpitAccent: '#55d9cf',
  cockpitAccentText: '#06221f',
  route: '#00766f',
  routeCasing: 'rgba(5, 42, 39, 0.72)',
  warn: '#c58a1f',
  warnInk: '#7d5707',
  good: ACCENT_INK_LIGHT,
  danger: '#b42318',
  temperature: '#dc6842',
  temperatureInk: '#a94324',
  sun: '#d5a22e',
  sunInk: '#765500',
  rain: '#4897c6',
  rainInk: '#155f89',
  elevation: '#74927b',
  elevationInk: '#496850',
  wind: '#7f90ad',
  windInk: '#4f607e',
  storm: '#8467bd',
  stormInk: '#65479a',
};

export const DARK: Chrome = {
  bg: '#08090a',
  surface: '#0e1012',
  surfaceRaised: '#15181b',
  surfaceMuted: '#1b1f22',
  border: 'rgba(240, 244, 246, 0.10)',
  borderStrong: 'rgba(240, 244, 246, 0.20)',
  text: '#f3f5f5',
  textSecondary: '#b0b6b8',
  textFaint: '#858d90',
  controlBg: '#202428',
  controlActive: ACCENT_BRIGHT,
  controlActiveText: '#05201d',
  accentInk: '#6be6dd',
  cockpit: '#080a0b',
  cockpitRaised: '#14181a',
  cockpitBorder: 'rgba(238, 244, 246, 0.14)',
  cockpitText: '#f4f6f6',
  cockpitTextSecondary: '#a5adb0',
  cockpitAccent: '#66e1d7',
  cockpitAccentText: '#04221e',
  route: '#59ddd4',
  routeCasing: 'rgba(0, 0, 0, 0.72)',
  warn: '#edbd50',
  warnInk: '#f0c45c',
  good: '#6be6dd',
  danger: '#ff9188',
  temperature: '#ff9872',
  temperatureInk: '#ff9d79',
  sun: '#f0c45c',
  sunInk: '#f3ca68',
  rain: '#6bbbe7',
  rainInk: '#76c5ef',
  elevation: '#8eb29a',
  elevationInk: '#9bc0a7',
  wind: '#a5b5d0',
  windInk: '#b1c1dc',
  storm: '#b9a3ed',
  stormInk: '#c2aff4',
};

/** 4pt spacing scale, mirroring --sp-* on the web. */
export const SP = [0, 4, 8, 12, 16, 24, 32, 48] as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 22, dock: 28, full: 999 } as const;

/** Every important interactive control presents at least a 44pt target. */
export const CONTROL = { height: 48, compactHeight: 44, icon: 20 } as const;

export const SHADOW = {
  color: '#000000',
  opacity: 0.12,
  radius: 16,
  offset: { width: 0, height: 8 },
} as const;

/**
 * Display face for the numbers the product is made of. Loaded in the root
 * layout via expo-font; falls back to system until then. Don't pair fontWeight
 * with these — the files are the weights.
 */
export const FAMILY = {
  display: 'Manrope_700Bold',
  displayMedium: 'Manrope_500Medium',
} as const;

export const FONT = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 22,
  xxl: 32,
} as const;

/**
 * Semantic typography roles. Manrope is reserved for decisions and
 * data; system type carries controls and explanatory copy for native
 * readability on both platforms.
 */
export const TYPE = {
  hero: {
    fontFamily: FAMILY.display,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1.1,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
  title: {
    fontFamily: FAMILY.displayMedium,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.25,
  },
  data: {
    fontFamily: FAMILY.displayMedium,
    fontSize: 22,
    lineHeight: 28,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
  section: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  support: {
    fontSize: 13,
    lineHeight: 19,
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
  },
  control: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600' as const,
  },
  label: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.9,
  },
  axis: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600' as const,
    letterSpacing: 0.4,
  },
} as const;
