/**
 * Prueba real del generador de `#/rutas`: biblioteca común de producción y ORS de verdad, sin IA.
 * Uso: ORS_API_KEY=... npx -y tsx scripts/check-generator.ts [km] [desnivel|-] [lat] [lng] [-v]
 * Sin argumentos prueba los dos casos de la spec desde el centro público de Caldes: 60 km, y 60 km con 800 m.
 *
 * - La biblioteca se lee por la Management API (token de `.local-secrets/supabase-access-token.txt`), sin llenado automático.
 * - ORS con la clave del usuario y el mismo límite por minuto que `ors-proxy`.
 * - Solo escribe cifras: nunca geometrías, claves ni ID. Sale con código 1 si algún caso tiene menos de 3 válidas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import type { LatLng } from '../src/domain/types';
import type { RouteCandidate } from '../src/routes/analyze';
import type { HeatCell } from '../src/routes/library/heat';
import type { ReferenceRouteRow } from '../src/routes/library/rows';
import type { LibrarySearch } from '../src/routes/library/schema';
import type { OrsFeature } from '../src/routes/ors';
import type { SharedOrsAccess } from '../src/routes/orsProxy';
import type { SharedOrsRequest } from '../src/routes/shared/orsService';

// Fuera de Vite no existe `import.meta.env`: se sustituye por un objeto vacío al cargar los módulos de src/,
// que así usan sus valores por defecto. Por eso el resto de importaciones son dinámicas.
register(`data:text/javascript,${encodeURIComponent("export async function load(url, context, nextLoad) { const loaded = await nextLoad(url, context); if (loaded.source && url.includes('/src/')) loaded.source = String(loaded.source).replaceAll('import.meta.env', '({})'); return loaded; }")}`);

const TOKEN_FILE = '.local-secrets/supabase-access-token.txt';
/** El límite por minuto y persona de `ors-proxy` (`USER_MINUTE` de `src/routes/orsProxy.ts`). */
const MINUTE_LIMIT = 38;
// Centro público de Caldes de Montbui, ajeno a la dirección «Casa» de nadie.
const CALDES: LatLng = { lat: 41.6327, lng: 2.1677 };

const verbose = process.argv.includes('-v');
/** `--local`: la biblioteca sale de los GPX de `.rutas/` (como `library-import.ts`), sin token ni red de Supabase. */
const local = process.argv.includes('--local');
const args = process.argv.slice(2).filter(a => a !== '-v' && a !== '--local');
type Case = { distanceKm: number; elevGainM: number | null; start: LatLng };
const cases: Case[] = args.length === 0
  ? [{ distanceKm: 60, elevGainM: null, start: CALDES }, { distanceKm: 60, elevGainM: 800, start: CALDES }]
  : [{
    distanceKm: Number(args[0]),
    elevGainM: args[1] && args[1] !== '-' ? Number(args[1]) : null,
    start: { lat: Number(args[2] ?? CALDES.lat), lng: Number(args[3] ?? CALDES.lng) },
  }];

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)} %`;

async function main() {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error('Falta la variable de entorno ORS_API_KEY (tu clave de openrouteservice). No se ha consultado nada.');
  const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '';
  if (!token && !local) throw new Error(`Falta el token de la Management API en ${TOKEN_FILE}. No se ha consultado nada.`);
  if (cases.some(c => !(c.distanceKm >= 5 && c.distanceKm <= 300) || (c.elevGainM !== null && !(c.elevGainM >= 0)) || !Number.isFinite(c.start.lat) || !Number.isFinite(c.start.lng))) {
    throw new Error('Argumentos no válidos. Uso: [km de 5 a 300] [desnivel en m o -] [lat] [lng] [-v]');
  }

  const { ACCOUNT_PROJECT_URL } = await import('../src/auth/config');
  const { accessRoughM, analyzeRoute, rejectReason } = await import('../src/routes/analyze');
  const { acceptanceReport } = await import('../src/routes/library/acceptance');
  const { generateProposals, MAX_PROPOSALS, MIN_PROPOSALS, START_ACCESS_M } = await import('../src/routes/library/generate');
  const { buildLibraryZone, circleBox } = await import('../src/routes/library/zoneResponse');
  const { normalizeLibrarySearch } = await import('../src/routes/library/schema');
  const { ORS_DAILY_LIMIT, OrsError } = await import('../src/routes/ors');
  const { ORS_ROAD_URL } = await import('../src/routes/endpoint');
  const { buildOrsBody, orsExtras } = await import('../src/routes/shared/orsService');
  const { geometryQuality } = await import('../src/routes/quality');

  const ref = process.env.SUPABASE_PROJECT_REF || /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(ACCOUNT_PROJECT_URL)?.[1];
  if (!ref) throw new Error('Falta el proyecto: define SUPABASE_PROJECT_REF.');
  async function sql<T>(query: string): Promise<T[]> {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
    // Sin el cuerpo: podría repetir la consulta, con sus coordenadas.
    if (!response.ok) throw new Error(`La Management API ha respondido ${response.status}. ¿Está aplicada la migración 202611160001_reference_library.sql?`);
    return response.json() as Promise<T[]>;
  }

  /** Filas y celdas de `.rutas/`, con las mismas reglas que `library-import.ts`. */
  async function localLibrary() {
    const { readdirSync } = await import('node:fs');
    const { parseReferenceRoute } = await import('../src/routes/library');
    const { descFields, gpxSource } = await import('../src/routes/library/importList');
    const { MAX_UNPAVED_PCT, pointsReferenceRow } = await import('../src/routes/library/rows');
    const { cellSetOverlap, lineCells } = await import('../src/routes/library/cells');
    const { buildHeatCells } = await import('../src/routes/library/heat');
    const accepted: { row: ReferenceRouteRow & { id: string }; cells: Set<string> }[] = [];
    for (const file of readdirSync('.rutas').filter(f => /\.gpx$/i.test(f)).sort()) {
      const text = readFileSync(`.rutas/${file}`, 'utf8');
      let parsed: ReturnType<typeof parseReferenceRoute>;
      try { parsed = parseReferenceRoute(text, file); } catch { continue; }
      const origin = gpxSource(file, text);
      const desc = descFields(text);
      if (!origin.url || (desc.unpavedPct ?? 0) > MAX_UNPAVED_PCT) continue;
      const row = { ...pointsReferenceRow({ source: origin.source, sourceId: origin.sourceId ?? file, url: origin.url, name: parsed.name, author: parsed.author, points: parsed.points, unpavedPct: desc.unpavedPct ?? null }), id: file };
      if (desc.distanceM !== undefined) row.distance_m = Math.round(desc.distanceM);
      if (desc.elevGainM !== undefined) row.elev_gain_m = Math.round(desc.elevGainM);
      const cells = lineCells(row.line.map(([lng, lat]) => ({ lat, lng })));
      if (accepted.some(a => cellSetOverlap(cells, a.cells) >= 0.9)) continue;
      accepted.push({ row, cells });
    }
    const rows = accepted.map(a => a.row);
    return { rows, cells: buildHeatCells(rows.map(r => r.line)) };
  }
  const localData = local ? await localLibrary() : null;

  /** Lo mismo que la operación `library` de `route-sources`, sin caché ni llenado automático. */
  async function library(search: LibrarySearch) {
    const s = normalizeLibrarySearch(search);
    const b = circleBox(s.lat, s.lon, s.radiusM);
    if (localData) {
      const inBox = (lat: number, lng: number) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
      return buildLibraryZone(s, localData.rows.filter(r => r.max_lat >= b.minLat && r.min_lat <= b.maxLat && r.max_lng >= b.minLng && r.min_lng <= b.maxLng), localData.cells.filter(c => inBox(c.lat, c.lng)).sort((x, y) => y.routes - x.routes || x.cell.localeCompare(y.cell)).slice(0, Number(process.env.CELL_CAP) || Infinity), 'none');
    }
    const box = [b.minLat, b.maxLat, b.minLng, b.maxLng].map(v => v.toFixed(6)).join(', ');
    const rows = await sql<ReferenceRouteRow & { id: string }>(`select * from public.reference_routes_in_box(${box})`);
    type HeatRow = { cell: string; lat: number; lng: number; routes: number; climb_m_per_km: number | null; ele: number | null };
    const cells = (await sql<HeatRow>(`select * from public.reference_heat_cells_in_box(${box})`))
      .map((c): HeatCell => ({ cell: c.cell, lat: c.lat, lng: c.lng, routes: c.routes, climbMPerKm: c.climb_m_per_km, ele: c.ele }));
    return buildLibraryZone(s, rows, cells, 'none');
  }

  const calls: number[] = [];
  let orsRequests = 0;
  /** Última candidata devuelta por ORS: la del re-trazado cuando se acepta una ruta de la biblioteca. */
  let lastCandidate: RouteCandidate | null = null;
  /** Metros malos del acceso al inicio de esa última candidata: no cuentan (como en el generador). */
  let lastAccess = { unpavedM: 0, trackM: 0 };
  async function orsFetch(request: SharedOrsRequest, signal?: AbortSignal): Promise<OrsFeature[]> {
    const now = Date.now();
    while (calls.length && now - calls[0] >= 60_000) calls.shift();
    if (calls.length >= MINUTE_LIMIT) {
      const waitS = Math.ceil((60_000 - (now - calls[0])) / 1000);
      throw new OrsError('rate_minute', `Límite de ${MINUTE_LIMIT} consultas por minuto: faltan ${waitS} s.`, undefined, waitS);
    }
    calls.push(now);
    orsRequests++;
    const response = await fetch(`${ORS_ROAD_URL}/geojson`, {
      method: 'POST', headers: { Authorization: key!, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOrsBody(request)), signal: signal ?? AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const s = response.status;
      if (s === 429) throw new OrsError('rate_minute', 'ORS: límite de consultas por minuto de tu clave.');
      if (s === 403) throw new OrsError('quota_day', `ORS: límite diario de tu clave (${ORS_DAILY_LIMIT} consultas al día) o clave no válida.`);
      if (s === 404) throw new OrsError('no_route', 'ORS no encuentra ruta.');
      throw new OrsError(s >= 500 ? 'server' : 'bad_request', `ORS ha respondido HTTP ${s}.`);
    }
    const features = ((await response.json()) as { features?: OrsFeature[] }).features ?? [];
    if (!features.length) throw new OrsError('no_route', 'ORS no ha devuelto ninguna ruta.');
    for (const f of features) f.properties.extras = orsExtras(f.properties.extras as Record<string, unknown>) as OrsFeature['properties']['extras'];
    lastCandidate = analyzeRoute(features[0], 0);
    lastAccess = accessRoughM(features[0], START_ACCESS_M);
    if (verbose) {
      const c = lastCandidate;
      console.log(`  ORS ${request.operation}: ${(c.distanceM / 1000).toFixed(1)} km, +${Math.round(c.elevGainM)} m, sin asfaltar ${Math.round(c.unpavedM)} m, `
        + `pista ${Math.round(c.trackM)} m, principal ${Math.round(c.mainRoadPct)} %, carretera: ${rejectReason(c, c.distanceM) ?? 'pasa'}, `
        + `retroceso ${pct(geometryQuality(c.coords).backtrackM, c.distanceM)}`);
    }
    return features;
  }
  const ors: SharedOrsAccess = {
    kind: 'shared',
    fetch: async (request, signal) => (await orsFetch(request, signal))[0],
    fetchAll: orsFetch,
  };

  let failed = false;
  for (const target of cases) {
    const goal = `${target.distanceKm} km${target.elevGainM !== null ? ` y ${target.elevGainM} m` : ''}`;
    console.log(`\n=== Generador: ${goal} desde ${target.start.lat}, ${target.start.lng} ===`);
    const t = Date.now();
    const before = orsRequests;
    const retraced = new Map<string, RouteCandidate | null>();
    const access = new Map<string, { unpavedM: number; trackM: number }>();
    const res = await generateProposals(target, {
      ors, library, visited: new Set(),
      // USUAL_CLIMB (m/km): simula el nivel de quien busca; sin ella, sin referencia.
      reference: process.env.USUAL_CLIMB ? { source: 'declared', weeks: null, rides: 10, ridesPerWeek: 2, avgDistanceM: 60_000, avgElevGainM: 60 * Number(process.env.USUAL_CLIMB), avgMovingTimeS: 9000, avgSpeedMs: 6.7, longestDistanceM: 100_000, maxElevGainM: 1500 } : null,
      onUpdate: u => {
        if (u.kind === 'waiting') console.log(`Esperando ${u.seconds} s por el límite por minuto...`);
        else if (u.kind === 'card') { access.set(u.card.id, lastAccess); if (u.card.kind === 'biblioteca') retraced.set(u.card.id, lastCandidate); }
        else if (u.kind === 'discarded') console.log(`  descartada (${u.reason}): ${(u.distanceM / 1000).toFixed(1)} km, +${Math.round(u.elevGainM)} m`);
        else if (verbose && u.kind === 'library-ready') console.log(`  biblioteca: ${u.routes} rutas, ${u.cells} celdas`);
      },
    });

    const items = res.cards.map(card => {
      if (card.kind === 'nueva') {
        const r = card.route;
        return {
          kind: card.kind, distanceM: r.distanceM, elevGainM: r.elevGainM, backtrackM: geometryQuality(r.coords).backtrackM,
          road: { unpavedM: r.unpavedM - (access.get(card.id)?.unpavedM ?? 0), trackM: r.trackM - (access.get(card.id)?.trackM ?? 0), mainRoadPct: r.mainRoadPct, motorway: r.motorway },
          line: r.coords.map(([lng, lat]) => ({ lat, lng })),
        };
      }
      const a = card.adapted;
      const c = retraced.get(card.id) ?? null;
      return {
        kind: card.kind, distanceM: a.distanceM, elevGainM: a.elevGainM,
        backtrackM: geometryQuality(a.coords.map(p => [p.lng, p.lat, p.ele ?? 0] as [number, number, number])).backtrackM,
        road: c && { unpavedM: c.unpavedM - (access.get(card.id)?.unpavedM ?? 0), trackM: c.trackM - (access.get(card.id)?.trackM ?? 0), mainRoadPct: c.mainRoadPct, motorway: c.motorway },
        line: a.coords.map(p => ({ lat: p.lat, lng: p.lng })),
      };
    });
    const report = acceptanceReport(target, items);
    report.rows.forEach((r, i) => {
      const road = r.road
        ? `sin asfaltar ${Math.round(r.road.unpavedM)} m, pista ${Math.round(r.road.trackM)} m, principal ${Math.round(r.road.mainRoadPct)} %${r.kind === 'biblioteca' ? ' (re-trazado)' : ''}${r.road.motorway ? ', autopista' : ''}`
        : 'sin datos de carretera';
      console.log(`${i + 1}. ${r.kind}: ${(r.distanceM / 1000).toFixed(1)} km, ${r.elevGainM === null ? 'desnivel desconocido' : `+${Math.round(r.elevGainM)} m`}, `
        + `${road}, retroceso ${pct(r.backtrackM, r.distanceM)}, solape máximo ${pct(r.maxOverlap, 1)}: `
        + `${r.valid ? 'válida' : `no válida (${r.reasons.join(', ')})`}`);
    });
    for (const w of res.warnings) console.log(`Aviso: ${w}`);
    console.log(`${report.valid} válidas de ${report.rows.length} (mínimo ${MIN_PROPOSALS}, ideal ${MAX_PROPOSALS}). `
      + `Consultas a ORS: ${orsRequests - before} (presupuesto contado ${res.requestsUsed}). Tiempo: ${Math.round((Date.now() - t) / 1000)} s. `
      + (res.zone ? `Zona: ${res.zone.routes} rutas, ${res.zone.cells} celdas, factor ${res.zone.factor.toFixed(2)}.` : 'Sin zona.'));
    if (!report.passed) failed = true;
  }
  if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => { console.error('Error:', e instanceof Error ? e.message : e); process.exitCode = 1; });
