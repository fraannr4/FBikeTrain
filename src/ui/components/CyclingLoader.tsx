import { useEffect, useState } from 'react';
import './CyclingLoader.css';

/** Decorado de espera: nunca calcula progreso ni prolonga la operación para completar un ciclo. */
export function CyclingLoader({ label, compact = false }: { label?: string; compact?: boolean }) {
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const update = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return <div className={`cycling-loader${compact ? ' cycling-loader--compact' : ''}`} data-paused={String(paused)}>
    <svg viewBox="0 0 360 190" fill="none" aria-hidden="true" focusable="false">
      <g className="cycling-terrain">
        <path d="M-20 140C45 120 71 150 145 120S270 78 390 82M-20 150C45 130 71 160 145 130S270 88 390 92M-20 160C45 140 71 170 145 140S270 98 390 102" />
      </g>
      <path className="cycling-road-shadow" d="M-5 174L365 113" />
      <path className="cycling-road" d="M-5 172L365 111" />
      <g className="cycling-road-marks"><path d="M0 179L12 177M48 171L60 169M96 163L108 161M144 155L156 153M192 147L204 145M240 139L252 137M288 131L300 129M336 123L348 121M384 115L396 113" /></g>
      <g transform="translate(88 24) rotate(-9 90 100)">
        <g className="cycling-bike">
          <circle className="cycling-tyre" cx="50" cy="100" r="27" />
          <circle className="cycling-tyre" cx="132" cy="100" r="27" />
          <g className="cycling-wheel cycling-wheel--rear"><path d="M50 73V127M23 100H77M31 81L69 119M31 119L69 81" /></g>
          <g className="cycling-wheel cycling-wheel--front"><path d="M132 73V127M105 100H159M113 81L151 119M113 119L151 81" /></g>
          <path className="cycling-frame" d="M50 100L80 62L92 100H50ZM80 62H115L92 100M115 62L132 100" />
          <path className="cycling-metal" d="M80 62L77 53M69 53H84M115 62L112 51H125Q132 51 130 59L126 62" />
          <g className="cycling-crank"><path className="cycling-metal" d="M82 100H102M79 101H85M99 99H105" /></g>
          <circle className="cycling-hub" cx="50" cy="100" r="2" /><circle className="cycling-hub" cx="132" cy="100" r="2" />
          <g className="cycling-leg cycling-leg--back"><path d="M80 50L97 74" /><g className="cycling-shin"><path d="M97 74L87 97L94 99" /></g></g>
          <g className="cycling-rider">
            <path className="cycling-jersey" d="M77 49L91 31Q100 27 108 32L102 44L88 55Z" />
            <path className="cycling-body" d="M105 34L116 45L124 51M80 50L74 53" />
            <circle className="cycling-head" cx="113" cy="21" r="7" />
            <path className="cycling-helmet" d="M105 20Q104 9 114 10Q124 10 125 18L115 16Z" />
          </g>
          <g className="cycling-leg cycling-leg--front"><path d="M80 50L97 74" /><g className="cycling-shin"><path d="M97 74L87 97L94 99" /></g></g>
        </g>
      </g>
      <g className="cycling-marker"><path d="M303 121V94M303 94H318L313 101H303" /><circle cx="303" cy="121" r="3" /></g>
    </svg>
    {label && <p className="cycling-label" role="status">{label}</p>}
  </div>;
}
