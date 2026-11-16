/**
 * Carga del administrador: los GPX de `.rutas/` a la biblioteca común (`reference_routes`) y, después,
 * el mapa de calor entero (`reference_heat_cells`).
 * Uso: npx -y tsx scripts/library-import.ts [--dir .rutas] [--dry-run]
 *
 * - `rwgps-<id>.gpx` es una ruta de Ride with GPS; el resto se reconoce por el `<link>` de `<metadata>`
 *   (Wikiloc, Komoot, Bikemap, Strava, Ride with GPS) o por el nombre `<origen>-<id>.gpx`. Sin enlace
 *   ni nombre reconocible no hay URL pública que guardar y se descarta.
 * - Los tiempos de los puntos se descartan: solo se guardan lat, lon y ele.
 * - Un mismo trazado dos veces (mismo origen e id, o ≥ 90 % de celdas compartidas) entra una sola vez.
 * - Escribe por la Management API con el token de `.local-secrets/supabase-access-token.txt`.
 * Solo escribe recuentos: nunca coordenadas, ids ni el token. `--dry-run` no escribe ni pide nada.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import type { LinePoint } from '../src/routes/library/cells';
import type { ReferenceRouteRow } from '../src/routes/library/rows';

// Fuera de Vite no existe `import.meta.env`: se sustituye por un objeto vacío al cargar los módulos de src/,
// que así usan sus valores por defecto. Por eso el resto de importaciones son dinámicas.
register(`data:text/javascript,${encodeURIComponent("export async function load(url, context, nextLoad) { const loaded = await nextLoad(url, context); if (loaded.source && url.includes('/src/')) loaded.source = String(loaded.source).replaceAll('import.meta.env', '({})'); return loaded; }")}`);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const dir = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : '.rutas';
const TOKEN_FILE = '.local-secrets/supabase-access-token.txt';
/** Rutas por llamada a `upsert_reference_routes`. */
const BATCH = 10;
/** Celdas por llamada a `replace_reference_heat_cells`. */
const HEAT_CHUNK = 3_000;
/** Dos GPX con al menos esta fracción de celdas compartidas son el mismo trazado. */
const DUPLICATE_OVERLAP = 0.9;

type Query = (sql: string) => Promise<unknown>;

/** Consultas SQL por la Management API. Sin token o sin proyecto, falla antes de pedir nada. */
async function managementQuery(): Promise<Query> {
  const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '';
  if (!token) throw new Error(`Falta el token de la Management API en ${TOKEN_FILE}. No se ha escrito nada.`);
  const { ACCOUNT_PROJECT_URL } = await import('../src/auth/config');
  const ref = process.env.SUPABASE_PROJECT_REF || /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(ACCOUNT_PROJECT_URL)?.[1];
  if (!ref) throw new Error('Falta el proyecto: define SUPABASE_PROJECT_REF. No se ha escrito nada.');
  return async sql => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
    });
    // Sin el cuerpo: podría repetir la consulta, con sus coordenadas.
    if (!response.ok) throw new Error(`La Management API ha respondido ${response.status}.`);
    return response.json();
  };
}

async function main() {
  if (!dir || !existsSync(dir)) throw new Error(`No existe la carpeta ${dir ?? ''}.`);
  const query = dryRun ? null : await managementQuery();
  const { parseReferenceRoute } = await import('../src/routes/library');
  const { descFields, gpxSource, sqlJsonLiteral } = await import('../src/routes/library/importList');
  const { MAX_UNPAVED_PCT, pointsReferenceRow } = await import('../src/routes/library/rows');
  const { cellSetOverlap, lineCells } = await import('../src/routes/library/cells');
  const { buildHeatCells } = await import('../src/routes/library/heat');

  const counts = { leidas: 0, ilegibles: 0, sinEnlace: 0, tierra: 0, repetidas: 0, importadas: 0, celdas: 0 };
  const accepted: { row: ReferenceRouteRow; cells: Set<string> }[] = [];
  for (const file of readdirSync(dir).filter(f => /\.gpx$/i.test(f)).sort()) {
    counts.leidas++;
    const text = readFileSync(join(dir, file), 'utf8');
    let parsed: ReturnType<typeof parseReferenceRoute>;
    try { parsed = parseReferenceRoute(text, file); } catch { counts.ilegibles++; continue; }
    const origin = gpxSource(file, text);
    if (!origin.url) { counts.sinEnlace++; continue; }
    const desc = descFields(text);
    if ((desc.unpavedPct ?? 0) > MAX_UNPAVED_PCT) { counts.tierra++; continue; }
    const row = pointsReferenceRow({
      source: origin.source, sourceId: origin.sourceId ?? '', url: origin.url, name: parsed.name, author: parsed.author,
      points: parsed.points, unpavedPct: desc.unpavedPct ?? null,
    });
    // Las cifras del `<desc>` (las de la API de origen) mandan sobre las calculadas.
    if (desc.distanceM !== undefined) row.distance_m = Math.round(desc.distanceM);
    if (desc.elevGainM !== undefined) row.elev_gain_m = Math.round(desc.elevGainM);
    if (!origin.sourceId) row.source_id = createHash('sha256').update(JSON.stringify(row.line)).digest('hex').slice(0, 16);
    const cells = lineCells(row.line.map(([lng, lat]) => ({ lat, lng })));
    const repeated = accepted.some(a => (a.row.source === row.source && a.row.source_id === row.source_id)
      || cellSetOverlap(cells, a.cells) >= DUPLICATE_OVERLAP);
    if (repeated) { counts.repetidas++; continue; }
    accepted.push({ row, cells });
  }
  const rows = accepted.map(a => a.row);
  counts.importadas = rows.length;

  if (!query) {
    counts.celdas = buildHeatCells(rows.map(r => r.line)).length;
    console.log('Prueba sin escribir:', counts);
    return;
  }
  for (let i = 0; i < rows.length; i += BATCH) {
    await query(`select public.upsert_reference_routes(${sqlJsonLiteral(rows.slice(i, i + BATCH))})`);
  }
  // El calor se recalcula con toda la tabla, no solo con lo de esta carga.
  const all = await query('select line from public.reference_routes_in_box(-90, 90, -180, 180)') as { line: LinePoint[] }[];
  const heat = buildHeatCells(all.map(r => r.line));
  // El primer trozo vacía la tabla (p_box = null); los siguientes solo añaden.
  for (let i = 0; i === 0 || i < heat.length; i += HEAT_CHUNK) {
    await query(`select public.replace_reference_heat_cells(${sqlJsonLiteral(heat.slice(i, i + HEAT_CHUNK))}, null, ${i > 0})`);
  }
  counts.celdas = heat.length;
  console.log('Carga terminada:', { ...counts, rutasEnLaBiblioteca: all.length });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Error desconocido.');
  process.exit(1);
});
