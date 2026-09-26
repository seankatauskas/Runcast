/**
 * Run flyover: plays the run back through the hover bus, so the map dot,
 * popover, strip cursor and readout all animate with zero new plumbing.
 *
 * Playback advances *run time* linearly and inverts it to distance through
 * the grade-adjusted samples — the dot visibly slows on climbs, which is
 * the pace model made tangible. Wall duration scales gently with run
 * length (15–40 s). Any human hover (map or strip) pauses the flyover;
 * changing the conditions profile (slider, pace, route) stops it.
 */
import { useEffect, useRef, useState } from 'react';
import { playbackDistanceAtTime, hoverBus, type RouteConditionsProfile } from '@runcast/core';

interface Props {
  profile: RouteConditionsProfile | null;
}

export function PlayButton({ profile }: Props) {
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const runElapsed = useRef(0); // ms of run time already played
  const profileRef = useRef(profile);
  profileRef.current = profile;

  function stop(clear: boolean): void {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    if (clear) {
      runElapsed.current = 0;
      hoverBus.publish({ distance: null, source: 'play' });
    }
  }

  function play(): void {
    const p = profileRef.current;
    if (!p) return;
    const duration = p.durationSeconds * 1000;
    if (duration <= 0) return;
    // Whole-run wall time: 15 s for short runs up to 40 s for long ones.
    const wall = Math.min(Math.max(duration / 120, 15_000), 40_000);
    const speedup = duration / wall;
    if (runElapsed.current >= duration) runElapsed.current = 0;

    setPlaying(true);
    let last = performance.now();
    const tick = (now: number) => {
      const cur = profileRef.current;
      if (!cur) return stop(true);
      runElapsed.current += (now - last) * speedup;
      last = now;
      const t = cur.samples[0].time + runElapsed.current;
      hoverBus.publish({
        distance: playbackDistanceAtTime(cur.samples, t),
        source: 'play',
      });
      if (runElapsed.current >= cur.durationSeconds * 1000) {
        stop(false);
        runElapsed.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  // A human hover anywhere takes over; a new profile invalidates the clock.
  const playingRef = useRef(false);
  playingRef.current = playing;
  useEffect(() => {
    return hoverBus.subscribe(({ distance, source }) => {
      if (playingRef.current && source !== 'play' && distance !== null) {
        stop(false);
      }
    });
  }, []);
  useEffect(() => {
    stop(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  if (!profile) return null;

  return (
    <button
      className={playing ? 'play-btn playing' : 'play-btn'}
      onClick={() => (playing ? stop(false) : play())}
      aria-label={playing ? 'Pause run preview' : 'Play run preview'}
      title={playing ? 'Pause' : 'Preview the run'}
    >
      {playing ? (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="3" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
          <rect x="9.6" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M4.5 2.8a1 1 0 0 1 1.53-.85l8 5.2a1 1 0 0 1 0 1.7l-8 5.2a1 1 0 0 1-1.53-.85z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
