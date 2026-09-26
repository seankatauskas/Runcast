/**
 * Start-time scrubber: the native range input keeps its role (drag,
 * keyboard steps, focus ring — canonical control), and the day's
 * conditions-fit curve is drawn above its track as an
 * SVG, with a cursor line dropping from the curve through the thumb and
 * the best start marked. Pointer events on the curve also set the time,
 * so touching the interesting dip does what it looks like it should.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EXPOSURE_COLORS,
  fmtClock,
  fmtDay,
  presentRunConditions,
  SUN_EVENT_COLOR,
  sunWindows,
  type StartRecommendationV3,
} from '@runcast/core';
import type { Planner } from '../../app/state';

/** Animates an integer toward its target so score changes read as motion. */
function useTicking(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    if (value === shownRef.current) return;
    const from = shownRef.current;
    const start = performance.now();
    const DUR = 220;
    let raf = 0;
    const tick = (now: number) => {
      const f = Math.min((now - start) / DUR, 1);
      const eased = 1 - (1 - f) ** 3;
      const v = Math.round(from + (value - from) * eased);
      shownRef.current = v;
      setShown(v);
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

const CURVE_H = 56;
const THUMB_W = 18; // matches .time-slider thumb; travel = width − THUMB_W
const STEP = 15 * 60 * 1000;

interface Curve {
  stroke: string;
  fill: string;
  best: { x: number; y: number };
}

function buildCurve(
  rec: StartRecommendationV3,
  window: { min: number; max: number },
  width: number,
): Curve | null {
  const candidates = rec.candidates.filter(
    (candidate) => candidate.evaluable && candidate.conditionsFit !== null,
  );
  if (candidates.length < 2) return null;
  const span = window.max - window.min || 1;
  // Thumb centers travel THUMB_W/2 .. width − THUMB_W/2; the curve shares
  // that x-mapping so the cursor, thumb, and curve always agree.
  const x = (t: number) => THUMB_W / 2 + ((t - window.min) / span) * (width - THUMB_W);
  // Fixed 0..1 conditions-fit domain — comparable across routes/days.
  const y = (fit: number) => 4 + (1 - fit) * (CURVE_H - 10);

  const pts = candidates.map(
    (candidate) => `${x(candidate.startTime)} ${y(candidate.conditionsFit!)}`,
  );
  const stroke = `M ${pts.join(' L ')}`;
  const fill = `${stroke} L ${x(candidates[candidates.length - 1].startTime)} ${CURVE_H} L ${x(candidates[0].startTime)} ${CURVE_H} Z`;

  const bestCand =
    candidates.find((candidate) => candidate.startTime === rec.winner?.startTime) ?? candidates[0];
  return {
    stroke,
    fill,
    best: { x: x(bestCand.startTime), y: y(bestCand.conditionsFit!) },
  };
}

export function StartTimeScrubber({ planner }: { planner: Planner }) {
  const { startTime, setStartTime, sliderWindow, timezone, recommendation, evaluatedRun } = planner;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const fit = evaluatedRun?.conditionsFit ?? null;
  const conditions = evaluatedRun ? presentRunConditions(evaluatedRun) : null;
  const shownFit = useTicking(fit ? Math.round(fit.value * 100) : 0);
  const best = recommendation?.winner?.startTime;
  const bestIsCurrent = best !== undefined && Math.abs(best - startTime) < 15 * 60 * 1000;
  // How much waiting for the best start changes the conditions-fit heuristic.
  const bestCand = recommendation?.candidates.find((candidate) => candidate.startTime === best);
  const bestDelta =
    bestCand?.conditionsFit !== null && bestCand?.conditionsFit !== undefined && fit
      ? Math.round(bestCand.conditionsFit * 100) - Math.round(fit.value * 100)
      : 0;

  // Night shading + sunrise/sunset ticks: the time axis shows what the
  // exposure model knows. Anchored at the route start; a run doesn't
  // travel far enough for the horizon times to differ meaningfully.
  const origin = planner.activePlanningRoute.part.points[0];
  const sun = useMemo(
    () => sunWindows(sliderWindow.min, sliderWindow.max, origin.lat, origin.lon),
    [sliderWindow, origin.lat, origin.lon],
  );

  useEffect(() => {
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(bodyRef.current!);
    return () => ro.disconnect();
  }, []);

  const curve = useMemo(
    () => (recommendation && width > 0 ? buildCurve(recommendation, sliderWindow, width) : null),
    [recommendation, sliderWindow, width],
  );

  const span = sliderWindow.max - sliderWindow.min || 1;
  const clamped = Math.min(Math.max(startTime, sliderWindow.min), sliderWindow.max);
  const xFor = (t: number) => THUMB_W / 2 + ((t - sliderWindow.min) / span) * (width - THUMB_W);
  const cursorX = xFor(clamped);

  function setFromClientX(clientX: number): void {
    if (width <= 0) return;
    const rect = bodyRef.current!.getBoundingClientRect();
    const f = Math.min(Math.max((clientX - rect.left - THUMB_W / 2) / (width - THUMB_W), 0), 1);
    let t = sliderWindow.min + Math.round((f * span) / STEP) * STEP;
    // Magnetic best start: within one step, the cursor snaps onto it.
    if (best !== undefined && Math.abs(t - best) <= STEP) t = best;
    setStartTime(t);
  }

  return (
    <div className="control-block">
      <div className="control-label-row">
        <span className="control-label">Start time</span>
        <span className="control-value num">
          {fmtDay(startTime, timezone)} · {fmtClock(startTime, timezone)}
        </span>
      </div>
      <div className="scrubber-body" ref={bodyRef}>
        <div
          className="scrubber-curve-zone"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) setFromClientX(e.clientX);
          }}
        >
          {curve && (
            <svg width={width} height={CURVE_H} aria-hidden="true">
              {sun.nights.map((n, i) => (
                <rect
                  key={`n${i}`}
                  x={xFor(n.start)}
                  y={0}
                  width={Math.max(xFor(n.end) - xFor(n.start), 0)}
                  height={CURVE_H}
                  fill={EXPOSURE_COLORS.night}
                />
              ))}
              {sun.events.map((e, i) => (
                <rect
                  key={`e${i}`}
                  x={xFor(e.time) - 0.75}
                  y={CURVE_H - 9}
                  width={1.5}
                  height={9}
                  fill={SUN_EVENT_COLOR}
                />
              ))}
              <path d={curve.fill} fill="var(--text)" opacity={0.08} />
              <path
                d={curve.stroke}
                fill="none"
                stroke="var(--text)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle cx={curve.best.x} cy={curve.best.y} r={4} fill="var(--good)" />
            </svg>
          )}
        </div>
        <input
          className="time-slider"
          type="range"
          min={sliderWindow.min}
          max={sliderWindow.max}
          step={STEP}
          value={clamped}
          onChange={(e) => setStartTime(Number(e.target.value))}
          aria-label="Start time"
        />
        {width > 0 && <div className="scrubber-cursor" style={{ left: cursorX - 0.75 }} />}
      </div>
      <div className="slider-scale scrubber-scale">
        <span>now</span>
        <span
          className="scrubber-tick-mid"
          style={{
            left: `calc((100% - ${THUMB_W}px) * ${24 / 47} + ${THUMB_W / 2}px)`,
          }}
        >
          +24h
        </span>
        <span>+48h</span>
      </div>

      {/* Conditions fit is a versioned population heuristic, not a medical
          safety or physiological score. Safety tiering is shown separately. */}
      {fit && conditions && (
        <div className="scrubber-comfort-row">
          <button
            className="scrubber-comfort"
            onClick={() => setBreakdownOpen((o) => !o)}
            aria-expanded={breakdownOpen}
            aria-label="Run conditions measurement details"
          >
            <span className="control-label">Run conditions</span>
            <span className="scrubber-comfort-story">· {conditions.overallLabel}</span>
          </button>
          {best !== undefined &&
            (bestIsCurrent ? (
              <span className="best-badge">you’re on the best start</span>
            ) : (
              <button
                className="best-chip num"
                onClick={() => setStartTime(best)}
                aria-label="Jump to the best start time"
              >
                best {fmtClock(best, timezone)}
                {bestDelta > 0 ? ` · +${bestDelta}` : ' →'}
              </button>
            ))}
        </div>
      )}

      {fit && conditions && breakdownOpen && (
        <div className="penalty-list" aria-live="polite">
          {conditions.factors.map((factor) => (
            <div className="penalty-row" key={factor.key}>
              <span className="penalty-label">{factor.label}</span>
              <span className="penalty-track">
                <span
                  className="penalty-fill"
                  style={{
                    width: `${Math.min(factor.penaltyPoints, 100)}%`,
                  }}
                />
              </span>
              <span className="penalty-points">{factor.impact} impact</span>
            </div>
          ))}
          <div className="conditions-index-note">
            Planning index {shownFit}/100 · general weather heuristic, not medical guidance
          </div>
        </div>
      )}
    </div>
  );
}
