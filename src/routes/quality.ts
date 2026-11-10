import { haversineM } from '../import/summary';
import type { Coord3 } from './analyze';

/** Geometría, no tráfico ni uso urbano del suelo: detecta retrocesos y pequeños lazos locales. */
export type GeometryQuality = { backtrackM: number; localLoops: number; penalty: number };
const STEP_M = 20;
const MATCH_M = 15;
const LOOKBACK_M = 100;
const MIN_BACKTRACK_M = 200;
const MIN_LOOP_M = 200;
const MAX_LOOP_M = 1500;

/** Muestreo a distancia fija: la medida no depende de cuántos vértices decida enviar ORS. */
export function geometryQuality(coords: Coord3[]): GeometryQuality {
  const zero = { backtrackM: 0, localLoops: 0, penalty: 0 };
  if (coords.length < 2) return zero;
  const lat0 = coords[0][1];
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180);
  type Sample = { x: number; y: number; dx: number; dy: number; d: number };
  const samples: Sample[] = [];
  let walked = 0;
  let next = STEP_M / 2;
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    const length = haversineM(ay, ax, by, bx);
    if (!length) continue;
    const dx = (bx - ax) * mx / length;
    const dy = (by - ay) * 111320 / length;
    while (next < walked + length) {
      const t = (next - walked) / length;
      samples.push({ x: (ax + (bx - ax) * t - coords[0][0]) * mx,
        y: (ay + (by - ay) * t - lat0) * 111320, dx, dy, d: next });
      next += STEP_M;
    }
    walked += length;
  }
  const cells = new Map<string, Sample[]>();
  let run = 0;
  let backtrackM = 0;
  let localLoops = 0;
  let lastLoopEnd = -Infinity;
  const flush = () => { if (run >= MIN_BACKTRACK_M) backtrackM += run; run = 0; };
  for (const s of samples) {
    const x = Math.floor(s.x / MATCH_M);
    const y = Math.floor(s.y / MATCH_M);
    let reverse = false;
    let loop = false;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const p of cells.get(`${x + dx}:${y + dy}`) ?? []) {
        const distance = s.d - p.d;
        if (distance < LOOKBACK_M || Math.hypot(s.x - p.x, s.y - p.y) > MATCH_M) continue;
        // Direcciones opuestas en el mismo corredor; no cuenta un mero cruce de calles.
        if (s.dx * p.dx + s.dy * p.dy < -0.8) reverse = true;
        // No clasificar el cierre de la vuelta entera ni un ocho de varios kilómetros como lazo urbano.
        if (distance >= MIN_LOOP_M && distance <= MAX_LOOP_M && distance < walked * 0.5 && p.d > lastLoopEnd) loop = true;
      }
    }
    if (reverse) run += STEP_M; else flush();
    if (loop) { localLoops++; lastLoopEnd = s.d; }
    const key = `${x}:${y}`;
    const cell = cells.get(key);
    if (cell) cell.push(s); else cells.set(key, [s]);
  }
  flush();
  return { backtrackM, localLoops, penalty: Math.min(0.65, backtrackM / Math.max(1, walked) * 2 + localLoops * 0.12) };
}
