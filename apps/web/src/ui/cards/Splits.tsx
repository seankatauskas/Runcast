/**
 * Grade-adjusted splits, collapsed by default — the web twin of the mobile
 * Splits card. Row clicks publish the split midpoint through the hover bus;
 * the map dot, popover, and strip cursor follow.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildRouteConditionSplits,
  EXPOSURE_COLORS,
  forecastSunlightOpacity,
  fmtClock,
  fmtTemp,
  heatColor,
  hoverBus,
  M_PER_MI,
  speedToPaceSeconds,
  type RouteConditionSplit,
} from '@runcast/core';
import type { Planner } from '../../app/state';

/** "m:ss" without the "/mi" suffix — the unit is the row itself. */
function paceStr(speed: number, units: 'metric' | 'imperial'): string {
  if (speed <= 0) return '–';
  const sec = Math.round(speedToPaceSeconds(speed, units));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function Splits({ planner }: { planner: Planner }) {
  const { routeConditionsProfile: profile, units, timezone } = planner;
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // The card sits at the bottom of a scrolling panel; opening it below the
  // fold otherwise looks like nothing happened.
  useEffect(() => {
    if (open) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  const splits = useMemo(() => {
    if (!profile) return [];
    return buildRouteConditionSplits(profile, units === 'metric' ? 1000 : M_PER_MI);
  }, [profile, units]);

  if (!profile || splits.length === 0) return null;
  const unitM = units === 'metric' ? 1000 : M_PER_MI;

  function rowLabel(s: RouteConditionSplit): string {
    const len = s.endDistanceM - s.startDistanceM;
    return len < unitM - 1 ? (len / unitM).toFixed(2) : String(s.index);
  }

  return (
    <div className="card splits" ref={cardRef}>
      <button className="splits-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="card-title">Splits · {splits.length}</span>
        <span className="splits-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="splits-body">
          <div className="split-row split-head">
            <span className="split-idx">{units === 'metric' ? 'km' : 'mi'}</span>
            <span className="split-pace">pace</span>
            <span className="split-clock">arrive</span>
            <span className="split-temp">feels</span>
            <span className="split-cond">conditions</span>
          </div>
          {splits.map((s) => (
            <button
              className="split-row"
              key={s.index}
              onClick={() =>
                hoverBus.publish({
                  distance: (s.startDistanceM + s.endDistanceM) / 2,
                  source: 'splits',
                })
              }
              aria-label={`Split ${s.index}, show on map`}
            >
              <span className="split-idx num">{rowLabel(s)}</span>
              <span className="split-pace num">{paceStr(s.speedMs, units)}</span>
              <span className="split-clock num">{fmtClock(s.endTime, timezone)}</span>
              <span className="split-temp num" style={{ color: heatColor(s.meanFeelsLikeC) }}>
                {fmtTemp(s.meanFeelsLikeC, units)}
              </span>
              <span className="split-cond">
                <span
                  className="legend-swatch"
                  style={{
                    background: EXPOSURE_COLORS.sun,
                    opacity: forecastSunlightOpacity(s.forecastSunlightLevel),
                  }}
                />
                {s.windClass}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
