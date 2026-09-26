import {
  buildSunExposureDisplayBands,
  EXPOSURE_COLORS,
  RAIN_COLOR,
  type RouteConditionsProfile,
} from '@runcast/core';

const labels = { sun: 'forecast sunlight', shade: 'possible shade', night: 'after sunset' };
export function StripLegend({ profile }: { profile: RouteConditionsProfile | null }) {
  if (!profile) return null;
  const present = new Set(
    buildSunExposureDisplayBands(profile.samples, profile.canopy?.modelMode ?? 'off').map(
      ({ segmentDisplay: s }) => (!s.daylight ? 'night' : s.possibleShade ? 'shade' : 'sun'),
    ),
  );
  return (
    <div className="strip-legend">
      {(['sun', 'shade', 'night'] as const)
        .filter((key) => present.has(key))
        .map((key) => (
          <span className="legend-chip" key={key}>
            <span className="legend-swatch" style={{ background: EXPOSURE_COLORS[key] }} />
            {labels[key]}
          </span>
        ))}
      {profile.samples.some((sample) => sample.precipitationProbabilityPct >= 8) && (
        <span className="legend-chip">
          <span className="legend-swatch" style={{ background: RAIN_COLOR, opacity: 0.35 }} />
          rain
        </span>
      )}
    </div>
  );
}
