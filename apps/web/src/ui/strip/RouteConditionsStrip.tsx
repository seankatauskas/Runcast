/**
 * Route conditions strip: distance on x; sun/shade bands behind, elevation profile
 * at the bottom, feels-like line on top. Hover is linked bidirectionally
 * with the map through hoverBus — drawn here as a cursor line + readout.
 * Pure canvas (devicePixelRatio-aware); redraws are rAF-coalesced.
 */
import { useEffect, useRef } from 'react';
import {
  EXPOSURE_COLORS,
  buildSunExposureDisplayBands,
  forecastSunlightOpacity,
  fmtClock,
  fmtTemp,
  heatColor,
  hoverBus,
  type RouteConditionsProfile,
  type UnitSystem,
} from '@runcast/core';
import type { Theme } from '../../app/state';

const M_PER_MI = 1609.344;
const PAD = { top: 10, right: 14, bottom: 22, left: 40 };

interface Props {
  profile: RouteConditionsProfile | null;
  units: UnitSystem;
  theme: Theme;
  timezone?: string;
}

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function RouteConditionsStrip({ profile, units, theme, timezone }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);

  const stateRef = useRef({
    profile,
    units,
    timezone,
    hover: null as number | null,
  });
  stateRef.current.profile = profile;
  stateRef.current.units = units;
  stateRef.current.timezone = timezone;

  const rafRef = useRef(0);

  function scheduleDraw(): void {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }

  function draw(): void {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { profile: p, units: u, hover } = stateRef.current;

    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!p) return;

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const total = p.samples[p.samples.length - 1].distanceM || 1;
    const x = (d: number) => PAD.left + (d / total) * plotW;

    // Exposure bands behind everything.
    for (const band of buildSunExposureDisplayBands(p.samples, p.canopy?.modelMode ?? 'off')) {
      const display = band.segmentDisplay;
      ctx.fillStyle =
        EXPOSURE_COLORS[!display.daylight ? 'night' : display.possibleShade ? 'shade' : 'sun'];
      ctx.globalAlpha = display.forecastSunlight
        ? 0.2 + 0.8 * forecastSunlightOpacity(display.intensityLevel)
        : 1;
      ctx.fillRect(
        x(band.startDistanceM),
        PAD.top,
        Math.max(x(band.endDistanceM) - x(band.startDistanceM), 0.5),
        plotH,
      );
    }

    ctx.globalAlpha = 1;

    // Elevation profile along the bottom third.
    const eles = p.samples.flatMap((s) => (s.elevationM === null ? [] : [s.elevationM]));
    const eleMin = Math.min(...eles);
    const eleSpan = Math.max(Math.max(...eles) - eleMin, 30); // floor: flat routes stay flat
    const eleTop = PAD.top + plotH * 0.62;
    const eleY = (e: number) =>
      PAD.top + plotH - ((e - eleMin) / eleSpan) * (plotH - (eleTop - PAD.top)) * 0.9;
    if (eles.length === p.samples.length) {
      ctx.beginPath();
      ctx.moveTo(x(0), PAD.top + plotH);
      for (const s of p.samples) ctx.lineTo(x(s.distanceM), eleY(s.elevationM!));
      ctx.lineTo(x(total), PAD.top + plotH);
      ctx.closePath();
      ctx.fillStyle = cssVar('--border');
      ctx.fill();
    }

    // Feels-like line, colored by the shared heat ramp.
    const temps = p.samples.map((s) => s.feelsLikeC);
    const tMin = Math.min(...temps) - 1.5;
    const tMax = Math.max(...temps) + 1.5;
    const tY = (t: number) => PAD.top + (1 - (t - tMin) / (tMax - tMin)) * plotH * 0.55 + 4;
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    for (let i = 1; i < p.samples.length; i++) {
      const a = p.samples[i - 1];
      const b = p.samples[i];
      ctx.strokeStyle = heatColor((a.feelsLikeC + b.feelsLikeC) / 2);
      ctx.beginPath();
      ctx.moveTo(x(a.distanceM), tY(a.feelsLikeC));
      ctx.lineTo(x(b.distanceM), tY(b.feelsLikeC));
      ctx.stroke();
    }

    // Rain probability: a blue veil descending from the top of the plot —
    // deeper veil, likelier rain. Hidden entirely below 8% to keep dry
    // days clean.
    const anyRain = p.samples.some((s) => s.precipitationProbabilityPct >= 8);
    if (anyRain) {
      ctx.beginPath();
      ctx.moveTo(x(0), PAD.top);
      const rainY = (prob: number) => PAD.top + (prob / 100) * plotH * 0.45;
      for (const s of p.samples) ctx.lineTo(x(s.distanceM), rainY(s.precipitationProbabilityPct));
      ctx.lineTo(x(total), PAD.top);
      ctx.closePath();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.16)'; // --rain at low alpha
      ctx.fill();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      for (const s of p.samples) {
        const yv = rainY(s.precipitationProbabilityPct);
        if (started) ctx.lineTo(x(s.distanceM), yv);
        else {
          ctx.moveTo(x(s.distanceM), yv);
          started = true;
        }
      }
      ctx.stroke();
    }

    // Temp extremes on the left, distance ticks along the bottom.
    ctx.font = `10px ${cssVar('--font-sans')}`;
    ctx.fillStyle = cssVar('--text-faint');
    ctx.textAlign = 'right';
    ctx.fillText(fmtTemp(tMax - 1.5, u), PAD.left - 6, tY(tMax - 1.5) + 3);
    ctx.fillText(fmtTemp(tMin + 1.5, u), PAD.left - 6, tY(tMin + 1.5) + 3);

    const unitM = u === 'metric' ? 1000 : M_PER_MI;
    ctx.textAlign = 'center';
    const every = Math.ceil(total / unitM / (plotW / 56));
    for (let k = 0; k * unitM <= total; k += Math.max(every, 1)) {
      if (k === 0) continue;
      ctx.fillText(String(k), x(k * unitM), h - 8);
    }
    ctx.textAlign = 'left';
    ctx.fillText(u === 'metric' ? 'km' : 'mi', x(0) + 2, h - 8);

    // Hover cursor + marker on the temp line.
    if (hover !== null) {
      const cx = x(hover);
      ctx.strokeStyle = cssVar('--text-secondary');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, PAD.top);
      ctx.lineTo(cx, PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const i = Math.min(
        Math.round((hover / total) * (p.samples.length - 1)),
        p.samples.length - 1,
      );
      const s = p.samples[i];
      ctx.beginPath();
      ctx.arc(cx, tY(s.feelsLikeC), 4, 0, Math.PI * 2);
      ctx.fillStyle = heatColor(s.feelsLikeC);
      ctx.fill();
      ctx.strokeStyle = cssVar('--surface-raised');
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function updateReadout(distance: number | null): void {
    const el = readoutRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    const { profile: p, units: u, timezone: tz } = stateRef.current;
    if (distance === null || !p) {
      el.style.opacity = '0';
      return;
    }
    const total = p.samples[p.samples.length - 1].distanceM || 1;
    const i = Math.min(
      Math.round((distance / total) * (p.samples.length - 1)),
      p.samples.length - 1,
    );
    const s = p.samples[i];
    el.innerHTML = `<span class="num">${fmtClock(s.time, tz)}</span> · feels <strong class="num">${fmtTemp(
      s.feelsLikeC,
      u,
    )}</strong>`;
    const plotW = wrap.clientWidth - PAD.left - PAD.right;
    const cx = PAD.left + (distance / total) * plotW;
    // Left clamp clears the play button; right clamp keeps it on-screen.
    el.style.left = `${Math.min(Math.max(cx, 130), wrap.clientWidth - 70)}px`;
    el.style.opacity = '1';
  }

  /* Pointer → hover bus (source: strip). */
  useEffect(() => {
    const wrap = wrapRef.current!;
    const toDistance = (clientX: number): number | null => {
      const p = stateRef.current.profile;
      if (!p) return null;
      const rect = wrap.getBoundingClientRect();
      const total = p.samples[p.samples.length - 1].distanceM || 1;
      const frac = (clientX - rect.left - PAD.left) / (rect.width - PAD.left - PAD.right);
      if (frac < 0 || frac > 1) return null;
      return frac * total;
    };
    const move = (e: PointerEvent) => {
      hoverBus.publish({ distance: toDistance(e.clientX), source: 'strip' });
    };
    const leave = () => hoverBus.publish({ distance: null, source: 'strip' });
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerleave', leave);
    return () => {
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('pointerleave', leave);
    };
  }, []);

  /* Hover bus → cursor (from either source). */
  useEffect(() => {
    return hoverBus.subscribe(({ distance }) => {
      stateRef.current.hover = distance;
      updateReadout(distance);
      scheduleDraw();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Redraw on data/theme/size changes. */
  useEffect(() => {
    updateReadout(stateRef.current.hover);
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, units, theme, timezone]);

  useEffect(() => {
    const ro = new ResizeObserver(scheduleDraw);
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="strip" ref={wrapRef}>
      {!profile && <div className="strip-skeleton skeleton" />}
      <canvas ref={canvasRef} className="strip-canvas" />
      <div className="strip-readout" ref={readoutRef} />
    </div>
  );
}
