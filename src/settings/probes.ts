import type { ProbeResult, Settings } from '../domain/types';
import { ORS_ROAD_URL } from '../routes/endpoint';

// Dos puntos cercanos en Madrid: la ruta más corta posible, para gastar poca cuota.
const ORS_PROBE_BODY = JSON.stringify({
  coordinates: [
    [-3.7038, 40.4168],
    [-3.7, 40.418],
  ],
});

async function probe(url: string, init: RequestInit): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // El navegador da el mismo TypeError para un fallo de red y para un bloqueo CORS.
    if (e instanceof TypeError) return { ok: false, reason: 'network', detail: e.message };
    return { ok: false, reason: 'other', detail: String(e) };
  }
  if (res.ok) return { ok: true };
  const detail = `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', detail };
  return { ok: false, reason: 'other', detail };
}

export function probeOrs(apiKey: string): Promise<ProbeResult> {
  return probe(ORS_ROAD_URL, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: ORS_PROBE_BODY,
  });
}

export function probeLlm(cfg: Settings['llm']): Promise<ProbeResult> {
  return probe(`${cfg.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
}
