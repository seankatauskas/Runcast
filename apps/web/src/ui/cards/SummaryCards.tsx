/**
 * Summary cards: the plan at a glance, plus the best-start recommendation.
 * Skeletons keep the layout stable while weather loads; the error state is
 * a designed card with a retry, not a blank panel.
 */
import type { Planner } from '../../app/state';
import {
  fmtDistance,
  fmtClock,
  fmtDuration,
  fmtPercent,
  fmtPrecipRate,
  fmtTemp,
  fmtWindSpeed,
  heatColor,
  presentRunConditions,
  presentRouteConditionsProfile,
  buildSunExposureDisplayBands,
  type UnitSystem,
  type WeatherAlert,
} from '@runcast/core';

function alertText(a: WeatherAlert, units: UnitSystem): { title: string; detail: string } {
  switch (a.kind) {
    case 'thunderstorm':
      return {
        title: 'Thunderstorm',
        detail: 'This start is blocked by the thunderstorm safety policy.',
      };
    case 'heavy-rain':
      return {
        title: 'Heavy rain',
        detail: `Up to ${fmtPrecipRate(a.peak, units)} along the route.`,
      };
    case 'extreme-heat':
      return {
        title: 'Extreme heat',
        detail: `Feels like ${fmtTemp(a.peak, units)} reaches the caution threshold.`,
      };
    case 'high-wind':
      return {
        title: 'High wind',
        detail: `Gusts to ${fmtWindSpeed(a.peak, units)}.`,
      };
  }
}

export function SummaryCards({ planner }: { planner: Planner }) {
  const {
    routeConditionsProfile: profile,
    evaluatedRun,
    recommendation,
    units,
    weatherStatus,
    retryWeather,
    timezone,
  } = planner;
  const conditions = evaluatedRun ? presentRunConditions(evaluatedRun) : null;

  const recommendationCopy = (() => {
    if (!recommendation) return null;
    switch (recommendation.status) {
      case 'recommended':
        return {
          title: 'Recommended start',
          detail: recommendation.winner
            ? `${fmtClock(recommendation.winner.startTime, timezone)} · eligible start with the best run conditions`
            : 'Recommendation details unavailable.',
        };
      case 'caution':
        return {
          title: 'Caution-only window',
          detail: recommendation.winner
            ? `${fmtClock(recommendation.winner.startTime, timezone)} · review the caution reasons`
            : 'No eligible start was found.',
        };
      case 'no-suitable-window':
        return {
          title: 'No suitable start',
          detail: 'Every evaluated candidate was blocked by the safety policy.',
        };
      case 'unavailable':
        return {
          title: 'Environmental recommendation unavailable',
          detail: 'Missing or out-of-validity inputs prevent a reliable conclusion.',
        };
    }
  })();

  if (weatherStatus === 'error') {
    return (
      <div className="card card-error">
        <div className="card-title">Forecast unavailable</div>
        <p className="card-error-text">
          Open-Meteo didn’t answer. Check your connection and try again.
        </p>
        <button className="retry-btn" onClick={retryWeather}>
          Retry
        </button>
      </div>
    );
  }

  if (!profile && !evaluatedRun && !recommendation) {
    return (
      <div className="cards-grid">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="card" key={i}>
            <div className="skeleton" style={{ width: '60%', height: 12 }}>
              &nbsp;
            </div>
            <div className="skeleton" style={{ width: '80%', height: 24, marginTop: 8 }}>
              &nbsp;
            </div>
          </div>
        ))}
      </div>
    );
  }

  const summary =
    profile && evaluatedRun
      ? {
          feelsLike: {
            min: Math.min(...profile.samples.map((s) => s.feelsLikeC)),
            max: Math.max(...profile.samples.map((s) => s.feelsLikeC)),
          },
          duration: profile.durationSeconds,
          maxPrecipProb: Math.max(...profile.samples.map((s) => s.precipitationProbabilityPct)),
          shadeFraction:
            buildSunExposureDisplayBands(profile.samples, profile.canopy?.modelMode ?? 'off')
              .filter((b) => b.segmentDisplay.possibleShade || !b.segmentDisplay.daylight)
              .reduce((sum, b) => sum + b.endDistanceM - b.startDistanceM, 0) /
            (profile.samples.at(-1)!.distanceM || 1),
          headwindDistance: profile.samples
            .slice(1)
            .reduce(
              (sum, s, i) =>
                sum + (s.ambientHeadwindMs > 1.5 ? s.distanceM - profile.samples[i].distanceM : 0),
              0,
            ),
          alerts: evaluatedRun.safety.reasons.flatMap<WeatherAlert>((reason) => {
            switch (reason) {
              case 'safety.thunderstorm':
                return [{ kind: 'thunderstorm' as const, peak: 1 }];
              case 'safety.heavy-rain':
                return [
                  {
                    kind: 'heavy-rain' as const,
                    peak: evaluatedRun.physicalConditions.peaks.precipitationRateMmH,
                  },
                ];
              case 'safety.extreme-heat':
                return [
                  {
                    kind: 'extreme-heat' as const,
                    peak: evaluatedRun.physicalConditions.peaks.feelsLikeC,
                  },
                ];
              case 'safety.high-wind':
                return [
                  {
                    kind: 'high-wind' as const,
                    peak: evaluatedRun.physicalConditions.peaks.gustMs,
                  },
                ];
              default:
                return [];
            }
          }) as WeatherAlert[],
        }
      : null;

  return (
    <>
      {recommendationCopy && recommendation && (
        <div className={`card${recommendation.status === 'recommended' ? '' : ' card-alert'}`}>
          <div className="card-title">{recommendationCopy.title}</div>
          <div className="card-sub">{recommendationCopy.detail}</div>
          {recommendation.reasons.length > 0 && (
            <ul className="reason-list">
              {recommendation.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {evaluatedRun && conditions && (
        <>
          <div className="cards-grid conditions-grid">
            <div className="card">
              <div className="card-title">Run conditions</div>
              <div className="card-value">{conditions.overallLabel}</div>
              <div className="card-sub">
                {fmtTemp(evaluatedRun.physicalConditions.meanTemperatureC, units)} mean air ·{' '}
                {evaluatedRun.safety.tier}
              </div>
              <div className="card-sub">
                {evaluatedRun.timingQuality === 'grade-adjusted'
                  ? 'grade-adjusted timing'
                  : 'flat timing · elevation quality incomplete'}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Sun exposure</div>
              <div className="card-value">{conditions.sunExposure.label}</div>
              <div className="card-sub">over the full run</div>
            </div>
            <div className="card">
              <div className="card-title">Wind effect</div>
              <div className="card-value">{conditions.windEffect.label}</div>
              <div className="card-sub">runner-relative resistance</div>
            </div>
          </div>
          <details className="card conditions-details">
            <summary>How sun and wind affect this run</summary>
            <div className="conditions-detail-block">
              <strong>Sun exposure</strong>
              <span>
                {Math.round(conditions.sunExposure.doseKJm2)} kJ/m² total ·{' '}
                {Math.round(conditions.sunExposure.meanIntensityWm2)} W/m² average
              </span>
              <span>
                Forecast sunlight over this run—not UV exposure or energy absorbed by your body.
              </span>
            </div>
            <div className="conditions-detail-block">
              <strong>Wind effect</strong>
              <span>
                {fmtWindSpeed(conditions.windEffect.apparentAirflowMs, units)} average air moving
                past you
              </span>
              <span>
                Combines forecast wind with your speed and direction. Resistance is not watts or
                calibrated energy use.
              </span>
            </div>
            <div className="conditions-factor-list">
              {conditions.factors.map((factor) => (
                <div className="conditions-factor-row" key={factor.key}>
                  <span>{factor.label}</span>
                  <span>{factor.impact} impact</span>
                </div>
              ))}
            </div>
            <div className="card-sub">
              Planning index {conditions.planningIndex}/100 · general weather heuristic, not medical
              guidance
            </div>
          </details>
        </>
      )}
      {summary && summary.alerts.length > 0 && (
        <div className="card card-alert">
          {summary.alerts.map((a) => {
            const { title, detail } = alertText(a, units);
            return (
              <div className="alert-row" key={a.kind}>
                <span className="alert-badge">⚠ {title}</span>
                <span className="alert-detail">{detail}</span>
              </div>
            );
          })}
        </div>
      )}
      {summary && (
        <div className="cards-grid">
          <div className="card">
            <div className="card-title">Feels like</div>
            <div className="card-value num">
              <span style={{ color: heatColor(summary.feelsLike.min) }}>
                {fmtTemp(summary.feelsLike.min, units)}
              </span>
              <span className="card-value-sep">–</span>
              <span style={{ color: heatColor(summary.feelsLike.max) }}>
                {fmtTemp(summary.feelsLike.max, units)}
              </span>
            </div>
            <div className="card-sub num">
              {fmtDuration(summary.duration)} run
              {summary.maxPrecipProb >= 8 && (
                <span className="rain-chip"> · ☂ {Math.round(summary.maxPrecipProb)}%</span>
              )}
            </div>
          </div>

          <button
            className={`card card-comfort${planner.shadeHighlight ? ' card-active' : ''}`}
            onClick={planner.toggleShadeHighlight}
            aria-pressed={planner.shadeHighlight}
            aria-label="Highlight possible shade and night on the map"
          >
            <div className="card-title">Possible shade / night</div>
            <div className="card-value num">{fmtPercent(summary.shadeFraction)}</div>
            <div className="card-sub">
              {planner.shadeHighlight ? 'on the map · click to hide' : 'presentation overlay only'}
            </div>
          </button>

          <div className="card">
            <div className="card-title">Headwind</div>
            <div className="card-value num">{fmtDistance(summary.headwindDistance, units)}</div>
            <div className="card-sub">
              {profile && presentRouteConditionsProfile(profile).wind.story.replaceAll('-', ' ')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
