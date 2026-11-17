import { createClient } from '@supabase/supabase-js';
import { handleRouteSources } from '../../../src/routes/sources/service.ts';
import type { HeatCell } from '../../../src/routes/library/heat.ts';
import type { ReferenceRouteRow } from '../../../src/routes/library/rows.ts';
import { rwgpsApi } from '../_shared/rwgpsApi.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } };
// Cuenta común de Ride with GPS para el llenado de zonas: los mismos secrets RWGPS_* que la función `rwgps`.
const rwgps = rwgpsApi({
  apiKey: Deno.env.get('RWGPS_API_KEY') ?? '',
  fixedToken: Deno.env.get('RWGPS_AUTH_TOKEN') ?? '',
  email: Deno.env.get('RWGPS_EMAIL') ?? '',
  password: Deno.env.get('RWGPS_PASSWORD') ?? '',
});
/** Celdas de calor por llamada a `replace_reference_heat_cells`. */
const HEAT_CHUNK = 3_000;
type Box = { minLat: number; maxLat: number; minLng: number; maxLng: number };
const boxArgs = (box: Box) => ({ p_min_lat: box.minLat, p_max_lat: box.maxLat, p_min_lng: box.minLng, p_max_lng: box.maxLng });
type HeatRow = { cell: string; lat: number; lng: number; routes: number; climb_m_per_km: number | null; ele: number | null };

/** Tareas que siguen tras responder: `EdgeRuntime.waitUntil` si existe. Nunca lanzan. */
function background(task: () => Promise<unknown>): void {
  const running = task().catch(() => {});
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(running);
}

/** Filas por página: el tope de filas por respuesta de la API de datos de Supabase. */
const PAGE_ROWS = 1000;
const MAX_PAGES = 20;

/**
 * Todas las filas de una RPC de la biblioteca. La API de datos corta cada respuesta en 1.000 filas:
 * sin paginar, de las celdas del mapa de calor solo llegaban las 1.000 más transitadas, todas junto
 * al centro, y los anillos de las vueltas largas se quedaban sin puntos de paso.
 */
async function allRows<T>(client: ReturnType<typeof createClient>, fn: string, box: Box): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await client.rpc(fn, boxArgs(box)).range(page * PAGE_ROWS, (page + 1) * PAGE_ROWS - 1);
    if (error) throw new Error('library');
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE_ROWS) break;
  }
  return rows;
}

Deno.serve(request => {
  // Las credenciales de servicio existen solo en el runtime de Supabase.
  const admin = url && serviceKey ? createClient(url, serviceKey, options) : null;
  return handleRouteSources(request, {
    enabled: Boolean(url && anonKey && admin),
    allowedOrigins: (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean),
    wikilocAuthorized: Deno.env.get('WIKILOC_AUTOMATION_AUTHORIZED') === 'true',
    wikilocSearchTemplate: Deno.env.get('WIKILOC_PUBLIC_SEARCH_TEMPLATE') ?? '',
    authenticate: async token => {
      const { data, error } = await createClient(url, anonKey, options).auth.getUser(token);
      return !error && data.user ? { id: data.user.id, isAnonymous: data.user.is_anonymous === true } : null;
    },
    consumeQuota: async userId => {
      const { data, error } = await admin!.rpc('consume_route_sources_quota', { account_id: userId });
      if (error || !data?.[0] || typeof data[0].allowed !== 'boolean') throw new Error('quota');
      return { allowed: data[0].allowed, retryAfterS: Number(data[0].retry_after_s) || 30 };
    },
    readCache: async key => {
      const { data, error } = await admin!.from('route_sources_cache').select('payload,fetched_at,expires_at').eq('cache_key', key).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (error) throw new Error('cache');
      return data;
    },
    writeCache: async row => {
      const { error } = await admin!.rpc('write_route_sources_cache', { p_cache_key: row.cache_key, p_source: row.source, p_payload: row.payload, p_fetched_at: row.fetched_at });
      if (error) throw new Error('cache');
    },
    claim: async source => {
      const { data, error } = await admin!.rpc('claim_route_source_request', { provider: source });
      if (error) throw new Error('rate_limit');
      return data === true;
    },
    routesInBox: box => allRows<ReferenceRouteRow & { id: string }>(admin!, 'reference_routes_in_box', box),
    heatCellsInBox: async box => {
      return (await allRows<HeatRow>(admin!, 'reference_heat_cells_in_box', box)).map((c): HeatCell => ({ cell: c.cell, lat: c.lat, lng: c.lng, routes: c.routes, climbMPerKm: c.climb_m_per_km, ele: c.ele }));
    },
    replaceHeatCells: async (cells, box) => {
      for (let i = 0; i === 0 || i < cells.length; i += HEAT_CHUNK) {
        const { error } = await admin!.rpc('replace_reference_heat_cells', { p_cells: cells.slice(i, i + HEAT_CHUNK), p_box: box, p_append: i > 0 });
        if (error) throw new Error('heat');
      }
    },
    routeById: async id => {
      const { data, error } = await admin!.from('reference_routes').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error('library');
      return (data ?? null) as (ReferenceRouteRow & { id: string }) | null;
    },
    upsertRoutes: async rows => {
      const { data, error } = await admin!.rpc('upsert_reference_routes', { p_rows: rows });
      if (error || typeof data !== 'number') throw new Error('library');
      return data;
    },
    // Sin la cuenta común configurada, 401: el llenado responde `fill: 'unavailable'`.
    rwgpsRouteDetail: (id, signal) => rwgps.enabled ? rwgps.get(`/api/v1/routes/${id}.json`, signal) : Promise.resolve({ status: 401, json: null }),
    lastRwgpsSyncAt: async () => {
      const { data, error } = await admin!.from('rwgps_sync_state').select('last_sync_at').eq('id', 1).maybeSingle();
      if (error) throw new Error('sync_state');
      return data?.last_sync_at ? new Date(data.last_sync_at) : null;
    },
    // La función `rwgps` solo acepta `op: 'sync'` con la clave de servicio y reserva la pasada de forma atómica.
    requestRwgpsSync: () => background(() => timedFetch(`${url}/functions/v1/rwgps`, {
      method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'sync' }),
    })),
    // Cada consulta a Overpass tiene 55 s.
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(55_000)]) }),
  });
});
