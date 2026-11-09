import type { ClimbEffort, ClimbGroup, LatLng } from '../domain/types';
import { haversineM } from '../import/summary';

/** Dos pasadas son la misma subida si inicio con inicio y final con final están a menos de esto (m). */
export const SAME_CLIMB_MAX_M = 100;
/** Lado de la celda del índice de inicios (m). Al ser mayor que 2 × SAME_CLIMB_MAX_M, basta mirar las 3 × 3 vecinas. */
export const CLIMB_INDEX_CELL_M = 200;

/** Metros por grado de latitud con los que se dibuja la rejilla del índice. */
const M_PER_DEG_LAT = 111_320;

const closeM = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng) < SAME_CLIMB_MAX_M;

/** Misma subida: inicio con inicio y final con final, los dos a menos de SAME_CLIMB_MAX_M. */
export function sameClimb(
  a: Pick<ClimbEffort, 'start' | 'end'>,
  b: Pick<ClimbEffort, 'start' | 'end'>,
): boolean {
  return closeM(a.start, b.start) && closeM(a.end, b.end);
}

const rowOf = (lat: number) => Math.floor((lat * M_PER_DEG_LAT) / CLIMB_INDEX_CELL_M);

/** Columna en la fila `row`, con el coseno del centro de esa fila (la misma idea que `cellKey`). */
function colOf(row: number, lng: number): number {
  const rowCenterLat = ((row + 0.5) * CLIMB_INDEX_CELL_M) / M_PER_DEG_LAT;
  return Math.floor((lng * M_PER_DEG_LAT * Math.cos((rowCenterLat * Math.PI) / 180)) / CLIMB_INDEX_CELL_M);
}

const keyOf = (p: LatLng) => {
  const row = rowOf(p.lat);
  return `${row}:${colOf(row, p.lng)}`;
};

/** Claves de las celdas vecinas de `p`; en cada fila la columna se calcula con el coseno de esa fila. */
function neighborKeys(p: LatLng): string[] {
  const row = rowOf(p.lat);
  const keys: string[] = [];
  for (let r = row - 1; r <= row + 1; r++) {
    const col = colOf(r, p.lng);
    for (let c = col - 1; c <= col + 1; c++) keys.push(`${r}:${c}`);
  }
  return keys;
}

type Bucket = { order: number; rep: ClimbEffort; efforts: ClimbEffort[] };

/**
 * La misma subida en distintas salidas. Voraz por fecha y, dentro de la salida, por distancia: cada
 * pasada entra en el primer grupo cuyo representante (su primera pasada) es `sameClimb`; si no, abre
 * grupo. Devuelve todos los grupos, de más a menos pasadas y, a igualdad, por la última pasada más reciente.
 */
export function groupClimbs(efforts: ClimbEffort[]): ClimbGroup[] {
  const sorted = [...efforts].sort(
    (a, b) => a.activityStart - b.activityStart || a.startDistM - b.startDistM || a.id.localeCompare(b.id),
  );
  const buckets: Bucket[] = [];
  const index = new Map<string, Bucket[]>();
  for (const e of sorted) {
    let match: Bucket | undefined;
    for (const key of neighborKeys(e.start)) {
      for (const b of index.get(key) ?? []) {
        if ((!match || b.order < match.order) && sameClimb(b.rep, e)) match = b;
      }
    }
    if (match) {
      match.efforts.push(e);
      continue;
    }
    const bucket: Bucket = { order: buckets.length, rep: e, efforts: [e] };
    buckets.push(bucket);
    const key = keyOf(e.start);
    index.set(key, [...(index.get(key) ?? []), bucket]);
  }
  const lastStart = (b: Bucket) => b.efforts[b.efforts.length - 1].activityStart;
  return buckets
    .sort((a, b) => b.efforts.length - a.efforts.length || lastStart(b) - lastStart(a))
    .map(({ rep, efforts: list }) => ({
      id: rep.id,
      start: rep.start,
      end: rep.end,
      lengthM: rep.lengthM,
      avgGradePct: rep.avgGradePct,
      efforts: list,
      best: list.reduce((best, e) => (e.timeS < best.timeS ? e : best)),
    }));
}
