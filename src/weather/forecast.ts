import { z } from 'zod';
import type { LatLng } from '../domain/types';

/**
 * Previsión horaria de Open-Meteo (gratuita, sin clave, con CORS), pedida desde el navegador. Solo viaja el punto
 * de salida redondeado a 2 decimales (cerca de 1 km): nunca el punto exacto de Casa.
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const HOURLY = ['temperature_2m', 'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];
const TZ = 'Europe/Madrid';
const FORECAST_DAYS = 7;
const CACHE_MS = 30 * 60_000;
const FIRST_HOUR = 6;
const LAST_HOUR = 21;

export type HourForecast = {
  /** Hora local de Madrid, `2026-11-17T09:00`. */
  time: string;
  tempC: number | null;
  rainPct: number | null;
  windKmh: number;
  /** Grados de los que sopla el viento. */
  windFromDeg: number;
  gustKmh: number | null;
};

export class WeatherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherError';
  }
}

export const roundPoint = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 });

export function forecastUrl(p: LatLng): string {
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lng),
    hourly: HOURLY.join(','),
    timezone: TZ,
    wind_speed_unit: 'kmh',
    forecast_days: String(FORECAST_DAYS),
  });
  // URLSearchParams escapa las comas y la barra; Open-Meteo acepta las dos formas, y así se lee mejor en la red.
  return `${ENDPOINT}?${q.toString().replace(/%2C/g, ',').replace(/%2F/g, '/')}`;
}

const column = z.array(z.number().nullable());
const responseSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: column,
    precipitation_probability: column,
    wind_speed_10m: column,
    wind_direction_10m: column,
    wind_gusts_10m: column,
  }),
});

export function parseForecast(json: unknown): HourForecast[] {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new WeatherError('La previsión llegó en un formato inesperado.');
  const h = parsed.data.hourly;
  const n = h.time.length;
  if ([h.temperature_2m, h.precipitation_probability, h.wind_speed_10m, h.wind_direction_10m, h.wind_gusts_10m].some((c) => c.length !== n)) {
    throw new WeatherError('La previsión llegó incompleta.');
  }
  const hours: HourForecast[] = [];
  for (let i = 0; i < n; i++) {
    const windKmh = h.wind_speed_10m[i];
    const windFromDeg = h.wind_direction_10m[i];
    if (windKmh === null || windFromDeg === null) continue;
    hours.push({ time: h.time[i], tempC: h.temperature_2m[i], rainPct: h.precipitation_probability[i], windKmh, windFromDeg, gustKmh: h.wind_gusts_10m[i] });
  }
  return hours;
}

const cache = new Map<string, { at: number; hours: HourForecast[] }>();
export const clearForecastCache = () => cache.clear();

/** Previsión de 7 días del punto (redondeado). Caché de 30 min en memoria; la cancelación se propaga tal cual. */
export async function fetchForecast(point: LatLng, signal?: AbortSignal): Promise<HourForecast[]> {
  const p = roundPoint(point);
  const key = `${p.lat},${p.lng}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.hours;
  let res: Response;
  try {
    res = await fetch(forecastUrl(p), { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new WeatherError('No se ha podido consultar la previsión.');
  }
  if (!res.ok) throw new WeatherError(res.status === 429 ? 'La previsión está al límite de consultas.' : 'La previsión no responde.');
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new WeatherError('La previsión llegó en un formato inesperado.');
  }
  const hours = parseForecast(json);
  cache.set(key, { at: Date.now(), hours });
  return hours;
}

export function pickHour(hours: HourForecast[], date: string, hour: number): HourForecast | null {
  const t = `${date}T${String(hour).padStart(2, '0')}:00`;
  return hours.find((h) => h.time === t) ?? null;
}

/** Fecha (`YYYY-MM-DD`) y hora de Madrid de un instante. */
function madrid(ms: number): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Hoy a la hora siguiente; de madrugada, a las 7; de noche, mañana a las 9. */
export function defaultSlot(now: number): { date: string; hour: number } {
  const { date, hour } = madrid(now);
  const next = hour + 1;
  if (next > LAST_HOUR - 1) return { date: addDays(date, 1), hour: 9 };
  return { date, hour: Math.max(7, next) };
}

export function dayOptions(now: number): { date: string; label: string }[] {
  const today = madrid(now).date;
  const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
  return Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = addDays(today, i);
    const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : fmt.format(Date.parse(`${date}T12:00:00Z`)).replace('.', '');
    return { date, label };
  });
}

/** Horas ofrecidas para un día: de 6 a 21; hoy, solo las que no han empezado. */
export function hoursFor(date: string, now: number): number[] {
  const m = madrid(now);
  const from = date === m.date ? Math.max(FIRST_HOUR, m.hour + 1) : FIRST_HOUR;
  return Array.from({ length: Math.max(0, LAST_HOUR - from + 1) }, (_, i) => from + i);
}
