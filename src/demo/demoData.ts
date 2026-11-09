/**
 * Datos de demostración: unas 200 salidas sintéticas en los 14 meses anteriores a `now`, con track y
 * altura, rutas que se repiten y puertos que se suben una y otra vez, más entrenos del calendario y
 * objetivos. Todo es inventado y determinista (misma fecha, mismos datos): las coordenadas salen de
 * curvas cerradas alrededor de un punto de campo del interior de Cataluña, no de ningún track real
 * ni de ninguna casa. Todo lo que se guarda lleva el prefijo `demo-` para poder borrarlo sin tocar
 * los datos propios.
 */
import { ensureAnalysis } from '../analysis/analysis';
import { db, type TrackRow } from '../db/db';
import type { Goal, PlannedWorkout, StoredActivity, TrackPoint } from '../domain/types';
import { computeTotals } from '../import/summary';
import { TZ } from '../metrics/aggregate';
import { localDay, periodStartOf } from '../metrics/calendar';

export const DEMO_PREFIX = 'demo-';

export type DemoData = {
  activities: StoredActivity[];
  tracks: TrackRow[];
  workouts: PlannedWorkout[];
  goals: Goal[];
};

const DAY = 86_400_000;
const HISTORY_DAYS = 425; // 14 meses
/** Punto de partida de todas las rutas: campo abierto, sintético. */
const HUB = { lat: 41.955, lng: 2.02 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((HUB.lat * Math.PI) / 180);
/** Separación entre puntos del track (m), como un track ya simplificado. */
const SPACING_M = 50;

/** Generador pseudoaleatorio con semilla (mulberry32): mismos números para la misma semilla. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Puerto: cima a `at` (fracción de la ruta), `up` metros de subida y `rise` metros de desnivel. */
type Hill = { at: number; up: number; rise: number };
type Template = {
  name: string;
  km: number;
  /** Rumbo del bucle (rad) y forma: armónicos de la curva cerrada. */
  heading: number;
  shape: [number, number, number, number];
  hills: Hill[];
  /** Para fines de semana (`long`) o para entre semana (`short`). */
  kind: 'long' | 'short' | 'any';
  /** Fracción del año desde la que ya se hace (las largas llegan con la forma). */
  from: number;
};

// Nombres de lugares de la zona; las rutas y sus coordenadas son inventadas.
const TEMPLATES: Template[] = [
  { name: 'Vuelta corta a Tona', km: 41, heading: 2.6, shape: [0.22, 0.1, 0.4, 1.9], hills: [{ at: 0.38, up: 2200, rise: 95 }], kind: 'short', from: 0 },
  { name: 'Collsuspina y Moià', km: 87.6, heading: 3.6, shape: [0.28, 0.12, 1.1, 0.2], hills: [{ at: 0.27, up: 5000, rise: 360 }, { at: 0.64, up: 3000, rise: 170 }], kind: 'long', from: 0 },
  { name: 'Lluçanès por Prats', km: 64, heading: 4.4, shape: [0.2, 0.14, 2.3, 0.9], hills: [{ at: 0.3, up: 4000, rise: 250 }, { at: 0.72, up: 2400, rise: 130 }], kind: 'any', from: 0 },
  { name: 'Coll de Bracons', km: 72, heading: 0.6, shape: [0.26, 0.08, 0.3, 2.8], hills: [{ at: 0.46, up: 6500, rise: 600 }], kind: 'long', from: 0.15 },
  { name: 'Pantano de Sau', km: 55, heading: 0.1, shape: [0.18, 0.12, 1.7, 1.2], hills: [{ at: 0.6, up: 3500, rise: 290 }], kind: 'any', from: 0 },
  { name: 'Rupit por el Collsacabra', km: 96, heading: 1.1, shape: [0.3, 0.1, 2.9, 0.4], hills: [{ at: 0.32, up: 6000, rise: 470 }, { at: 0.66, up: 3000, rise: 190 }], kind: 'long', from: 0.25 },
  { name: 'Santa Maria de Besora', km: 78, heading: 1.6, shape: [0.24, 0.1, 0.8, 2.2], hills: [{ at: 0.42, up: 5000, rise: 410 }], kind: 'long', from: 0.05 },
  { name: 'Alpens y el Collet', km: 58, heading: 5.2, shape: [0.2, 0.12, 2.0, 0.6], hills: [{ at: 0.5, up: 4500, rise: 370 }], kind: 'any', from: 0 },
  { name: 'Oristà y Olost', km: 49, heading: 3.9, shape: [0.16, 0.1, 1.3, 2.6], hills: [{ at: 0.42, up: 1800, rise: 85 }, { at: 0.76, up: 1800, rise: 80 }], kind: 'short', from: 0 },
  { name: 'Puerto de Merlès', km: 68, heading: 4.9, shape: [0.22, 0.12, 0.5, 1.5], hills: [{ at: 0.55, up: 3000, rise: 250 }], kind: 'any', from: 0 },
  { name: 'Gran vuelta del Ripollès', km: 132, heading: 1.9, shape: [0.32, 0.1, 1.6, 0.7], hills: [{ at: 0.22, up: 6000, rise: 480 }, { at: 0.56, up: 7000, rise: 610 }, { at: 0.82, up: 3000, rise: 190 }], kind: 'long', from: 0.45 },
  { name: 'Seva y el Montseny', km: 110, heading: 3.1, shape: [0.28, 0.1, 2.5, 1.0], hills: [{ at: 0.36, up: 6500, rise: 690 }, { at: 0.72, up: 2500, rise: 140 }], kind: 'long', from: 0.35 },
];

type Geo = { x: number[]; y: number[]; d: number[]; ele: number[]; grade: number[] };

/** Altura limpia (sin ruido) a `x` metros: llano ondulado y los puertos como campanas de coseno. */
function elevationAt(t: Template, x: number, total: number, phase: number): number {
  let e = 540 + 32 * Math.sin((2 * Math.PI * x) / 9000 + phase) + 14 * Math.sin((2 * Math.PI * x) / 3100);
  for (const h of t.hills) {
    const c = h.at * total;
    if (Math.abs(x - c) < h.up) e += (h.rise * (1 + Math.cos((Math.PI * (x - c)) / h.up))) / 2;
  }
  return e;
}

/**
 * Geometría de una plantilla, remuestreada cada SPACING_M: curva cerrada (armónicos 2 y 3 y un
 * serpenteo de carretera) que empieza y acaba en el punto de partida, escalada a su distancia.
 */
function buildGeo(t: Template, index: number): Geo {
  const [a1, a2, p1, p2] = t.shape;
  const N = 1440;
  const unit = (th: number) => {
    const r = 1 + a1 * Math.sin(2 * th + p1) + a2 * Math.sin(3 * th + p2) + 0.05 * Math.sin(13 * th + p1);
    return [Math.cos(th) * r, Math.sin(th) * r * 0.82];
  };
  // Empieza en el lado opuesto al rumbo: el bucle se aleja de la salida en esa dirección.
  const th0 = t.heading + Math.PI;
  const [sx, sy] = unit(th0);
  const cos = Math.cos(t.heading);
  const sin = Math.sin(t.heading);
  const raw: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const [ux, uy] = unit(th0 + (i / N) * 2 * Math.PI);
    const dx = ux - sx;
    const dy = uy - sy;
    raw.push([dx * cos - dy * sin, dx * sin + dy * cos]);
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = t.km * 1000;
  const scale = total / cum[cum.length - 1];

  const geo: Geo = { x: [], y: [], d: [], ele: [], grade: [] };
  const phase = index * 1.37;
  let j = 1;
  for (let dist = 0; dist <= total; dist += SPACING_M) {
    const u = dist / scale;
    while (j < cum.length - 1 && cum[j] < u) j++;
    const f = (u - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    geo.x.push((raw[j - 1][0] + f * (raw[j][0] - raw[j - 1][0])) * scale);
    geo.y.push((raw[j - 1][1] + f * (raw[j][1] - raw[j - 1][1])) * scale);
    geo.d.push(dist);
    geo.ele.push(elevationAt(t, dist, total, phase));
  }
  for (let i = 0; i < geo.ele.length; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(geo.ele.length - 1, i + 1);
    geo.grade.push(((geo.ele[b] - geo.ele[a]) / ((b - a) * SPACING_M)) * 100);
  }
  return geo;
}

/** Track de una salida por la plantilla: ruido de GPS de pocos metros, velocidad según pendiente y forma. */
function rideTrack(geo: Geo, start: number, form: number, rand: () => number, stopAt: number | null): TrackPoint[] {
  const v0 = 8.1 * form; // ~29 km/h en llano con la forma de referencia
  const pts: TrackPoint[] = [];
  let t = start;
  for (let i = 0; i < geo.x.length; i++) {
    if (i > 0) {
      const g = geo.grade[i];
      let v = g > 0 ? v0 / (1 + 0.21 * g) : Math.min(v0 * (1 + 0.05 * -g), 16);
      v = Math.max(2.3, v * (0.96 + rand() * 0.08));
      t += Math.round((SPACING_M / v) * 1000);
      if (stopAt !== null && i === stopAt) t += Math.round((11 + rand() * 9) * 60_000); // parada a por agua o café
    }
    const nx = geo.x[i] + (rand() - 0.5) * 6;
    const ny = geo.y[i] + (rand() - 0.5) * 6;
    pts.push({
      t,
      lat: round6(HUB.lat + ny / M_PER_DEG_LAT),
      lng: round6(HUB.lng + nx / M_PER_DEG_LNG),
      ele: Math.round((geo.ele[i] + (rand() - 0.5) * 1.2) * 10) / 10,
    });
  }
  return pts;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Punto de la parada, desde `at` (índice del track): ya bajando, 15 m por debajo del último alto.
 * Una subida se cierra al bajar más de 10 m desde su cima, así que la parada nunca cae dentro de
 * una (ni en un puerto ni en un repecho), y el tiempo de esa pasada no se dispara.
 */
function stopIndex(geo: Geo, at: number): number {
  let peak = Math.round(at);
  for (let i = peak; i < geo.ele.length; i++) {
    if (geo.ele[i] > geo.ele[peak]) peak = i;
    else if (geo.ele[peak] - geo.ele[i] > 15 && geo.grade[i] < 0) return i;
  }
  return Math.round(at);
}

/** Probabilidad de salir según el día de la semana (domingo = 0). */
const DAY_P = [0.9, 0.12, 0.6, 0.28, 0.62, 0.12, 0.95];
/** Menos salidas en invierno, más en verano (mes 0 = enero). */
const MONTH_F = [0.72, 0.78, 0.92, 1, 1.05, 1.08, 1.1, 1.02, 1.05, 1, 0.88, 0.74];

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

function monthTitle(now: number): string {
  const m = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: TZ }).format(now);
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** Genera los datos de demostración para la fecha `now`. Puro y determinista. */
export function generateDemo(now: number): DemoData {
  const rand = rng(20261106);
  const geos = TEMPLATES.map(buildGeo);
  const today0 = Math.floor(now / DAY) * DAY; // medianoche UTC de hoy
  const activities: StoredActivity[] = [];
  const tracks: TrackRow[] = [];
  let n = 0;

  for (let k = HISTORY_DAYS; k >= 1; k--) {
    const day0 = today0 - k * DAY;
    const date = new Date(day0);
    const wd = date.getUTCDay();
    const month = date.getUTCMonth();
    const forced = k === 1 || k === HISTORY_DAYS;
    const r = rand();
    if (!forced && r > DAY_P[wd] * MONTH_F[month]) continue;

    const progress = 1 - k / HISTORY_DAYS; // 0 hace 14 meses, 1 hoy
    const weekend = wd === 0 || wd === 6;
    const id = `${DEMO_PREFIX}${String(++n).padStart(3, '0')}`;

    // Algún día de invierno entre semana, rodillo: sin GPS.
    if ((month === 0 || month === 1 || month === 11) && (wd === 1 || wd === 3 || wd === 5)) {
      const movingTimeS = Math.round(3300 + rand() * 1200);
      const avgSpeedMs = 8.2 + rand() * 0.6;
      activities.push({
        id,
        startTime: day0 + Math.round((17.5 + rand()) * 3_600_000),
        sport: 'cycling',
        name: 'Rodillo',
        totals: {
          distanceM: Math.round(movingTimeS * avgSpeedMs),
          movingTimeS,
          elapsedTimeS: movingTimeS + 60,
          elevGainM: 0,
          avgSpeedMs,
          maxSpeedMs: avgSpeedMs + 1.4,
        },
        hasTrack: false,
        source: 'strava-archive',
        importedAt: now,
      });
      continue;
    }

    const pool = TEMPLATES.map((t, i) => ({ t, i })).filter(
      ({ t }) => t.from <= progress && (t.kind === 'any' || t.kind === (weekend ? 'long' : 'short')),
    );
    const { t, i } = pick(pool, rand);
    // Forma: mejora a lo largo del año, un poco más en verano, y cada día es distinto.
    const form = 0.9 + 0.1 * progress + (month >= 5 && month <= 8 ? 0.02 : 0) + (rand() - 0.5) * 0.05;
    const startH = weekend ? 7.4 + rand() * 1.4 : month >= 3 && month <= 8 ? 15.6 + rand() : 10.5 + rand();
    const geo = geos[i];
    const stopAt = t.km > 60 ? stopIndex(geo, geo.x.length * (0.5 + rand() * 0.1)) : null;
    const points = rideTrack(geo, day0 + Math.round(startH * 3_600_000), form, rand, stopAt);
    const r2 = rand();
    const name = r2 < 0.1 ? (startH < 12 ? 'Bicicleta por la mañana' : 'Bicicleta por la tarde') : t.name;
    activities.push({
      id,
      startTime: points[0].t,
      sport: 'cycling',
      name,
      totals: computeTotals(points),
      hasTrack: true,
      source: 'strava-archive',
      importedAt: now,
    });
    tracks.push({ activityId: id, points });
  }

  return { activities, tracks, workouts: demoWorkouts(now, activities), goals: demoGoals(now) };
}

function demoWorkouts(now: number, activities: StoredActivity[]): PlannedWorkout[] {
  const recent = activities.filter((a) => now - a.startTime < 21 * DAY);
  const rideDays = new Set(activities.map((a) => localDay(a.startTime)));
  const out: PlannedWorkout[] = [];
  const add = (w: Omit<PlannedWorkout, 'id' | 'manual' | 'createdAt'>) =>
    out.push({ ...w, id: `${DEMO_PREFIX}w-${out.length + 1}`, manual: false, createdAt: now });

  // Hechos: el plan de las últimas tres semanas, enlazado a la salida de ese día.
  recent.forEach((a, i) => {
    if (i % 3 === 2) return;
    add({
      date: localDay(a.startTime),
      title: a.name && !a.name.startsWith('Bicicleta') ? a.name : 'Rodaje',
      distanceM: Math.round(a.totals.distanceM / 5000) * 5000,
      elevGainM: Math.round(a.totals.elevGainM / 100) * 100,
      done: true,
      activityId: a.id,
    });
  });
  // Perdidos: dos días entre semana sin salida.
  let missed = 0;
  for (let k = 2; k <= 20 && missed < 2; k++) {
    const d = localDay(now - k * DAY);
    const wd = new Date(now - k * DAY).getUTCDay();
    if (rideDays.has(d) || wd === 0 || wd === 6) continue;
    add({ date: d, title: missed === 0 ? 'Rodaje suave' : 'Series en Collsuspina', distanceM: missed === 0 ? 45_000 : 55_000, done: false });
    missed++;
  }
  // Pendientes: mañana, pasado y la semana que viene.
  const next = [
    { days: 1, title: 'Lluçanès por Prats', distanceM: 64_000, elevGainM: 900, notes: 'Ritmo cómodo; prueba la bajada de Merlès.' },
    { days: 3, title: 'Rodaje suave', distanceM: 45_000 },
    { days: 6, title: 'Coll de Bracons', distanceM: 72_000, elevGainM: 1100 },
    { days: 9, title: 'Collsuspina y Moià', distanceM: 88_000, elevGainM: 1300 },
  ];
  for (const w of next) {
    const { days, ...rest } = w;
    add({ ...rest, date: localDay(now + days * DAY), done: false });
  }
  return out;
}

function demoGoals(now: number): Goal[] {
  const today = localDay(now);
  return [
    { kind: 'volume', id: `${DEMO_PREFIX}g-semana`, title: 'Esta semana', period: 'week', start: periodStartOf('week', today), distanceM: 200_000, elevGainM: 3000, createdAt: now },
    { kind: 'volume', id: `${DEMO_PREFIX}g-mes`, title: monthTitle(now), period: 'month', start: periodStartOf('month', today), distanceM: 800_000, elevGainM: 12_000, createdAt: now },
    { kind: 'event', id: `${DEMO_PREFIX}g-marxa`, title: 'Marxa del Lluçanès', date: localDay(now + 37 * DAY), distanceM: 140_000, elevGainM: 2600, createdAt: now },
  ];
}

/** ¿Hay salidas de demostración guardadas? */
export async function hasDemoData(): Promise<boolean> {
  return (await db.activities.where('id').startsWith(DEMO_PREFIX).count()) > 0;
}

/** Borra todo lo de demostración (salidas, tracks, análisis, entrenos y objetivos) sin tocar lo propio. */
export async function clearDemoData(): Promise<void> {
  await db.transaction('rw', [db.activities, db.tracks, db.climbEfforts, db.routeSigs, db.calendar, db.goals], async () => {
    await db.activities.where('id').startsWith(DEMO_PREFIX).delete();
    await db.tracks.where('activityId').startsWith(DEMO_PREFIX).delete();
    await db.climbEfforts.where('activityId').startsWith(DEMO_PREFIX).delete();
    await db.routeSigs.where('activityId').startsWith(DEMO_PREFIX).delete();
    await db.calendar.where('id').startsWith(DEMO_PREFIX).delete();
    await db.goals.where('id').startsWith(DEMO_PREFIX).delete();
  });
}

/**
 * Sustituye los datos de demostración por unos nuevos para la fecha `now` y analiza las salidas
 * (subidas y rutas). No toca los datos propios ni la fecha de la última importación. Devuelve
 * cuántas salidas guardó.
 */
export async function loadDemoData(now: number = Date.now(), onProgress?: (done: number, total: number) => void): Promise<number> {
  const demo = generateDemo(now);
  await clearDemoData();
  await db.transaction('rw', [db.activities, db.tracks, db.calendar, db.goals], async () => {
    await db.activities.bulkAdd(demo.activities);
    await db.tracks.bulkAdd(demo.tracks);
    await db.calendar.bulkAdd(demo.workouts);
    await db.goals.bulkAdd(demo.goals);
  });
  await ensureAnalysis(onProgress);
  return demo.activities.length;
}
