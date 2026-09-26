/**
 * Input controls: route picker (+ GPX upload), pace stepper, unit and theme
 * toggles. The start-time control lives in StartTimeScrubber.tsx; controls
 * write straight into React state on every input event — computePlan is
 * synchronous and sub-ms, so dragging recomputes the whole world live.
 */
import { useRef } from 'react';
import type { Planner } from '../../app/state';
import { fmtPace, paceToSpeed, speedToPaceSeconds } from '@runcast/core';

export function RoutePicker({ planner }: { planner: Planner }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="route-picker">
      <div className="segmented">
        {planner.routes.map((routeEntry) => (
          <button
            key={routeEntry.planningRoute.id}
            className={
              routeEntry.planningRoute.id === planner.selected.planningRoute.id
                ? 'seg-btn active'
                : 'seg-btn'
            }
            onClick={() => planner.selectRoute(routeEntry.planningRoute.id)}
            title={routeEntry.planningRoute.name}
          >
            {routeEntry.isDemo
              ? routeEntry.planningRoute.name
              : `⬆ ${routeEntry.planningRoute.name}`}
          </button>
        ))}
        <button className="seg-btn seg-upload" onClick={() => fileRef.current?.click()}>
          Upload GPX
        </button>
      </div>
      {planner.canReverse && (
        <button
          className="icon-btn"
          onClick={planner.toggleReverse}
          aria-pressed={planner.reversed}
          aria-label="Reverse route direction"
          title="Reverse route direction"
        >
          ⇄
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void planner.uploadGpx(f);
          e.target.value = '';
        }}
      />
      {planner.uploadError && <div className="upload-error">{planner.uploadError}</div>}
    </div>
  );
}

export function PaceStepper({ planner }: { planner: Planner }) {
  const { speed, setSpeed, units } = planner;
  const paceSec = speedToPaceSeconds(speed, units);
  const nudge = (deltaSec: number) => {
    const next = Math.min(Math.max(paceSec + deltaSec, 150), 720); // 2:30–12:00 per unit
    setSpeed(paceToSpeed(next, units));
  };
  return (
    <div className="control-block">
      <div className="control-label-row">
        <span className="control-label">Expected flat pace</span>
        <span
          className="control-hint"
          title="Your expected flat speed for this run; complete elevation enables grade-adjusted timing"
        >
          this run · timing quality shown above
        </span>
      </div>
      <div className="pace-stepper">
        <button className="pace-btn" onClick={() => nudge(15)} aria-label="Slower pace">
          −
        </button>
        <span className="pace-value num">{fmtPace(speed, units)}</span>
        <button className="pace-btn" onClick={() => nudge(-15)} aria-label="Faster pace">
          +
        </button>
      </div>
    </div>
  );
}

export function UnitToggle({ planner }: { planner: Planner }) {
  return (
    <div className="segmented small">
      {(['imperial', 'metric'] as const).map((u) => (
        <button
          key={u}
          className={planner.units === u ? 'seg-btn active' : 'seg-btn'}
          onClick={() => planner.setUnits(u)}
        >
          {u === 'imperial' ? 'mi' : 'km'}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle({ planner }: { planner: Planner }) {
  return (
    <button
      className="icon-btn"
      onClick={planner.toggleTheme}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {planner.theme === 'light' ? '☾' : '☀'}
    </button>
  );
}
