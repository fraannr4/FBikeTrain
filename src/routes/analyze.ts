import { ELEVATION_HYSTERESIS_M, haversineM } from '../import/summary';
import type { OrsExtra, OrsFeature } from './ors';

/** Candidata de ORS medida por el código: distancia, desnivel, superficie, tipo de vía y pendiente. */

export type Coord3 = [lng: number, lat: number, ele: number];
/** Tramo de pendiente en metros acumulados; `cls` de −5 a 5 según la tabla `steepness` de ORS. */
export type SteepSegment = { fromM: number; toM: number; cls: number };

export type RouteCandidate = {
  id: string;
  seed: number;
  coords: Coord3[];
  distanceM: number;
  elevGainM: number;
  unpavedM: number;
  trackM: number;
  mainRoadPct: number;
  unknownSurfacePct: number;
  /** Algún tramo de autopista según `waycategory`. */
  motorway: boolean;
  steep: SteepSegment[];
  profile: { dM: number; ele: number }[];
  maxSteepCls: number;
};

/** Superficies de ORS sin asfaltar. Adoquín (5) y desconocida (0) no cuentan. */
export const UNPAVED_SURFACES: ReadonlySet<number> = new Set([2, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18]);
const SURFACE_UNKNOWN = 0;
/** Superficies firmes (asfaltado, asfalto, hormigón, adoquín liso): una pista así se rueda en carretera. */
const PAVED_SURFACES: ReadonlySet<number> = new Set([1, 3, 4, 14]);
const WAYTYPE_STATE_ROAD = 1;
const WAYTYPE_TRACK = 5;
/** Tipos de vía de ORS que son carretera o calle: principal (1), carretera (2) y calle (3). */
const ROAD_WAYTYPES: ReadonlySet<number> = new Set([1, 2, 3]);
/** Bit de `waycategory` de ORS para `highway=motorway` y `motorway_link`. */
const WAYCATEGORY_MOTORWAY = 1;

/**
 * Longitud: la distancia pedida es un techo blando. Se admite hasta un 20 % por debajo y solo un
 * 8 % por encima (50 km: de 40 a 54).
 */
export const ROAD_FILTER = { maxUnpavedM: 100, maxTrackM: 100, maxMainRoadPct: 20, lengthUnder: 0.2, lengthOver: 0.08 };

export type RejectReason = 'autopista' | 'sin asfaltar' | 'pistas' | 'carretera principal' | 'longitud';

const sumSummary = (extra: OrsExtra, field: 'distance' | 'amount', match: (value: number) => boolean) =>
  extra.summary.reduce((sum, s) => (match(s.value) ? sum + s[field] : sum), 0);

/**
 * Algún tramo de autopista: `waycategory` es un campo de bits y el 1 es autopista. ORS no separa las
 * autovías (`trunk`) de las nacionales: van juntas en «State Road» y se limitan como carretera principal.
 */
export function usesMotorway(waycategory: OrsExtra): boolean {
  const motorway = (v: number) => (v & WAYCATEGORY_MOTORWAY) !== 0;
  return waycategory.values.some(([, , v]) => motorway(v)) || waycategory.summary.some((s) => motorway(s.value));
}

/** Distancia acumulada en cada punto (m). */
function cumulativeM(coords: Coord3[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    cum.push(cum[i - 1] + haversineM(aLat, aLng, bLat, bLng));
  }
  return cum;
}

/** Desnivel positivo con la misma histéresis que el historial. */
function elevationGainM(coords: Coord3[]): number {
  let gain = 0;
  let ref: number | undefined;
  for (const [, , ele] of coords) {
    if (ref === undefined || ref - ele >= ELEVATION_HYSTERESIS_M) {
      ref = ele;
    } else if (ele - ref >= ELEVATION_HYSTERESIS_M) {
      gain += ele - ref;
      ref = ele;
    }
  }
  return gain;
}

/**
 * Metros de pista sin firme confirmado. En el monte catalán muchas pistas están asfaltadas: esas no
 * cuentan. Sin tramos por índice (respuestas antiguas), cuenta toda la pista del resumen.
 */
function roughTrackM(waytypes: OrsExtra, surface: OrsExtra, cum: number[]): number {
  const tracks = waytypes.values.filter(([, , v]) => v === WAYTYPE_TRACK);
  if (tracks.length === 0) return sumSummary(waytypes, 'distance', (v) => v === WAYTYPE_TRACK);
  const at = (i: number) => cum[Math.min(i, cum.length - 1)] ?? 0;
  let m = 0;
  for (const [from, to] of tracks) {
    m += at(to) - at(from);
    for (const [sFrom, sTo, value] of surface.values) {
      if (!PAVED_SURFACES.has(value)) continue;
      const a = Math.max(from, sFrom);
      const b = Math.min(to, sTo);
      if (b > a) m -= at(b) - at(a);
    }
  }
  return Math.max(0, m);
}

/**
 * Porcentaje de la ruta sin dato de firme fuera de carreteras y calles. En OSM muchas carreteras comarcales no
 * declaran `surface`: ahí el dato que falta no indica tierra; en un camino o una senda, sí puede.
 * Sin tramos por índice, cuenta todo el firme desconocido del resumen.
 */
export function unknownSurfaceOffRoadPct(f: OrsFeature): number {
  const { surface, waytypes } = f.properties.extras;
  const unknown = surface.values.filter(([, , v]) => v === SURFACE_UNKNOWN);
  if (surface.values.length === 0 || waytypes.values.length === 0) return sumSummary(surface, 'amount', (v) => v === SURFACE_UNKNOWN);
  const cum = cumulativeM(f.geometry.coordinates);
  const at = (i: number) => cum[Math.min(i, cum.length - 1)] ?? 0;
  let m = 0;
  for (const [from, to] of unknown) {
    for (const [wFrom, wTo, value] of waytypes.values) {
      if (ROAD_WAYTYPES.has(value)) continue;
      const a = Math.max(from, wFrom);
      const b = Math.min(to, wTo);
      if (b > a) m += at(b) - at(a);
    }
  }
  const total = cum[cum.length - 1] ?? 0;
  return total > 0 ? (m / total) * 100 : 0;
}

/** Un tramo malo más corto que esto no se señala: suele ser un cruce o un error de etiquetado. */
const MIN_ROUGH_SPOT_M = 50;

/**
 * Punto medio de cada tramo seguido sin asfaltar o de pista sin firme confirmado. Sirve para pedir a ORS
 * que no vuelva a pasar por ahí.
 */
export function roughSpots(f: OrsFeature): { lat: number; lng: number }[] {
  const coords = f.geometry.coordinates;
  const { surface, waytypes } = f.properties.extras;
  const segments = Math.max(0, coords.length - 1);
  const mark = (extra: OrsExtra, match: (value: number) => boolean): boolean[] => {
    const out = new Array<boolean>(segments).fill(false);
    for (const [from, to, value] of extra.values) if (match(value)) out.fill(true, from, Math.min(to, segments));
    return out;
  };
  const unpaved = mark(surface, (v) => UNPAVED_SURFACES.has(v));
  const paved = mark(surface, (v) => PAVED_SURFACES.has(v));
  const track = mark(waytypes, (v) => v === WAYTYPE_TRACK);
  const cum = cumulativeM(coords);
  const spots: { lat: number; lng: number }[] = [];
  for (let i = 0; i < segments; i++) {
    const rough = (k: number) => unpaved[k] || (track[k] && !paved[k]);
    if (!rough(i)) continue;
    let end = i;
    while (end + 1 < segments && rough(end + 1)) end++;
    if (cum[end + 1] - cum[i] >= MIN_ROUGH_SPOT_M) {
      const [lng, lat] = coords[Math.round((i + end + 1) / 2)];
      spots.push({ lat, lng });
    }
    i = end;
  }
  return spots;
}

/** Distancia y desnivel salen de las coordenadas, no del `summary` de ORS, para medir igual que el historial. */
export function analyzeRoute(f: OrsFeature, seed: number): RouteCandidate {
  const coords = f.geometry.coordinates;
  const { surface, waytypes, steepness, waycategory } = f.properties.extras;
  const cum = cumulativeM(coords);
  const distanceM = cum[cum.length - 1] ?? 0;
  const steep = steepness.values.map(([from, to, cls]) => ({ fromM: cum[from], toM: cum[to], cls }));

  return {
    id: `${seed}-${Math.round(distanceM)}`,
    seed,
    coords,
    distanceM,
    elevGainM: elevationGainM(coords),
    unpavedM: sumSummary(surface, 'distance', (v) => UNPAVED_SURFACES.has(v)),
    trackM: roughTrackM(waytypes, surface, cum),
    mainRoadPct: sumSummary(waytypes, 'amount', (v) => v === WAYTYPE_STATE_ROAD),
    unknownSurfacePct: sumSummary(surface, 'amount', (v) => v === SURFACE_UNKNOWN),
    motorway: waycategory ? usesMotorway(waycategory) : false,
    steep,
    profile: coords.map(([, , ele], i) => ({ dM: cum[i], ele })),
    maxSteepCls: Math.max(0, ...steep.map((s) => s.cls)),
  };
}

/** Motivo por el que una candidata no es de carretera o no se ajusta al objetivo; `null` si pasa. */
export function rejectReason(c: RouteCandidate, targetM: number): RejectReason | null {
  if (c.motorway) return 'autopista';
  if (c.unpavedM > ROAD_FILTER.maxUnpavedM) return 'sin asfaltar';
  if (c.trackM > ROAD_FILTER.maxTrackM) return 'pistas';
  if (c.mainRoadPct > ROAD_FILTER.maxMainRoadPct) return 'carretera principal';
  if (c.distanceM < targetM * (1 - ROAD_FILTER.lengthUnder) || c.distanceM > targetM * (1 + ROAD_FILTER.lengthOver)) return 'longitud';
  return null;
}
