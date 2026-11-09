import type { RouteGroup, StoredActivity } from '../domain/types';

/** Una vuelta a la ruta: una salida del grupo. */
export type Lap = {
  activityId: string;
  t: number;
  /** Tiempo en movimiento (s). */
  s: number;
  distM: number;
  elevM: number;
  /** Velocidad media; `null` si la salida no la trae. */
  kmh: number | null;
};

/** Una ruta repetida tal como la enseñan Repetidas y su hoja. */
export type RouteItem = {
  id: string;
  /** El de la salida más reciente; sin nombre, «Ruta sin nombre». */
  name: string;
  /** Distancia y desnivel del representante (la primera salida del grupo). */
  distM: number;
  elevM: number;
  /** Por fecha ascendente. */
  laps: Lap[];
  best: Lap;
  last: Lap;
  /** km/h de las 3 últimas frente a las anteriores, con un decimal; `null` con menos de 3 vueltas. */
  delta: number | null;
};

const lapOf = (a: StoredActivity): Lap => {
  const ms = a.totals.avgSpeedMs;
  return {
    activityId: a.id,
    t: a.startTime,
    s: a.totals.movingTimeS,
    distM: a.totals.distanceM,
    elevM: a.totals.elevGainM,
    kmh: Number.isFinite(ms) && ms > 0 ? ms * 3.6 : null,
  };
};

/**
 * Tendencia: velocidad media de las 3 últimas vueltas frente a las anteriores (las vueltas varían de
 * distancia, así que no se comparan tiempos). Con exactamente 3, frente a la primera.
 */
export function trendOf(laps: Lap[]): number | null {
  const ok = laps.filter((l): l is Lap & { kmh: number } => l.kmh !== null);
  if (ok.length < 3) return null;
  const recent = ok.slice(-3);
  const prev = ok.length > 3 ? ok.slice(0, -3) : ok.slice(0, 1);
  const avg = (a: { kmh: number }[]) => a.reduce((s, l) => s + l.kmh, 0) / a.length;
  return Math.round((avg(recent) - avg(prev)) * 10) / 10;
}

/** Por debajo de 0,2 km/h la tendencia es «Estable». */
export const TREND_FLAT = 0.2;

export function toRouteItems(groups: RouteGroup[], rides: StoredActivity[]): RouteItem[] {
  const byId = new Map(rides.map((r) => [r.id, r]));
  const out: RouteItem[] = [];
  for (const g of groups) {
    const acts = g.activityIds.map((id) => byId.get(id)).filter((a): a is StoredActivity => a !== undefined);
    if (acts.length < 2) continue;
    acts.sort((a, b) => a.startTime - b.startTime);
    const laps = acts.map(lapOf);
    const rep = byId.get(g.id) ?? acts[0];
    const last = laps[laps.length - 1];
    out.push({
      id: g.id,
      name: acts[acts.length - 1].name?.trim() || 'Ruta sin nombre',
      distM: rep.totals.distanceM,
      elevM: rep.totals.elevGainM,
      laps,
      best: laps.reduce((a, l) => (l.s < a.s ? l : a)),
      last,
      delta: trendOf(laps),
    });
  }
  return out;
}

export type RouteSort = 'veces' | 'recientes' | 'mejorando' | 'largas';

const trendKey = (r: RouteItem) => r.delta ?? -99;

export const ROUTE_SORTS: Record<RouteSort, (a: RouteItem, b: RouteItem) => number> = {
  veces: (a, b) => b.laps.length - a.laps.length || b.last.t - a.last.t,
  recientes: (a, b) => b.last.t - a.last.t,
  mejorando: (a, b) => trendKey(b) - trendKey(a),
  largas: (a, b) => b.distM - a.distM,
};

/** Puesto de la vuelta entre todas: 1 es la más rápida. */
export function lapRank(r: RouteItem, l: Lap): number {
  return r.laps.filter((q) => q.s < l.s).length + 1;
}
