export type LatLng = { lat: number; lng: number };

/** Coordenada de ruta en el orden de ORS GeoJSON: longitud, latitud y altura en metros. */
export type Coord3 = [lng: number, lat: number, ele: number];

/** Punto de un track. `t` en epoch ms; distancias en metros; velocidad en m/s. */
export type TrackPoint = {
  t: number;
  lat?: number;
  lng?: number;
  ele?: number;
  dist?: number;
  speed?: number;
  cad?: number;
  hr?: number;
  power?: number;
};

export type ActivityTotals = {
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  elevGainM: number;
  avgSpeedMs: number;
  maxSpeedMs: number;
  avgCadence?: number;
  avgHr?: number;
  avgPower?: number;
};

export type Settings = {
  displayName: string;
  home: LatLng | null;
  ors: { apiKey: string };
  llm: { baseUrl: string; apiKey: string; model: string };
};

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' | 'network' | 'cors' | 'other'; detail: string };

/** Salida leída de un fichero, antes de guardarla. */
export type ParsedActivity = {
  startTime: number;
  sport: 'cycling' | 'other';
  name?: string;
  totals: ActivityTotals;
  points: TrackPoint[];
  source: 'gpx' | 'tcx' | 'fit' | 'strava-archive';
  externalId?: string;
};

/** Error de lectura de un fichero; `reason` va al informe de importación. */
export class ParseError extends Error {
  constructor(
    public reason: 'empty' | 'malformed' | 'unsupported',
    msg: string,
  ) {
    super(msg);
    this.name = 'ParseError';
  }
}

/** Actividad guardada en IndexedDB (sin puntos; el track va aparte). */
export type StoredActivity = {
  id: string;
  startTime: number;
  sport: 'cycling';
  name?: string;
  totals: ActivityTotals;
  hasTrack: boolean;
  source: ParsedActivity['source'];
  importedAt: number;
};

/** Subida detectada en un track. Índices en el track original; distancias en m, tiempo en s, VAM en m/h. */
export type DetectedClimb = {
  startIdx: number;
  endIdx: number;
  start: LatLng;
  end: LatLng;
  startDistM: number;
  lengthM: number;
  gainM: number;
  avgGradePct: number;
  timeS: number;
  avgSpeedMs: number;
  vamMh: number;
};

/** Pasada por una subida en una salida. `id` es `${activityId}_${n}`; `activityStart` en epoch ms. */
export type ClimbEffort = DetectedClimb & { id: string; activityId: string; activityStart: number };

/**
 * La misma subida en distintas salidas. `id`, `start`, `end`, `lengthM` y `avgGradePct` son los del
 * representante (la primera pasada); `efforts` por `activityStart` ascendente; `best`, la de menor `timeS`.
 */
export type ClimbGroup = {
  id: string;
  start: LatLng;
  end: LatLng;
  lengthM: number;
  avgGradePct: number;
  efforts: ClimbEffort[];
  best: ClimbEffort;
};

/** Firma del trazado de una salida: las celdas de la rejilla por las que pasa, sin repetidos. */
export type RouteSig = {
  activityId: string;
  activityStart: number;
  distanceM: number;
  cells: string[];
};

/** Salidas por la misma ruta. `id` es la del representante; `activityIds` por fecha ascendente. */
export type RouteGroup = { id: string; activityIds: string[] };

/** Día local de Madrid como texto `yyyy-MM-dd`. */
export type LocalDate = string;

/** Entreno planificado. `manual`: el usuario lo marcó o desmarcó a mano y la sincronización no lo toca. */
export type PlannedWorkout = {
  id: string;
  date: LocalDate;
  title: string;
  distanceM?: number;
  elevGainM?: number;
  notes?: string;
  done: boolean;
  activityId?: string;
  manual: boolean;
  createdAt: number;
};

/** Objetivo con fecha: una marcha o un evento. */
export type EventGoal = {
  kind: 'event';
  id: string;
  title: string;
  date: LocalDate;
  distanceM?: number;
  elevGainM?: number;
  createdAt: number;
};

/**
 * Objetivo de volumen por semana ISO o mes natural. `start` es el lunes o el día 1 del periodo.
 * `period` coincide con `Period` de `metrics/aggregate`, escrito literal para no depender de `metrics`.
 */
export type VolumeGoal = {
  kind: 'volume';
  id: string;
  title: string;
  period: 'week' | 'month';
  start: LocalDate;
  distanceM?: number;
  elevGainM?: number;
  movingTimeS?: number;
  createdAt: number;
};

export type Goal = EventGoal | VolumeGoal;
