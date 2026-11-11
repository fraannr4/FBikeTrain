import { z } from 'zod';
import type { LatLng } from '../../domain/types';
import { haversineM } from '../../import/summary';
import type { RoutePoint } from '../library';

/**
 * Altitud estimada con el modelo de terreno de Open-Meteo (Copernicus DEM de 90 m, sin clave).
 * OpenStreetMap no trae altitud: se toman muestras cada `SAMPLE_STEP_M` y cada punto recibe la
 * altitud interpolada por distancia. La ruta se marca como estimada; solo salen coordenadas de la ruta.
 */

export const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
export const SAMPLE_STEP_M = 150;
/** Límite de Open-Meteo por petición. */
const PER_REQUEST = 100;
/** 1.000 muestras cubren 150 km; las rutas más largas se muestrean más espaciado. */
const MAX_SAMPLES = 1000;

const response = z.object({ elevation: z.array(z.number().min(-500).max(9000)) });

const gap = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng);

function cumulative(points: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + gap(points[i - 1], points[i]));
  return out;
}

/** Punto a `d` metros del inicio de la línea. */
function pointAt(points: LatLng[], cum: number[], d: number): LatLng {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const span = cum[i] - cum[i - 1];
  const t = span > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]) / span)) : 0;
  const a = points[i - 1];
  const b = points[i];
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Distancias de muestreo, incluido el final. */
export function sampleDistances(totalM: number): number[] {
  const count = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(totalM / SAMPLE_STEP_M) + 1));
  return Array.from({ length: count }, (_, i) => (totalM * i) / (count - 1));
}

async function fetchBatch(batch: LatLng[], signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<number[]> {
  const url = new URL(ELEVATION_URL);
  url.searchParams.set('latitude', batch.map((p) => p.lat.toFixed(5)).join(','));
  url.searchParams.set('longitude', batch.map((p) => p.lng.toFixed(5)).join(','));
  const res = await fetchImpl(url.href, { signal });
  if (!res.ok) throw new Error(`elevation ${res.status}`);
  const parsed = response.safeParse(await res.json());
  if (!parsed.success || parsed.data.elevation.length !== batch.length) throw new Error('elevation shape');
  return parsed.data.elevation;
}

/** Devuelve los puntos con `ele` estimada. Si Open-Meteo falla, lanza: quien llama guarda la ruta sin altitud. */
export async function withDemElevation(points: LatLng[], signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<RoutePoint[]> {
  const cum = cumulative(points);
  const total = cum[cum.length - 1];
  const at = sampleDistances(total);
  const samples = at.map((d) => pointAt(points, cum, d));
  const elevations: number[] = [];
  for (let i = 0; i < samples.length; i += PER_REQUEST) {
    signal?.throwIfAborted();
    elevations.push(...(await fetchBatch(samples.slice(i, i + PER_REQUEST), signal, fetchImpl)));
  }
  let j = 1;
  return points.map((p, i) => {
    const d = cum[i];
    while (j < at.length - 1 && at[j] < d) j++;
    const span = at[j] - at[j - 1];
    const t = span > 0 ? Math.min(1, Math.max(0, (d - at[j - 1]) / span)) : 0;
    const ele = elevations[j - 1] + (elevations[j] - elevations[j - 1]) * t;
    return { lat: p.lat, lng: p.lng, ele: Math.round(ele * 10) / 10 };
  });
}
