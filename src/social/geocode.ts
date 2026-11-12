export type Place = { name: string; lat: number; lng: number };

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const FAILED = 'No se ha podido buscar el pueblo.';
/** Política de uso de Nominatim: como mucho una petición por segundo y sin clave. */
const MIN_GAP_MS = 1000;
let nextSlot = 0;

function waitTurn(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, wait);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/**
 * Busca poblaciones (no direcciones: `featureType=settlement`) para fijar la zona del usuario.
 * Con menos de 3 letras no llama. Una cancelación se propaga como `AbortError`.
 */
export async function searchPlaces(q: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<Place[]> {
  const term = q.trim();
  if (term.length < 3) return [];
  const params = new URLSearchParams({ format: 'jsonv2', limit: '5', 'accept-language': 'es', featureType: 'settlement', q: term });
  let rows: { display_name?: unknown; lat?: unknown; lon?: unknown }[];
  try {
    await waitTurn(signal);
    const res = await fetchImpl(`${SEARCH_URL}?${params}`, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(FAILED);
    rows = await res.json();
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
    throw new Error(FAILED);
  }
  if (!Array.isArray(rows)) throw new Error(FAILED);
  return rows.flatMap((r) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    const name = String(r.display_name ?? '').slice(0, 80).trim();
    return name && Number.isFinite(lat) && Number.isFinite(lng) ? [{ name, lat, lng }] : [];
  });
}
