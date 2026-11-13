/**
 * Prueba real de «Rutas cerca»: Overpass y ORS de verdad, sin IA y sin Ride with GPS.
 * Uso: ORS_API_KEY=... npx -y tsx scripts/check-nearby.ts [km=60] [desnivel] [lat=41.63] [lng=2.16] [-v]
 * Solo escribe cifras y nombres de puntos públicos de OSM; nunca geometrías ni la clave.
 */
import { register } from 'node:module';
import type { LatLng } from '../src/domain/types';
import type { NearbyUpdate } from '../src/routes/nearby';
import type { OrsFeature } from '../src/routes/ors';
import type { SharedOrsAccess } from '../src/routes/orsProxy';

// Fuera de Vite no existe `import.meta.env`: se sustituye por un objeto vacío al cargar los módulos de src/,
// que así usan sus valores por defecto. Por eso el resto de importaciones son dinámicas.
register(`data:text/javascript,${encodeURIComponent("export async function load(url, context, nextLoad) { const loaded = await nextLoad(url, context); if (loaded.source && url.includes('/src/')) loaded.source = String(loaded.source).replaceAll('import.meta.env', '({})'); return loaded; }")}`);

const args = process.argv.slice(2).filter((a) => a !== '-v');
const verbose = process.argv.includes('-v');
const distanceKm = Number(args[0] ?? 60);
const elevGainM = args[1] && args[1] !== '-' ? Number(args[1]) : null;
// Centro público de Caldes de Montbui, ajeno a la dirección «Casa» de nadie.
const start: LatLng = { lat: Number(args[2] ?? 41.63), lng: Number(args[3] ?? 2.16) };
const key = process.env.ORS_API_KEY;
if (!key) throw new Error('Falta la variable de entorno ORS_API_KEY.');

async function main() {
  const { analyzeRoute, rejectReason } = await import('../src/routes/analyze');
  const { overlap, OVERLAP_LIMIT } = await import('../src/routes/catalog/recommend');
  const { angleGap, MIN_HEADING_GAP_DEG, routeBearing } = await import('../src/routes/diversity');
  const { proposeNearbyRoutes } = await import('../src/routes/nearby');
  const { OrsError } = await import('../src/routes/ors');
  const { buildOrsBody, orsExtras } = await import('../src/routes/shared/orsService');
  const { sourceTransport } = await import('../src/routes/sources/providers');
  const { MIN_PROPOSALS } = await import('../src/routes/sources/rwgpsProposals');
  const { loadWaypoints, normalizeWaypointSearch } = await import('../src/routes/sources/waypoints');
  const { estimateLoopKm } = await import('../src/routes/waypointEngine');
  const { directionName } = await import('../src/ai/references');

  const { geometryQuality } = await import('../src/routes/quality');
  /** Nombres de los puntos de paso de una consulta, para el modo detallado. */
  const known: { name: string; lat: number; lng: number }[] = [];
  const label = (request: { operation: string; waypoints?: LatLng[] }) => request.operation !== 'path' ? request.operation
    : (request.waypoints ?? []).slice(1, -1).map((p) => known.find((k) => Math.abs(k.lat - p.lat) < 1e-7 && Math.abs(k.lng - p.lng) < 1e-7)?.name ?? '·').join(' + ');

  /** El mismo límite que `ors-proxy`: 8 consultas por minuto por persona. */
  const MINUTE_LIMIT = 8;
  const calls: number[] = [];
  let orsRequests = 0;
  const ors: SharedOrsAccess = {
    kind: 'shared',
    fetchAll: async () => [],
    fetch: async (request, signal) => {
      const now = Date.now();
      while (calls.length && now - calls[0] >= 60_000) calls.shift();
      if (calls.length >= MINUTE_LIMIT) {
        throw new OrsError('rate_minute', `El servicio común de rutas admite ${MINUTE_LIMIT} consultas por minuto por persona. Espera ${Math.ceil((60_000 - (now - calls[0])) / 1000)} s y vuelve a probar.`);
      }
      calls.push(now);
      orsRequests++;
      const response = await fetch('https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson', {
        method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOrsBody(request)), signal: signal ?? AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        if (verbose) console.log(`  ORS ${label(request)}: HTTP ${response.status} ${(await response.text()).replace(/\s+/g, ' ').slice(0, 160)}`);
        throw new OrsError(response.status === 429 ? 'rate_minute' : response.status === 403 ? 'quota_day' : response.status === 404 ? 'no_route' : 'server', `ORS HTTP ${response.status}`);
      }
      const feature = ((await response.json()) as { features?: OrsFeature[] }).features?.[0];
      if (!feature) throw new OrsError('no_route', 'ORS no devolvió una ruta');
      feature.properties.extras = orsExtras(feature.properties.extras as Record<string, unknown>) as OrsFeature['properties']['extras'];
      if (verbose) {
        const c = analyzeRoute(feature, 0);
        const straightKm = request.operation === 'path' ? estimateLoopKm(request.waypoints[0], request.waypoints.slice(1, -1), 1) : 0;
        const back = Math.round((geometryQuality(feature.geometry.coordinates).backtrackM / c.distanceM) * 100);
        console.log(`  ORS ${label(request)}: ${(c.distanceM / 1000).toFixed(1)} km, +${Math.round(c.elevGainM)} m, sin asfaltar ${Math.round(c.unpavedM)} m, pista ${Math.round(c.trackM)} m, principal ${Math.round(c.mainRoadPct)} %, filtro: ${rejectReason(c, distanceKm * 1000) ?? 'pasa'}, retroceso ${back} %, firme desconocido ${Math.round(c.unknownSurfacePct)} %${straightKm ? `, ${(c.distanceM / 1000 / straightKm).toFixed(2)} veces la línea recta` : ''}`);
      }
      return feature;
    },
  };

  /** El mismo camino que la función `route-sources`: consulta, reintentos y lectura, sin caché. */
  async function findWaypoints(from: LatLng, radiusM: number, signal?: AbortSignal) {
    const t = Date.now();
    const transport = sourceTransport('osm', {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(75_000)]) }),
      claim: async () => true, signal: signal ?? new AbortController().signal,
    });
    const found = await loadWaypoints(normalizeWaypointSearch({ lat: from.lat, lon: from.lng, radiusM }), transport).catch((e: unknown) => {
      console.log(`Overpass: FALLO (${e instanceof Error ? e.message : e}) tras ${((Date.now() - t) / 1000).toFixed(1)} s`);
      throw e;
    });
    known.push(...found);
    const count = (kind: string) => found.filter((w) => w.kind === kind).length;
    console.log(`Overpass: ${found.length} puntos (${count('puerto')} puertos, ${count('cima')} cimas, ${count('pueblo')} pueblos) en ${((Date.now() - t) / 1000).toFixed(1)} s`);
    return found;
  }

  const noRwgps = { getToken: async () => 'sin-sesion', fetch: (async () => Response.json({ data: { routes: [], total: 0 } })) as unknown as typeof fetch };

  const goal = `${distanceKm} km${elevGainM !== null ? ` y ${elevGainM} m` : ''}`;
  console.log(`\n=== Rutas cerca: ${goal} desde ${start.lat}, ${start.lng} ===`);
  const t = Date.now();
  let waits = 0;
  const onUpdate = (u: NearbyUpdate) => {
    if (u.kind === 'waiting') { waits++; console.log(`Esperando ${u.seconds} s por el límite de ${MINUTE_LIMIT} consultas por minuto...`); }
    else if (verbose && u.kind === 'engine') console.log(`  motor: probadas ${u.tried}, aceptadas ${u.accepted}`);
  };
  const res = await proposeNearbyRoutes({ start, distanceKm, elevGainM }, {
    ors, rwgps: noRwgps, reference: null, visited: new Set(), ai: null, findWaypoints, historyWaypoints: async () => [], onUpdate,
  });

  const routes = res.cards.flatMap((c) => (c.kind === 'motor' ? [c] : []));
  const lines = routes.map((c) => c.route.coords.map(([lng, lat]) => ({ lat, lng })));
  const bearings = lines.map((l) => routeBearing(l, start));
  routes.forEach((c, i) => {
    const r = c.route;
    console.log(`${i + 1}. ${(r.distanceM / 1000).toFixed(1)} km, +${Math.round(r.elevGainM)} m, rumbo ${Math.round(bearings[i])}° (${directionName(bearings[i])}), `
      + `${c.via.length ? `por ${c.via.join(' · ')}` : 'vuelta circular'} [${c.combo}] `
      + `(sin asfaltar ${Math.round(r.unpavedM)} m, pista ${Math.round(r.trackM)} m, principal ${Math.round(r.mainRoadPct)} %)`);
  });

  let minGap = 360;
  let maxOverlap = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      minGap = Math.min(minGap, angleGap(bearings[i], bearings[j]));
      maxOverlap = Math.max(maxOverlap, overlap(lines[i], lines[j]), overlap(lines[j], lines[i]));
    }
  }
  const checks: [string, boolean][] = [
    [`${routes.length} rutas (mínimo ${MIN_PROPOSALS})`, routes.length >= MIN_PROPOSALS],
    ['distancia ±10 %', routes.every((c) => Math.abs(c.route.distanceM - distanceKm * 1000) <= distanceKm * 100)],
    ...(elevGainM !== null ? [['desnivel ±25 %', routes.every((c) => Math.abs(c.route.elevGainM - elevGainM) <= elevGainM * 0.25)] as [string, boolean]] : []),
    [`rumbos separados ${Math.round(minGap)}° (mínimo ${MIN_HEADING_GAP_DEG}°)`, lines.length < 2 || minGap >= MIN_HEADING_GAP_DEG],
    [`solape máximo ${Math.round(maxOverlap * 100)} % (menos de ${OVERLAP_LIMIT * 100} %)`, maxOverlap < OVERLAP_LIMIT],
    ['asfalto y poca carretera principal', routes.every((c) => { const reason = rejectReason(c.route, distanceKm * 1000); return reason === null || reason === 'longitud'; })],
  ];
  for (const [text, ok] of checks) console.log(`${ok ? 'OK   ' : 'FALLO'} ${text}`);
  for (const w of res.warnings) console.log(`Aviso: ${w}`);
  console.log(`Consultas a ORS: ${orsRequests} (presupuesto contado ${res.requestsUsed}), esperas: ${waits}, tiempo total: ${Math.round((Date.now() - t) / 1000)} s`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

main().catch((e) => { console.error('Error:', e instanceof Error ? e.message : e); process.exitCode = 1; });
