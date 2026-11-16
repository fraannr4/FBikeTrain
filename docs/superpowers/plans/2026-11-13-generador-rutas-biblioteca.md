# Generador único de rutas con biblioteca común de referencia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. En este proyecto se ejecuta con el workflow `develop-phase` (ver «Lotes» al final). Los agentes no hacen commit: el último paso de cada tarea es dejar los cambios sin commit y proponer el mensaje en `notes`.

**Goal:** Sustituir las cuatro pantallas de rutas a medias por un solo generador en `#/rutas` que, para un inicio, unos km y un desnivel opcional, devuelve de 3 a 5 vueltas de carretera: rutas reales de la biblioteca común adaptadas (B) y vueltas nuevas por los tramos más transitados del mapa de calor (A).

**Architecture:** Una biblioteca común en Supabase (`reference_routes`) y su mapa de calor por cuadrículas de 200 m (`reference_heat_cells`), cargados por un script del administrador, por la sincronización de Ride with GPS y por el llenado automático de zonas vacías. El móvil pide a `route-sources` (`kind: 'library'`) las cuadrículas, las rutas candidatas y el factor de carretera de la zona. El generador (`src/routes/library/generate.ts`, funciones puras con dependencias inyectadas) adapta hasta 2 rutas con `adaptRoute`, monta anillos de 4 a 6 puntos de paso sobre las cuadrículas populares, une cada anillo con una consulta a ORS `cycling-road`, corrige la longitud con una segunda consulta si se desvía más del 10 % y filtra por carretera, objetivo y solape de cuadrículas.

**Tech Stack:** Vite + React + TypeScript, Vitest, Playwright, zod, OpenRouteService (`ors-proxy` o clave propia), Supabase (Postgres, Edge Functions `route-sources` y `rwgps`, Management API), PGlite para los tests SQL, `tsx` para los scripts.

**Spec:** `docs/superpowers/specs/2026-11-13-generador-rutas-biblioteca-design.md`. Requisito móvil: `docs/requisito-mobile-first.md`. Reglas del proyecto: `CLAUDE.md`. Diagnóstico previo: `docs/ESTADO.md` (traspaso del 2026-11-13).

## Global Constraints

- Repositorio público: ni claves, ni tracks reales, ni ID de rutas reales en el repo. Los GPX de origen y la lista de rutas viven en `.rutas/` (ignorado por git); los fixtures son sintéticos con un inicio sintético (no Caldes).
- Mobile-first con prioridad absoluta: la pantalla se diseña y valida primero con capturas reales a 360 y 430 px.
- El generador no usa IA. Ni la IA ni terceros reciben trazados ni la dirección de «Casa». A Ride with GPS (búsqueda de zona) solo viaja un centro de zona redondeado a una rejilla de 0,05° (≈ 5 km).
- El historial del usuario no sale del navegador; la biblioteca común solo la escribe el servidor (`service_role`) o el script del administrador.
- ORS: 38 consultas por minuto y 1.500 al día por persona; como mucho 8 puntos de paso por consulta. Las consultas van de una en una. Presupuesto por búsqueda: `GENERATOR_ORS_BUDGET = 20`.
- Propuesta válida (aceptación de la spec): distancia en 60 km ±10 %; desnivel ±25 % si se pide; asfalto y sin pistas (`ROAD_FILTER`: ≤ 100 m sin asfaltar, ≤ 100 m de pista, sin autopista); carretera principal ≤ 20 %; retroceso ≤ `MAX_INTENT_BACKTRACK` (0,15); solape < 0,7 medido como cuadrículas de 200 m compartidas entre las cuadrículas de la vuelta más corta.
- De 3 (`MIN_PROPOSALS`) a 5 (`MAX_PROPOSALS`) tarjetas; como mucho 2 de la biblioteca. Si no hay rutas de referencia ni tras el llenado automático: 0 tarjetas y un aviso; nunca vueltas de mala calidad.
- Migraciones nuevas numeradas después de `202611130006`, cada una con su test en `supabase/tests/` registrado en `scripts/test-account-sql.mjs`. Solo la sesión principal las aplica en producción, con confirmación del usuario.
- Módulos que carga Deno (Edge Functions): solo `zod` y rutas relativas con extensión `.ts`; nada que dependa de `import.meta.env`, Dexie o el DOM.
- Verificación por tarea (máquina lenta): solo `npx vitest run <ficheros de la tarea>` y `npx tsc --noEmit` (y `npm run test:db` o la spec de Playwright cuando la tarea los pida, con `PLAYWRIGHT_PORT=4517`).
- Textos de la interfaz en castellano, marca B Trazado y tokens de la app; nada de colores sueltos.

## Review Focus

1. **Zona sin rutas de referencia** (inicio en una comarca nueva, llenado automático sin resultados, Ride with GPS caído o bloqueado por `robots.txt`): la pantalla dice por qué no hay propuestas, 0 tarjetas, 0 consultas a ORS y nunca lanza. Pruebas en Tarea 4 (servidor) y Tarea 5 (generador).
2. **ORS sin ruta en todos los anillos** (inicio en lo alto de un monte o en un casco urbano lleno de calles peatonales): se pasa al anillo siguiente sin superar el presupuesto y el aviso dice cuántas cumplen. Prueba en Tarea 5.
3. **Factor de zona con pocas rutas o rutas raras** (lineales, una ida y vuelta con polígono diminuto, 1 o 2 circulares): se descartan las no circulares y las de perímetro < 1 km, se acota a 1,2-2,5 y con menos de 5 muestras se usa el valor por defecto. Prueba en Tarea 2.
4. **Cancelar o límite por minuto a media búsqueda:** «Cancelar» corta al momento y conserva las tarjetas ya aceptadas; un 429 espera `retryAfterS` (como mucho 60 s) con cuenta atrás visible. Pruebas en Tarea 5 (lógica) y Tarea 6 (pantalla).
5. **Rutas de referencia sin altitud** (puntos de Ride with GPS sin `e`, GPX sin `<ele>`): `elev_gain_m` queda `null`, la cuadrícula no inventa subida y, con desnivel pedido, esa ruta no cuenta como propuesta B válida. Pruebas en Tareas 2, 3 y 5.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `supabase/migrations/202611160001_reference_library.sql` (nuevo) | Tablas `reference_routes` y `reference_heat_cells`, sus RPC y el proveedor `rwgps` en la caché y el reloj de `route-sources` |
| `supabase/migrations/202611160002_drop_rwgps_route_index.sql` (nuevo) | Borra `rwgps_route_index` y `rwgps_routes_near` (se aplica la última) |
| `src/routes/library/cells.ts` (nuevo, Deno) | Cuadrículas de una línea, solape por cuadrículas y paso mínimo de una línea a un punto |
| `src/routes/library/heat.ts` (nuevo, Deno) | Mapa de calor a partir de las líneas de referencia |
| `src/routes/library/zone.ts` (nuevo, Deno) | Factor de carretera de la zona y subida típica |
| `src/routes/library/rows.ts` (nuevo, Deno) | Fila de `reference_routes` desde Ride with GPS o desde puntos de un GPX |
| `src/routes/library/importList.ts` (nuevo) | Lectura de la lista local de rutas y del nombre de los GPX; literal jsonb seguro |
| `src/routes/library/schema.ts`, `zoneResponse.ts`, `fill.ts` (nuevos, Deno) | Operación `library` de `route-sources`: esquemas, respuesta y llenado automático |
| `src/routes/library/ring.ts`, `generate.ts`, `acceptance.ts` (nuevos) | Anillos, generador y criterio de aceptación |
| `supabase/functions/_shared/rwgpsApi.ts` (nuevo) | Clave y token de la cuenta común de Ride with GPS, compartidos por `rwgps` y `route-sources` |
| `scripts/library-import.ts` (nuevo), `scripts/check-generator.ts` (sustituye a `check-nearby.ts`) | Carga del administrador y prueba real |
| `src/ui/pages/Rutas.tsx` (reescrito), `src/ui/routes/NewRouteCard.tsx` (nuevo) | Pantalla única del generador |

`src/routes/library/` convive con el fichero `src/routes/library.ts` (biblioteca personal): `'./library'` sigue resolviendo al fichero y `'./library/generate'` a la carpeta. Se respeta la ruta que fija la spec.

---

### Task 1: Tablas de la biblioteca común (Supabase)

**Files:**
- Create: `supabase/migrations/202611160001_reference_library.sql`, `supabase/tests/reference_library.sql`
- Modify: `scripts/test-account-sql.mjs` (registrar la migración y el test al final, después de `zona_privacidad`)

**Interfaces:**
- Consumes: `route_sources_cache`, `route_source_request_slots` y `claim_route_source_request` de `202611100002_route_sources_cache.sql`; `write_route_sources_cache` de `202611130005`.
- Produces (todo `security invoker`, `set search_path = ''`, solo `service_role`; RLS activado y `revoke all` a `public, anon, authenticated`, como `rwgps_route_index`):
  ```sql
  table public.reference_routes (
    id uuid primary key default gen_random_uuid(),
    source text not null check (source in ('rwgps','komoot','bikemap','wikiloc','strava','other')),
    source_id text not null check (char_length(source_id) between 1 and 64),
    url text not null check (url ~ '^https://' and char_length(url) <= 500),
    name text not null default '' check (char_length(name) <= 300),
    author text not null default '' check (char_length(author) <= 200),
    distance_m integer not null check (distance_m > 0),
    elev_gain_m integer check (elev_gain_m >= 0),
    start_lat, start_lng, min_lat, max_lat, min_lng, max_lng double precision not null  -- mismos checks que rwgps_route_index
    line jsonb not null check (jsonb_typeof(line) = 'array' and jsonb_array_length(line) between 2 and 2000),  -- [[lng, lat, ele?], ...]
    loop boolean not null,
    unpaved_pct real check (unpaved_pct between 0 and 100),
    imported_at timestamptz not null default now(),
    unique (source, source_id))
  table public.reference_heat_cells (
    cell text primary key check (cell ~ '^-?\d+:-?\d+$'),   -- cellKey a 200 m
    lat double precision not null, lng double precision not null,   -- punto real de una ruta dentro de la celda
    routes integer not null check (routes >= 1),
    climb_m_per_km real check (climb_m_per_km >= 0),
    ele real)
  function public.upsert_reference_routes(p_rows jsonb) returns integer          -- on conflict (source, source_id) actualiza todo e imported_at = now()
  function public.reference_routes_in_box(p_min_lat, p_max_lat, p_min_lng, p_max_lng double precision) returns setof public.reference_routes  -- cajas que se cortan; limit 1000
  function public.reference_heat_cells_in_box(p_min_lat, p_max_lat, p_min_lng, p_max_lng double precision) returns setof public.reference_heat_cells  -- order by routes desc, cell; limit 20000
  function public.replace_reference_heat_cells(p_cells jsonb, p_box jsonb, p_append boolean default false) returns integer
  ```
  `replace_reference_heat_cells`: `p_box` es `{"minLat","maxLat","minLng","maxLng"}` o `null` (toda la tabla). Sin `p_append` borra antes las celdas de la caja; lanza `22023` si una celda de `p_cells` cae fuera de la caja. `author` no está en la lista de la spec: se añade para la etiqueta de la tarjeta («Ride with GPS · autor»), como tenía `rwgps_route_index`.
  Además: los checks `route_sources_cache_source_check` y `route_source_request_slots_provider_check` (nombres por defecto; compruébalos con `pg_constraint`) pasan a admitir `'rwgps'`, y `claim_route_source_request` se reemplaza con la lista `('wikiloc', 'osm', 'rwgps')`.

- [ ] **Step 1: Write the failing test** `supabase/tests/reference_library.sql`, con el estilo de `rwgps_route_index.sql` (`pg_temp.assert_…`, `expect_…_denied`, `rollback` al final):
  - `anon` y `authenticated`: denegados `select` e `insert` en las dos tablas y la ejecución de las cuatro RPC.
  - `service_role`: `upsert_reference_routes` con 2 rutas sintéticas devuelve 2; repetir una con otro `name` deja 2 filas y el nombre nuevo.
  - `check_violation` para: `line` de 1 punto, `line` de 2.001 puntos (con `generate_series`), `source = 'user'`, `url` con `http://`, `cell = 'abc'`.
  - `reference_routes_in_box` devuelve la ruta cuya caja corta la consulta y no la de 50 km al este.
  - `replace_reference_heat_cells` con caja: borra las celdas de dentro y conserva una de fuera; con `p_append = true` no borra; una celda fuera de la caja lanza `22023`; con `p_box = null` vacía la tabla.
  - `claim_route_source_request('rwgps')` da `true` y una segunda llamada inmediata, `false`; `route_sources_cache` acepta `source = 'rwgps'`.
  - Ninguna de las cuatro RPC es `security definer` (`pg_proc.prosecdef`), y RLS está activado en las dos tablas.
- [ ] **Step 2: Run** `npm run test:db` — Expected: FAIL (no existe la migración).
- [ ] **Step 3: Implement** la migración en un `begin; … commit;` y regístrala con su test en `scripts/test-account-sql.mjs`, con la línea `PASS: biblioteca común de rutas: tablas, mapa de calor, RPC y proveedor rwgps solo para el servidor.`
- [ ] **Step 4: Run** `npm run test:db` — Expected: PASS en todas las líneas, también las anteriores.
- [ ] **Step 5:** Sin commit. Propón el mensaje en `notes`. La migración la aplica en producción la sesión principal (lista final).

---

### Task 2: Cuadrículas, mapa de calor y factor de la zona (funciones puras)

**Files:**
- Modify: `src/metrics/routes.ts`, `src/metrics/grid.ts`, `src/import/summary.ts` (solo añadir `.ts` a sus importaciones relativas, para que Deno los cargue)
- Create: `src/routes/library/cells.ts`, `src/routes/library/heat.ts`, `src/routes/library/zone.ts`
- Test: `tests/libraryCells.test.ts`, `tests/libraryHeat.test.ts`, `tests/libraryZone.test.ts`; `tests/grid.test.ts` y `tests/routes.test.ts` deben seguir pasando sin tocarlos.

**Interfaces:**
- Consumes: `cellKey`, `ROUTE_CELL_M` (`metrics/routes.ts`), `buildCellCounts`, `MAX_TRACK_GAP_M` (`metrics/grid.ts`), `haversineM` (`import/summary.ts`).
- Produces (los tres módulos importan solo con extensión `.ts`):
  ```ts
  // cells.ts
  export type LinePoint = [lng: number, lat: number] | [lng: number, lat: number, ele: number];
  export const OVERLAP_LIMIT = 0.7;
  export function densify(line: LinePoint[], stepM?: number): LinePoint[];           // por defecto MAX_TRACK_GAP_M; interpola ele solo si la tienen los dos extremos
  export function lineCells(line: { lat: number; lng: number }[]): Set<string>;       // cellKey de la línea densificada
  export function cellOverlap(a: { lat: number; lng: number }[], b: { lat: number; lng: number }[]): number; // |A∩B| / min(|A|,|B|); 0 si alguna está vacía
  export function passDistanceM(lat: number, lng: number, line: LinePoint[]): number; // misma fórmula que rwgpsService.passDistanceM
  // heat.ts
  export type HeatCell = { cell: string; lat: number; lng: number; routes: number; climbMPerKm: number | null; ele: number | null };
  export function buildHeatCells(lines: LinePoint[][]): HeatCell[];
  // zone.ts
  export const DEFAULT_ZONE_FACTOR = 1.7;
  export const MIN_FACTOR_ROUTES = 5;
  export const ZONE_FACTOR_RANGE = { min: 1.2, max: 2.5 };
  export function polygonFactor(line: { lat: number; lng: number }[], distanceM: number): number | null;
  export function zoneFactor(routes: { line: { lat: number; lng: number }[]; distanceM: number; loop: boolean }[]): { factor: number; samples: number };
  export function typicalClimb(routes: { distanceM: number; elevGainM: number | null }[]): number | null; // mediana de m/km
  ```
  Reglas:
  - `buildHeatCells`: densifica cada línea y llama a `buildCellCounts` (una línea = un track) para `routes` y para `lat`/`lng` (`at`, sobre la carretera). Cada tramo densificado se apunta a la celda de su punto inicial: longitud y subida positiva (solo con altitud en los dos extremos). `climbMPerKm` = Σ subida / Σ km de los tramos con altitud de todas las rutas; `null` si ninguno la tiene. `ele` = media de las altitudes conocidas en la celda, o `null`.
  - `polygonFactor`: 6 puntos repartidos por distancia a lo largo de la línea (0, 1/6 … 5/6), perímetro del hexágono cerrado y `distanceM / perímetro`; `null` si el perímetro < 1 km.
  - `zoneFactor`: mediana de `polygonFactor` de las rutas `loop`, acotada a `ZONE_FACTOR_RANGE`; con menos de `MIN_FACTOR_ROUTES` muestras, `{ factor: DEFAULT_ZONE_FACTOR, samples }`. El 1,7 sale de lo medido alrededor de Caldes (1,42-1,98, mediana ≈ 1,75); el 1,3 fijo era el fallo principal de longitud.

- [ ] **Step 1: Write the failing tests** (líneas sintéticas en un inicio sintético, p. ej. 40,0 / −3,0):
  - `lineCells` de una recta de 1 km con solo 2 vértices devuelve ≥ 5 celdas (densifica); una línea vacía, 0.
  - `cellOverlap`: una vuelta y otra que repite 3/4 de sus celdas da 0,75 (±0,05); una vuelta corta contenida en una larga da 1; sin puntos, 0.
  - `buildHeatCells`: tres líneas que cruzan la misma celda dan `routes: 3`; una línea que pasa dos veces por una celda cuenta 1 ahí; una línea sin altitud deja `climbMPerKm: null` y `ele: null`; una subida sintética de 50 m en 1 km dentro de una celda da ≈ 50 m/km.
  - `polygonFactor` de un hexágono de 5 km de radio recorrido por sus vértices (distancia = perímetro) da 1,00 ±0,01; con `distanceM = 1,75 × perímetro`, 1,75 ±0,01; con un perímetro de 800 m, `null`.
  - `zoneFactor`: 4 circulares → `{ factor: 1.7, samples: 4 }`; 5 circulares con factores 1,4 / 1,6 / 1,75 / 1,9 / 2,0 → 1,75; una ruta `loop: false` no cuenta; factores 3,0 en todas → 2,5.
  - `typicalClimb` ignora las rutas con `elevGainM: null`; sin ninguna con desnivel, `null`.
- [ ] **Step 2: Run** `npx vitest run tests/libraryCells.test.ts tests/libraryHeat.test.ts tests/libraryZone.test.ts` — Expected: FAIL (módulos no existen).
- [ ] **Step 3: Implement** los tres módulos y el cambio de extensiones en `routes.ts`, `grid.ts` y `summary.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/libraryCells.test.ts tests/libraryHeat.test.ts tests/libraryZone.test.ts tests/grid.test.ts tests/routes.test.ts tests/summary.test.ts` — Expected: PASS. `npx tsc --noEmit` limpio.
- [ ] **Step 5:** Sin commit; propuesta de mensaje en `notes`.

---

### Task 3: Filas de referencia, script de carga y sincronización de Ride with GPS

**Files:**
- Create: `src/routes/library/rows.ts`, `src/routes/library/importList.ts`, `supabase/functions/_shared/rwgpsApi.ts`, `scripts/library-import.ts`
- Modify: `src/routes/sources/rwgpsSync.ts` (escribe en `reference_routes`), `src/routes/sources/rwgpsService.ts` (el tipo `RwgpsIndexRow` pasa aquí mientras exista la operación `nearby`; se borra en la Tarea 8), `supabase/functions/rwgps/index.ts` (usa `_shared/rwgpsApi.ts` y las RPC nuevas)
- Test: `tests/libraryRows.test.ts`, `tests/libraryImportList.test.ts`, `tests/rwgpsSync.test.ts` (reescrito)

**Interfaces:**
- Consumes: `LinePoint`, `densify` (T2); `upsert_reference_routes`, `reference_routes_in_box`, `replace_reference_heat_cells` (T1); `buildHeatCells` (T2); `parseReferenceRoute` (`routes/library.ts`, solo en el script).
- Produces:
  ```ts
  // rows.ts (Deno)
  export type ReferenceSource = 'rwgps' | 'komoot' | 'bikemap' | 'wikiloc' | 'strava' | 'other';
  export type ReferenceRouteRow = { source: ReferenceSource; source_id: string; url: string; name: string; author: string; distance_m: number; elev_gain_m: number | null;
    start_lat: number; start_lng: number; min_lat: number; max_lat: number; min_lng: number; max_lng: number; line: LinePoint[]; loop: boolean; unpaved_pct: number | null };
  export const MAX_LINE_POINTS = 2000;
  export const LOOP_CLOSE_M = 500;
  export const MAX_UNPAVED_PCT = 5;
  export function simplifyLine<T>(points: T[], max?: number): T[];          // movido de rwgpsSync.ts: muestreo uniforme con el primero y el último
  export function rwgpsReferenceRow(id: number, json: unknown): ReferenceRouteRow | null;  // API v1 /routes/{id}.json
  export function pointsReferenceRow(input: { source: ReferenceSource; sourceId: string; url: string; name: string; author?: string; points: { lat: number; lng: number; ele?: number }[]; unpavedPct?: number | null }): ReferenceRouteRow;
  // importList.ts
  export function gpxSource(fileName: string, gpxText: string): { source: 'rwgps' | 'komoot' | 'bikemap' | 'wikiloc' | 'strava' | 'other'; sourceId: string | null; url: string | null };  // sourceId null = usar hash de la geometría
  export function gpxSource(fileName: string): { source: Exclude<ReferenceSource, 'rwgps'>; sourceId: string } | null; // «komoot-123.gpx»
  export function sqlJsonLiteral(value: unknown): string;   // $tagN$…$tagN$::jsonb con una etiqueta que no aparece en el texto
  // rwgpsSync.ts
  export type ReferenceSyncDependencies = { get: (path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
    importedAt: (sourceIds: string[]) => Promise<Map<string, number>>; upsert: (row: ReferenceRouteRow) => Promise<void>; remove: (sourceId: string) => Promise<void>; now?: () => number };
  export async function syncReferenceRoutes(deps: ReferenceSyncDependencies, signal: AbortSignal): Promise<RwgpsSyncResult>; // sustituye a syncRwgpsIndex
  // supabase/functions/_shared/rwgpsApi.ts
  export function rwgpsApi(env: { apiKey: string; fixedToken: string; email: string; password: string }): { enabled: boolean; get: (path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }> };
  ```
  Reglas de `rwgpsReferenceRow`: solo `visibility === 'public'`; puntos `[x, y, e?]` redondeados a 5 decimales; `distance_m` de `route.distance` o de la línea; `elev_gain_m` de `route.elevation_gain`, o calculado si hay altitud, o `null`; `unpaved_pct` de `route.unpaved_pct` si viene (compruébalo con una ruta real en el Step 1); `loop` si inicio y final distan ≤ `LOOP_CLOSE_M`; `null` si no es pública, tiene < 2 puntos o `unpaved_pct > MAX_UNPAVED_PCT`. `url` = `https://ridewithgps.com/routes/<id>`. Solo rutas planificadas (`/routes/`), nunca actividades (`/trips/`).
  Script `scripts/library-import.ts` (no se compila con `tsc`; usa el mismo cargador que `check-nearby.ts` para `import.meta.env`):
  - Uso: `npx -y tsx scripts/library-import.ts [--dir .rutas] [--dry-run]`. La carpeta `.rutas/` (ignorada por git) es la única entrada: el usuario deja ahí los GPX que descarga de Wikiloc, Komoot, Bikemap o Strava, con cualquier nombre de fichero, y ya contiene `rwgps-<id>.gpx` (54 rutas de Ride with GPS convertidas desde su JSON público) y la lista `rutas-caldes.md`.
  - Todos los `*.gpx` de la carpeta se leen igual (con el lector GPX que ya existe en `src/import`). Fuente y `source_id`: si el nombre es `rwgps-<id>.gpx`, `source = 'rwgps'` y `source_id = <id>`; si no, se deduce del `<link href>` del GPX (dominio `wikiloc.com`, `komoot.com`, `bikemap.net`, `strava.com`, `ridewithgps.com`, con el id de la URL) y, si no hay link, `source = 'other'` y `source_id` = hash SHA-256 (16 hex) de la geometría simplificada. `url` = la del `<link>` o `null`. `distance_m`, `elev_gain_m` y `unpaved_pct` del `<desc>` `clave=valor` si viene (como en los `rwgps-*.gpx`), si no se calculan del trazado (`unpaved_pct: null`). Los GPX de Wikiloc son tracks grabados por su autor y publicados por él: llevan `<time>` en los puntos y **se importan** (los tiempos se descartan; solo se guardan lat/lon/ele). El `<link>` de la ruta es el de `<metadata>` cuya URL no es de usuario (`/wikiloc/user.do` es el autor, se ignora); el id es el número final de esa URL (`…-182739854`). Lo que nunca entra son actividades propias del administrador o de usuarios: la carpeta `.rutas/` la cura el administrador. Un mismo trazado subido dos veces (solape ≥ 90 % de celdas) se importa una sola vez.
  - Escribe por la Management API (`POST https://api.supabase.com/v1/projects/<ref>/database/query`, token de `.local-secrets/supabase-access-token.txt`, `<ref>` de `SUPABASE_PROJECT_REF` o de `ACCOUNT_PROJECT_URL`), en lotes de 10 rutas con `select public.upsert_reference_routes(<sqlJsonLiteral>)`. Después recalcula toda la tabla de calor: lee `reference_routes_in_box(-90, 90, -180, 180)`, `buildHeatCells` y `replace_reference_heat_cells` en trozos de 3.000 celdas (el primero con `p_box = null`, los siguientes con `p_append = true`).
  - Escribe solo recuentos (leídas, importadas, descartadas por privadas o por tierra, celdas); nunca coordenadas, ID ni el token. `--dry-run` no escribe.
  Sincronización: `runSync` de `rwgps/index.ts` llama a `syncReferenceRoutes` con `importedAt` sobre `reference_routes` (`source = 'rwgps'`), `upsert` por la RPC y `remove` con `delete … where source = 'rwgps' and source_id = …`. Al terminar recalcula el calor de las cajas de las filas tocadas con `reference_routes_in_box` + `buildHeatCells` + `replace_reference_heat_cells` (caja = unión de las cajas tocadas). Ya no escribe en `rwgps_route_index`.

- [ ] **Step 1 (comprobación real, sin escribir nada):** con las credenciales del usuario (si no están, anótalo en `pendingUser` y sigue con fixtures), pide una ruta pública conocida de la lista local por la API v1 y anota en `docs/verificaciones.md` qué campos trae (`unpaved_pct`, `visibility`, `track_points[].e`, `distance`, `elevation_gain`). Sin ID ni coordenadas en el documento.
- [ ] **Step 2: Write the failing tests:**
  - `rwgpsReferenceRow` con un JSON sintético público de 3.000 puntos con altitud: línea de 2.000 puntos con el primero y el último, `loop: true` si cierra a 400 m y `false` a 600 m, `elev_gain_m` de `elevation_gain`; privada → `null`; `unpaved_pct: 6` → `null`; sin `e` en ningún punto → `elev_gain_m: null` y puntos de 2 elementos.
  - `pointsReferenceRow` calcula la caja y redondea a 5 decimales.
  - `gpxSource('rwgps-111.gpx', …)` → `{ source: 'rwgps', sourceId: '111', url: 'https://ridewithgps.com/routes/111' }`; un GPX sintético con `<link href="https://es.wikiloc.com/rutas-ciclismo/ruta-sintetica-123456">` → `{ source: 'wikiloc', sourceId: '123456' }`; sin link → `{ source: 'other', sourceId: null, url: null }`; un GPX sintético de Wikiloc con `<link href="https://www.wikiloc.com/wikiloc/user.do?id=1">` en `<author>` y `<link href="https://www.wikiloc.com/cycling-trails/ruta-sintetica-987654">` en `<metadata>` → `{ source: 'wikiloc', sourceId: '987654' }` (el link de autor se ignora), y sus `<time>` no impiden importarlo.
  - `gpxSource('komoot-123.gpx')` → `{ source: 'komoot', sourceId: '123' }`; `'ruta.gpx'` → `null`.
  - `sqlJsonLiteral` de un texto que contiene `$tag1$` usa otra etiqueta y el SQL resultante no se puede cerrar desde el texto.
  - `scripts/library-import.ts` (leído como texto) no contiene `ridewithgps.com/routes/` seguido de un número.
  - `syncReferenceRoutes` con `get` falso: sube una ruta nueva con `source: 'rwgps'`, no vuelve a pedir una importada hace 10 días, borra una que ya no es pública, y un 429 corta con `error: 'provider_busy'`.
- [ ] **Step 3: Run** `npx vitest run tests/libraryRows.test.ts tests/libraryImportList.test.ts tests/rwgpsSync.test.ts` — Expected: FAIL.
- [ ] **Step 4: Implement** los módulos, el script, `_shared/rwgpsApi.ts` (sale de `authToken`, `readCapped` y `get` de `rwgps/index.ts`, sin cambiar su comportamiento) y el nuevo `runSync`.
- [ ] **Step 5: Run** `npx vitest run tests/libraryRows.test.ts tests/libraryImportList.test.ts tests/rwgpsSync.test.ts tests/rwgpsService.test.ts` — Expected: PASS. `npx tsc --noEmit` limpio. `npx -y tsx scripts/library-import.ts --dry-run --dir tests/fixtures/library-gpx` (GPX sintéticos) termina sin escribir (sin credenciales, falla con un mensaje claro antes de pedir nada).
- [ ] **Step 6:** Sin commit; propuesta de mensaje en `notes`. La primera carga real la hace la sesión principal (lista final).

---

### Task 4: Operación `library` de `route-sources` y llenado automático de zonas

**Files:**
- Create: `src/routes/library/schema.ts`, `src/routes/library/zoneResponse.ts`, `src/routes/library/fill.ts`
- Modify: `src/routes/sources/service.ts` (nuevo `kind: 'library'`), `src/routes/sources/providers.ts` (`sourceTransport` admite `'rwgps'`), `src/routes/sources/client.ts` (`findLibrary`), `supabase/functions/route-sources/index.ts` (dependencias nuevas)
- Test: `tests/libraryZoneResponse.test.ts`, `tests/libraryFill.test.ts`, ampliar `tests/routeSourcesService.test.ts`

**Interfaces:**
- Consumes: `HeatCell`, `passDistanceM`, `LinePoint` (T2); `zoneFactor`, `typicalClimb` (T2); `ReferenceRouteRow`, `rwgpsReferenceRow` (T3); `buildHeatCells` (T2); `rwgpsApi` (T3); RPC de T1; `sourceCacheKey`, `CACHE_TTL_MS`, `claim`, `consumeQuota` de `service.ts`.
- Produces:
  ```ts
  // schema.ts (Deno)
  export const SPARSE_ZONE_ROUTES = 15;
  export const MAX_LIBRARY_ROUTES = 6;
  export const MAX_LIBRARY_CELLS = 8000;
  export const librarySearchSchema;   // strictObject { lat: -85..85, lon: -180..180, radiusM: int 8_000..40_000, distanceKm: 5..300, elevGainM: 0..20_000 | null }
  export type LibrarySearch = z.infer<typeof librarySearchSchema>;
  export function normalizeLibrarySearch(s: LibrarySearch): LibrarySearch;  // lat/lon a 3 decimales, radio hacia arriba a 1 km, km a 1, desnivel a 50 m
  export type LibraryRoute = { id: string; source: ReferenceSource; url: string; name: string; author: string; distanceM: number; elevGainM: number | null; loop: boolean; passM: number; line: LinePoint[] };
  export type HeatCellLite = { lat: number; lng: number; routes: number; climbMPerKm: number | null };
  export type LibraryFill = 'none' | 'imported' | 'nothing-found' | 'unavailable';
  export type LibraryZone = { routeCount: number; cells: HeatCellLite[]; routes: LibraryRoute[]; zoneFactor: number; factorSamples: number; climbMPerKm: number | null; fill: LibraryFill };
  export const libraryZoneSchema;     // en el cable las celdas van como tuplas [lat, lng, routes, climb|null], máx. MAX_LIBRARY_CELLS; routes máx. MAX_LIBRARY_ROUTES
  // zoneResponse.ts (Deno)
  export function buildLibraryZone(search: LibrarySearch, rows: (ReferenceRouteRow & { id: string })[], cells: HeatCell[], fill: LibraryFill): LibraryZone;
  export function circleBox(lat: number, lng: number, radiusM: number): { minLat: number; maxLat: number; minLng: number; maxLng: number };
  // fill.ts (Deno)
  export const FILL_MAX_ROUTES = 15;
  export const FILL_GRID_DEG = 0.05;
  export function fillCentre(lat: number, lng: number): { lat: number; lng: number };   // redondeo a la rejilla de 0,05°
  export function rwgpsSearchUrl(centre: { lat: number; lng: number }, radiusKm: number, distanceKm: number): string;
  export function parseRwgpsSearch(json: unknown): { id: number; distanceM: number; unpavedPct: number | null; loop: boolean; road: boolean }[];
  export async function fillZone(search: LibrarySearch, deps: { transport: SourceTransport; claim: (p: 'rwgps') => Promise<boolean>;
    routeDetail: (id: number, signal: AbortSignal) => Promise<{ status: number; json: unknown }>; upsert: (rows: ReferenceRouteRow[]) => Promise<number>; signal: AbortSignal }): Promise<{ found: number; imported: number; ids: number[] }>;
  // client.ts
  export async function findLibrary(search: LibrarySearch, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<LibraryZone>;
  ```
  Reglas:
  - Petición: `{ source: 'library', kind: 'library', ...LibrarySearch }`; misma autenticación (sin anónimos) y cuota de `route-sources`; tiempo máximo 60 s, como los puntos de paso.
  - `buildLibraryZone`: `routeCount` = filas cuya línea pasa a ≤ `radiusM` del inicio (`passDistanceM`). Factor y subida típica salen de esas filas. Candidatas B: longitud entre el 70 % y el 140 % de la pedida y `passM ≤ 5_000`, ordenadas por `|d − D|/D + (G ? |g − G|/G : 0)` (las de desnivel `null` van al final si se pide desnivel), como mucho `MAX_LIBRARY_ROUTES`, con la línea completa. Celdas: dentro del radio, de más a menos `routes`, como mucho `MAX_LIBRARY_CELLS`.
  - La lectura de la biblioteca no se cachea: es una consulta a nuestras tablas y debe ver lo último importado. La caché de `route-sources` se usa como marca de «zona ya llenada» durante 7 días: clave `v1:rwgps-fill:` + hash de `fillCentre` y radio, con `payload` = array de los ID importados (cabe en `write_route_sources_cache`: sin geometría, ≤ 300 elementos).
  - Llenado: si `routeCount < SPARSE_ZONE_ROUTES` y no hay marca, `fillZone` busca con `rwgpsSearchUrl` (solo el centro de `fillCentre`, nunca el punto pedido), se queda con las de `road && unpavedPct ≤ 5` (o desconocido) y longitud de 20 a 200 km, como mucho `FILL_MAX_ROUTES`; pide cada una por la API v1 (`routeDetail`, con `claim('rwgps')` antes), las convierte con `rwgpsReferenceRow` y hace un upsert. Después recalcula el calor de la caja del círculo (`reference_routes_in_box` + `buildHeatCells` + `replace_reference_heat_cells` con esa caja), vuelve a leer y responde con `fill: 'imported'` o `'nothing-found'`. Un fallo de Ride with GPS (`busy`, bloqueado, sin credenciales) no rompe la respuesta: `fill: 'unavailable'` con lo que ya había.

- [ ] **Step 1 (comprobación real, la hace el agente con `curl`):** lee `https://ridewithgps.com/robots.txt` y haz una búsqueda en `https://ridewithgps.com/find/search.json` con el centro de Caldes redondeado a 0,05° (41,65 / 2,15). Anota en `docs/verificaciones.md`: si `robots.txt` permite `/find/search.json`; qué parámetros aceptan coordenadas y radio (`search[lat]`/`search[lng]`, `search[start_location]` u otros); y los nombres de los campos de km, desnivel, circular (`track_type`), `unpaved_pct` y tipo (`cycling:road`). Sin ID de rutas en el documento. Comprueba también si la API v1 de la cuenta común tiene búsqueda por zona; si la tiene, úsala en lugar de `find/search.json`. **Si `robots.txt` lo prohíbe o no hay forma de buscar por coordenadas, `fillZone` queda implementado pero desactivado (`fill: 'unavailable'` siempre) y se dice en `notes`.**
- [ ] **Step 2: Write the failing tests:**
  - `buildLibraryZone` con filas sintéticas: una ruta que no pasa por el círculo no cuenta en `routeCount`; solo entran como candidatas las de 42-84 km para 60 km con `passM ≤ 5 km`; se devuelven como mucho 6 ordenadas por parecido; con desnivel pedido, una de `elevGainM: null` va detrás de las que lo tienen; las celdas fuera del radio no salen y salen de más a menos `routes`; con 3 circulares, `zoneFactor: 1.7` y `factorSamples: 3`.
  - `normalizeLibrarySearch({ lat: 41.63271, lon: 2.16774, radiusM: 26_100, distanceKm: 60.4, elevGainM: 820 })` → `{ lat: 41.633, lon: 2.168, radiusM: 27_000, distanceKm: 60, elevGainM: 800 }`.
  - `fillCentre(41.6327, 2.1677)` → `{ lat: 41.65, lng: 2.15 }`; `rwgpsSearchUrl` no contiene ningún número con más de 2 decimales.
  - `parseRwgpsSearch` descarta una ruta con `unpaved_pct: 30`, una que no es de carretera y un resultado que no es ruta.
  - `fillZone` con 20 encontradas importa como mucho 15, llama a `claim` antes de cada detalle y para al primer `claim` en `false` conservando lo importado.
  - `handleRouteSources` con `kind: 'library'`: radio 50.000 → 400; anónimo → 401; zona con 20 rutas → no llama a `fillZone`; zona con 3 y sin marca → la llama una vez, guarda la marca `v1:rwgps-fill:` y llama a `replaceHeatCells` con la caja del círculo, respuesta `fill: 'imported'`; con la marca → no la llama (`fill: 'none'`); con `fillZone` que lanza `RouteSourceError('busy')` → 200 con `fill: 'unavailable'`.
  - `findLibrary` con una respuesta que no valida `libraryZoneSchema` lanza `RouteSourceError('invalid_response')`.
- [ ] **Step 3: Run** `npx vitest run tests/libraryZoneResponse.test.ts tests/libraryFill.test.ts tests/routeSourcesService.test.ts` — Expected: FAIL.
- [ ] **Step 4: Implement** los tres módulos, el `kind: 'library'` (con sus dependencias inyectadas `routesInBox`, `heatCellsInBox`, `replaceHeatCells`, `upsertRoutes`, `rwgpsRouteDetail`), `sourceTransport` con `'rwgps'` (límite de lectura 2 MB, `Accept: application/json`) y `findLibrary`. En `route-sources/index.ts`, las dependencias usan las RPC de T1 y `rwgpsApi` de `_shared` (los secrets de Supabase son del proyecto: `route-sources` ve los mismos `RWGPS_*`).
- [ ] **Step 5: Run** `npx vitest run tests/libraryZoneResponse.test.ts tests/libraryFill.test.ts tests/routeSourcesService.test.ts tests/routeSources.test.ts tests/routeSourcesLimits.test.ts` — Expected: PASS. `npx tsc --noEmit` limpio.
- [ ] **Step 6:** Sin commit; propuesta de mensaje en `notes`. El despliegue de `route-sources` lo hace la sesión principal.

---

### Task 5: Generador (B adaptadas + A anillos sobre el mapa de calor)

**Files:**
- Create: `src/routes/library/ring.ts`, `src/routes/library/generate.ts`
- Modify: `src/routes/adapt.ts` (`AdaptedRoute.requestsUsed`)
- Test: `tests/libraryRing.test.ts`, `tests/libraryGenerate.test.ts`, ampliar `tests/adaptRoute.test.ts`

**Interfaces:**
- Consumes: `LibrarySearch`, `LibraryZone`, `LibraryRoute`, `HeatCellLite`, `SPARSE_ZONE_ROUTES` (T4); `cellOverlap`, `lineCells`, `OVERLAP_LIMIT` (T2); `adaptRoute`, `AdaptedRoute` (`adapt.ts`); `fetchPathFeature`, `OrsError`, `OrsAccess` (`ors.ts`); `analyzeRoute`, `rejectReason`, `unknownSurfaceOffRoadPct`, `RouteCandidate` (`analyze.ts`); `geometryQuality` (`quality.ts`); `visitsWaypoints` (`intent.ts`); `rateCandidate`, `GeneratedRoute`, `MAX_INTENT_BACKTRACK` (`generator.ts`); `haversineM`.
- Produces:
  ```ts
  // adapt.ts
  export type AdaptedRoute = { …; requestsUsed: number };   // consultas a ORS gastadas en esta adaptación (0 a MAX_ADAPT_REQUESTS)
  // ring.ts
  export type Ring = { axisDeg: number; k: number; radiusM: number; waypoints: HeatCellLite[]; estimateKm: number; popularity: number; climbMPerKm: number | null };
  export type RingOptions = { distanceKm: number; factor: number; elevGainM: number | null; sparse: boolean; broad: boolean };
  export function ringRadiusM(distanceKm: number, factor: number, k: number): number;   // D·1000 / (f · (k+1) · 2·sin(π/(k+1)))
  export function idealVertices(start: LatLng, axisDeg: number, radiusM: number, k: number): LatLng[];  // círculo que pasa por el inicio, centro a radiusM hacia axisDeg; k vértices repartidos, en orden de paso
  export function loopPerimeterM(points: LatLng[]): number;   // inicio → … → inicio
  export function buildRing(start: LatLng, cells: HeatCellLite[], axisDeg: number, k: number, opts: RingOptions): Ring | null;
  export function candidateRings(start: LatLng, cells: HeatCellLite[], opts: RingOptions): Ring[];
  // generate.ts
  export const GENERATOR_ORS_BUDGET = 20;
  export const LIBRARY_ORS_BUDGET = 8;
  export const MAX_LIBRARY_PROPOSALS = 2;
  export const MIN_PROPOSALS = 3;
  export const MAX_PROPOSALS = 5;
  export const LENGTH_TOLERANCE = 0.1;
  export const GAIN_TOLERANCE = 0.25;
  export const RETRACE_MIN_OVERLAP = 0.6;
  export function libraryRadiusM(distanceKm: number): number;   // 0,45·D km, entre 8 y 40 km
  export type GeneratorTarget = { start: LatLng; distanceKm: number; elevGainM: number | null };
  export type GeneratorCard =
    | { kind: 'biblioteca'; id: string; route: LibraryRoute; adapted: AdaptedRoute }
    | { kind: 'nueva'; id: string; route: GeneratedRoute };
  export type GeneratorUpdate =
    | { kind: 'library' } | { kind: 'library-ready'; routes: number; cells: number; fill: LibraryFill }
    | { kind: 'trying'; used: number; budget: number } | { kind: 'waiting'; seconds: number } | { kind: 'card'; card: GeneratorCard };
  export type GeneratorDeps = { ors: OrsAccess; library: (search: LibrarySearch, signal?: AbortSignal) => Promise<LibraryZone>;
    reference: UserReference | null; visited: ReadonlySet<string>; signal?: AbortSignal; onUpdate?: (u: GeneratorUpdate) => void;
    fetchPath?: typeof fetchPathFeature; adapt?: typeof adaptRoute; wait?: (ms: number, signal?: AbortSignal) => Promise<void> };
  export type GeneratorResult = { cards: GeneratorCard[]; warnings: string[]; requestsUsed: number; zone: { routes: number; cells: number; factor: number; fill: LibraryFill } | null };
  export function meetsRoad(c: RouteCandidate): boolean;                        // rejectReason sin la longitud: sin autopista, ≤ 100 m sin asfaltar y de pista, ≤ 20 % principal
  export function meetsTarget(distanceM: number, elevGainM: number | null, target: GeneratorTarget): boolean;  // ±10 % km; ±25 % desnivel si se pide (null no cumple)
  export function toParsedReference(route: LibraryRoute): ParsedReferenceRoute;  // como toReferenceRoute de rwgpsProposals.ts, para ProposalCard y «Guardar»
  export async function generateProposals(target: GeneratorTarget, deps: GeneratorDeps): Promise<GeneratorResult>;
  ```
  Anillos (`ring.ts`), decisiones que la spec deja al constructor:
  - Normal: `k = 5` (polígono de 6 vértices con el inicio, el mismo que mide el factor de zona), 8 ejes cada 45°, celdas con `routes ≥ 2` (≥ 1 si `sparse`), radio de búsqueda alrededor de cada vértice ideal `0,35·r`. Amplio (`broad`): ejes desplazados 22,5°, `k` 4 y 6, `routes ≥ 1`, `0,5·r`.
  - Cada vértice ideal se ajusta a la celda de esa ventana con más `log(1 + routes)` menos, si se pide desnivel, `|climb − G/D| / (G/D)`. Ninguna celda a < 1,5 km del inicio ni a < 0,4·r de otro vértice ya elegido. Si un vértice no tiene celda, el anillo es `null`.
  - Estimación = `factor · loopPerimeterM([start, ...waypoints])`. Si se aparta > 5 %, se recalcula una vez con `r · D / estimación`. Solo vale si queda a ±12 %.
  - Orden de `candidateRings`: con desnivel, primero por ajuste de `climbMPerKm` medio a `G/D` y después por `popularity` (Σ `log(1 + routes)`); sin desnivel, por `popularity`. Se quitan los anillos con el mismo conjunto de celdas.
  Algoritmo de `generateProposals`:
  1. `onUpdate({ kind: 'library' })` y `deps.library` con `libraryRadiusM(D)`. Sin rutas ni celdas: 0 tarjetas, 0 consultas y el aviso «No hay rutas de referencia en esta zona todavía…» (si `fill === 'unavailable'`, añade que no se ha podido buscar en Ride with GPS). Un fallo de `library` lanza su error (la pantalla lo enseña).
  2. **B:** por orden, mientras haya < 2 aceptadas y el gasto de B no pase de `LIBRARY_ORS_BUDGET`: `adapt(points, { start, mode: 'mi-inicio', targetKm: D, targetGainM: G ?? undefined }, { ors, signal })`. Vale si no tiene `rejected`, `meetsTarget(adapted.distanceM, adapted.elevGainM, target)`, pasa el **re-trazado** y su solape con las aceptadas es < `OVERLAP_LIMIT`. Re-trazado: una consulta `fetchPath` con 8 puntos repartidos por distancia a lo largo de la ruta adaptada (el primero y el último, el inicio); vale si `meetsRoad` y `cellOverlap(retrazado, adaptada) ≥ RETRACE_MIN_OVERLAP`. Así se miden el firme y la carretera principal de una ruta que no viene de ORS. Gasto de B = Σ `adapted.requestsUsed` + re-trazados.
  3. **A:** con el resto del presupuesto, de anillo en anillo (`candidateRings` se recalcula tras cada respuesta con el factor aprendido = mediana de `km reales / perímetro del polígono` de las consultas hechas; al principio, `zone.zoneFactor`): una consulta `fetchPath([start, ...waypoints, start])`. Si `|d − D| > 10 % D`, segunda consulta con el anillo rehecho con el factor medido en esa respuesta (la «corrección»). Vale si `visitsWaypoints`, hay datos de firme y `unknownSurfaceOffRoadPct ≤ 20`, `meetsRoad`, `meetsTarget`, `geometryQuality(coords).backtrackM ≤ MAX_INTENT_BACKTRACK · d` y solape < 0,7 con las aceptadas. La tarjeta lleva `rateCandidate(c, objetivo, { reference, visited })`, con la firma que ya tiene en `generator.ts`. Como mucho 2 consultas por anillo.
  4. Si tras la pasada normal hay < `MIN_PROPOSALS` y queda presupuesto, pasada amplia (`broad: true`). Nunca pasa de `MAX_PROPOSALS` ni de `GENERATOR_ORS_BUDGET`.
  5. Errores de ORS: `rate_minute` espera `min(60, retryAfterS + 1)` s (60 si no lo dice) con `{ kind: 'waiting' }`, como mucho 2 esperas por búsqueda, y repite sin gastar presupuesto; `no_route`/`server`: siguiente anillo o candidata; `quota_day`/`session`/`unreachable`: corta, conserva lo aceptado y añade el mensaje. Cancelación: `AbortError`.
  6. Orden final: B primero; después A de más a menos `score`. Con < 3: aviso con cuántas cumplen «60 km ±10 %» (y «800 m ±25 %» si se pide), el desnivel más alto conseguido entre las que cumplían la distancia, y si se llegó al límite de consultas.

- [ ] **Step 1: Write the failing tests.** ORS falso que devuelve una `OrsFeature` sintética que pasa por los puntos pedidos con un factor de longitud configurable, extras configurables y altitud sintética; biblioteca falsa; inicio sintético.
  - `tests/libraryRing.test.ts`:
    - `ringRadiusM(60, 1.75, 5)` ≈ 5.714 m (±1).
    - `idealVertices(start, 0, 5000, 5)`: los 5 a 5.000 ±5 m del centro, que queda a 5.000 m al norte del inicio; `loopPerimeterM([start, ...v])` ≈ 30.000 ±50.
    - `buildRing` elige en cada ventana la celda con más `routes`; con desnivel pedido, entre dos celdas de `routes` parecidos, la de `climbMPerKm` más próxima a `G/D`; devuelve `null` si a un vértice no le queda celda; la estimación final queda a ±12 %.
    - `candidateRings` sin `sparse` ignora celdas de `routes: 1`; con `sparse`, las usa; `broad` da anillos de `k` 4 y 6 con ejes a 22,5°.
  - `tests/libraryGenerate.test.ts`:
    - **Corrección:** con factor de zona 1,75 y ORS que devuelve 1,0 veces el perímetro, el primer anillo sale corto (> 10 %), la segunda consulta usa un anillo cuyo perímetro es ≈ el primero × D / medido (±5 %) y se acepta; 2 llamadas a `fetchPath` para ese anillo.
    - **Mezcla:** biblioteca con 3 rutas que encajan → como mucho 2 tarjetas `biblioteca`, primero; total entre 3 y 5.
    - **Solape:** una segunda vuelta A con `cellOverlap` 0,75 con una aceptada se descarta; con 0,65 entra.
    - **Presupuesto:** `requestsUsed ≤ 20` siempre, también cuando todas fallan; el gasto de B (adaptaciones + re-trazados) nunca pasa de 8.
    - **Filtros:** una vuelta con 25 % de carretera principal, otra con 150 m sin asfaltar y otra con 20 % de retroceso no entran; una B cuyo re-trazado comparte < 0,6 de celdas no entra.
    - **Desnivel imposible:** con `elevGainM: 800` y todas las vueltas de 400 m: 0 tarjetas A y un aviso que cita «400 m».
    - **Desnivel desconocido:** con desnivel pedido, una B con `elevGainM: null` no entra; sin desnivel pedido, sí.
    - **Zona vacía:** biblioteca sin rutas ni celdas → 0 tarjetas, 0 consultas, un aviso; con `fill: 'unavailable'` el aviso dice que no se ha podido buscar en Ride with GPS.
    - **Sin ruta:** ORS que da `no_route` a todo → 0 tarjetas, aviso, no lanza.
    - **Límite por minuto:** `rate_minute` con `retryAfterS: 5` en la 3.ª consulta → `wait(6000)`, `{ kind: 'waiting', seconds: 6 }` y sigue; abortar durante la espera lanza `AbortError`.
    - **Cuota diaria:** `quota_day` tras 2 aceptadas → devuelve esas 2 y el aviso; no lanza.
  - `tests/adaptRoute.test.ts`: `requestsUsed` es 0 para un circuito que pasa por el inicio y 2 para una ruta que necesita entrada y regreso.
- [ ] **Step 2: Run** `npx vitest run tests/libraryRing.test.ts tests/libraryGenerate.test.ts tests/adaptRoute.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `ring.ts`, `generate.ts` y el campo `requestsUsed` (el contador `used` que `adaptRoute` ya lleva).
- [ ] **Step 4: Run** `npx vitest run tests/libraryRing.test.ts tests/libraryGenerate.test.ts tests/adaptRoute.test.ts tests/catalog.test.ts tests/rwgpsExplore.test.ts` — Expected: PASS. `npx tsc --noEmit` limpio.
- [ ] **Step 5:** Sin commit; propuesta de mensaje en `notes`.

---

### Task 6: Pantalla única del generador en `#/rutas` (mobile-first)

**Files:**
- Modify: `src/ui/pages/Rutas.tsx` (se reescribe entero sobre la estructura de `RutasCerca.tsx`), `src/App.tsx` (`/rutas/ia`, `/rutas/cerca`, `/rutas/empalmar`, `/rutas/catalogo`, `/rutas/wikiloc/*` → `<Navigate to="/rutas" replace />`; se quitan las importaciones de `RutasIa`, `RutasCerca` y `Empalmar`), `src/ui/shell/screens.ts` (sin `/rutas/ia` ni `/rutas/wikiloc*`)
- Create: `src/ui/routes/NewRouteCard.tsx`
- Test: `e2e/rutas.spec.ts` (reescrito; los casos de Wikiloc y Explore de `e2e/rutas-cerca.spec.ts` pasan aquí), `tests/rutas.test.tsx` (reescrito)

**Interfaces:**
- Consumes: `generateProposals`, `GeneratorCard`, `GeneratorUpdate`, `GENERATOR_ORS_BUDGET`, `MIN_PROPOSALS`, `toParsedReference` (T5); `findLibrary` (T4); `ProposalCard`, `StartChoice`, `startPoint`, `CyclingLoader`, `StateView`, `RideMap`, `GpxHelpSheet`, `sendGpx`, `useSaveRoute`, `routeName`, `referenceRange`; `chooseOrsAccess`, `sessionToken`, `sharedOrsEnabled`; `resolveReference` (`ai/levelSummary.ts`); `loadVisitedCells`; `loadWikilocRequest`, `saveWikilocRequest`, `wikilocSearchUrl`, `isWikilocUrl`, `rwgpsExploreUrl`, `adaptRoute` y `parseReferenceRoute` (bloques de Explore y Wikiloc de `RutasCerca.tsx`, tal cual).
- Produces: pantalla `#/rutas`; `NewRouteCard({ card, start }: { card: Extract<GeneratorCard, { kind: 'nueva' }>; start: LatLng })`.

Contenido:
- Título «Rutas». Entrada: «Elige inicio, km y, si quieres, desnivel. Te proponemos de 3 a 5 vueltas de carretera hechas con rutas reales de ciclistas de la zona.»
- Formulario: inicio (Casa, Aquí o punto en el mapa, con `StartChoice`), km, desnivel opcional y botón «Proponer rutas». La búsqueda nunca arranca sola. Se recuerda la última petición como hoy (`saveWikilocRequest`).
- Progreso: `CyclingLoader`, una línea de estado («Cargando las rutas de la zona…», «12 rutas y 3.400 tramos en la zona. Montando vueltas…», «Probando 6 de 20…», «Esperando 6 s por el límite de consultas…»), `<progress>` con `max = GENERATOR_ORS_BUDGET` y `value = used`, «Llevas N s.» y, pasados 8 s sin respuesta de la biblioteca, «Si la zona es nueva, la primera búsqueda tarda más: estamos buscando rutas en Ride with GPS.» Botón «Cancelar», que conserva las tarjetas ya aceptadas.
- Tarjetas:
  - `biblioteca`: `ProposalCard` con `origin` «De la biblioteca · Ride with GPS · autor» (o el nombre de la fuente) y `source` de `toParsedReference`.
  - `nueva`: `NewRouteCard` (sale de `MotorCard` de `NearbyCard.tsx`). Lleva la etiqueta «Nueva», el nombre de `routeName` («Vuelta por el norte») y un `RideMap` en línea, como `ProposalCard`. Cifras: km, desnivel, dificultad y tiempo a tu ritmo. Botones «Exportar GPX» y «Guardar en la biblioteca».
- Avisos en una sola tarjeta `StateView` informativa, nunca roja salvo un error que corta.
- Debajo, plegados y como hoy: «¿Buscas en Ride with GPS Explore?» y «¿Buscas en Wikiloc?», con subir el GPX y adaptarlo. También la lista con «Biblioteca de rutas» (`/rutas/biblioteca`) y «Ruta de Ride with GPS Explore» (`/rutas/compartida`).
- Sin acceso a ORS (sin cuenta y sin clave propia): `StateView` que explica cómo activarlo, como `RutasCerca`.
- Mobile-first: una columna a 360 px sin scroll horizontal; objetivos táctiles ≥ 44 px; el botón «Proponer rutas» se ve sin desplazar a 360×740 con el teclado cerrado; los nombres largos se cortan con elipsis en una línea y salen completos en el mapa.

- [ ] **Step 1: Write the failing tests.**
  - `e2e/rutas.spec.ts`, a 360×740 y 430×932, con `page.route` para `route-sources` (biblioteca sintética) y `ors-proxy` (features sintéticas) y la cuenta de `accountFixture.ts`, como `e2e/rutas-cerca.spec.ts`:
    - `#/rutas/ia`, `#/rutas/cerca`, `#/rutas/empalmar` y `#/rutas/catalogo` acaban en `#/rutas`.
    - Al cargar no se pide nada a `route-sources` ni a `ors-proxy` hasta pulsar «Proponer rutas».
    - Pedir 60 km enseña de 3 a 5 tarjetas, cada una con «De la biblioteca» o «Nueva»; con 2 rutas de biblioteca que encajan, las 2 primeras son «De la biblioteca».
    - El cuerpo de la petición `library` no contiene «Casa» y su `lat`/`lon` tiene como mucho 3 decimales.
    - Una biblioteca vacía enseña 0 tarjetas y el aviso de zona sin rutas.
    - Con ORS lento, «Cancelar» deja las tarjetas ya aceptadas y para las peticiones.
    - `document.documentElement.scrollWidth <= innerWidth`; todos los botones de las tarjetas miden ≥ 44 px de alto.
    - Los pliegues de Explore y Wikiloc existen y abren su pestaña (`window.open` interceptado).
    - Capturas en `test-results/rutas/` de las dos anchuras, con resultados, sin resultados y buscando.
  - `tests/rutas.test.tsx`: al montar no se llama a `generateProposals`; con `card` y `waiting`, el estado y la cuenta atrás cambian como se ha descrito.
- [ ] **Step 2: Run** `npx vitest run tests/rutas.test.tsx` y `PLAYWRIGHT_PORT=4517 npx playwright test e2e/rutas.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Carga antes las skills de UI de `CLAUDE.md` (`frontend-design:frontend-design`, `ui-ux-pro-max:ui-ux-pro-max`, `react-best-practices`) y usa los tokens y estilos existentes (`library.css`, `wikiloc.css`, `rutas.css`).
- [ ] **Step 4: Run** los mismos — Expected: PASS a 360 y 430 px. `npx tsc --noEmit` limpio. Mira las capturas.
- [ ] **Step 5:** Sin commit; propuesta de mensaje en `notes`. `RutasIa.tsx`, `RutasCerca.tsx` y `Empalmar.tsx` quedan sin ruta: se borran en la Tarea 7.

---

### Task 7: Borrar las pantallas antiguas y lo que solo usaban ellas (UI)

**Files:**
- Delete (pantallas y componentes sin ningún importador tras la Tarea 6): `src/ui/pages/RutasIa.tsx`, `src/ui/pages/RutasCerca.tsx`, `src/ui/pages/Empalmar.tsx`, `src/ui/components/AiRoutes.tsx`, `src/ui/components/GuidedQuestions.tsx`, `src/ui/components/RouteForm.tsx`, `src/ui/routes/NearbyCard.tsx`, `src/ui/routes/useRouteSearch.ts`, `src/ui/styles/splice.css` e `ia.css` si nadie más los importa
- Delete (sus pruebas): `tests/rutasIa.test.tsx`, `tests/rutasCerca.test.tsx`, `tests/empalmar.test.tsx`, `tests/useRouteSearch.test.tsx`, `e2e/rutas-ia.spec.ts`, `e2e/rutas-cerca.spec.ts`, `e2e/empalmar.spec.ts`, `e2e/break-ui-empalmar.spec.ts`, `e2e/break-ui-rutas-cerca.spec.ts`
- Modify: `src/ui/calendario/AiWeekSheet.tsx` (sin nivel, enseña `InitialQuestions` y guarda con `saveDeclaredReference`), `src/ui/routes/useSaveRoute.ts` (sin `spliceHref`; la acción del aviso pasa a «Ver biblioteca» → `/rutas/biblioteca`), `src/ui/pages/BibliotecaRutas.tsx` (sin el enlace «Empalmar rutas»), `src/ui/routes/routeView.ts` (solo lo que siguen importando: comprueba con grep), `e2e/escritorio.spec.ts`, `e2e/mapa-rutas.spec.ts`, `e2e/paleta.spec.ts`, `e2e/compartida.spec.ts`, `e2e/rwgps.spec.ts`, `tests/app.test.tsx`, `tests/shell.test.tsx`, `tests/inicio.test.tsx`, `tests/routeView.test.ts`, `tests/aiWeekSheet.test.tsx`
- Se queda (y por qué): `InitialQuestions.tsx` (la referencia declarada la usa la semana con IA); `ProposalCard`, `StartChoice`, `RouteMapSheet`, `RouteCard`, `gpxExport`, `sendGpx`, `useSaveRoute` (pantalla nueva, Compartida, Reto); `BibliotecaRutas` y `RutaCompartida` (la spec las conserva).

**Interfaces:**
- Consumes: `InitialQuestions`, `saveDeclaredReference`, `referenceFromAnswers` (`ai/levelSummary.ts`).
- Produces: ningún símbolo nuevo. `NO_LEVEL` de `AiWeekSheet` deja de citar «Rutas con IA».

- [ ] **Step 1: Write the failing test:** `tests/aiWeekSheet.test.tsx`: sin salidas ni referencia declarada aparece «Cuéntanos cómo sales»; al guardar las tres cifras se llama a `saveDeclaredReference` y se puede pedir la semana. `tests/shell.test.tsx`: `/rutas/ia` ya no tiene nombre propio.
- [ ] **Step 2: Run** `npx vitest run tests/aiWeekSheet.test.tsx tests/shell.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** Borra con `git rm`. Antes de borrar cada fichero, comprueba que no le queda importador: `grep -rlE "from '[./]+(.*/)?<Nombre>(\.tsx?)?'" src tests e2e` vacío (sin contar los ficheros que se borran en esta tarea). Si un fichero de la lista aparece importado por otro que se queda, no lo borres y explícalo en `notes`.
- [ ] **Step 4: Run** `npx tsc --noEmit`, `npx vitest run tests/aiWeekSheet.test.tsx tests/shell.test.tsx tests/app.test.tsx tests/inicio.test.tsx tests/routeView.test.ts tests/bibliotecaRutas.test.tsx` y `PLAYWRIGHT_PORT=4517 npx playwright test e2e/escritorio.spec.ts e2e/mapa-rutas.spec.ts e2e/compartida.spec.ts e2e/ia-entrenos.spec.ts` — Expected: PASS. `grep -rn "rutas/ia\|rutas/cerca\|rutas/empalmar" src` solo encuentra las redirecciones de `App.tsx`.
- [ ] **Step 5:** Sin commit; propuesta de mensaje en `notes`.

---

### Task 8: Borrar los motores, la IA de rutas y las operaciones de servidor sin uso

**Files:**
- Delete (sin importadores tras la Tarea 7; compruébalo con el mismo grep): `src/routes/nearby.ts`, `src/routes/waypointEngine.ts`, `src/routes/sources/waypoints.ts`, `src/routes/sources/passes.ts`, `src/routes/historyPasses.ts`, `src/routes/historyWaypoints.ts`, `src/routes/diversity.ts`, `src/routes/sources/rwgpsProposals.ts`, `src/ai/routePlanner.ts`, `src/ai/waypointCombos.ts`, `src/ai/spliceAdvisor.ts`, `src/ai/references.ts`, `src/ai/goalContext.ts` (si solo lo usaban `RutasIa`/`Empalmar`), `scripts/diagnose-routes.ts`, y sus pruebas: `tests/nearby.test.ts`, `waypointEngine.test.ts`, `waypointCombos.test.ts`, `waypointsSource.test.ts`, `mountainPassSources.test.ts`, `historyPasses.test.ts`, `historyWaypoints.test.ts`, `diversity.test.ts`, `rwgpsProposals.test.ts`, `routePlanner.test.ts`, `spliceAdvisor.test.ts`, `aiReferences.test.ts`, `goalContext.test.ts`, `splice.test.ts`, `generator.test.ts`
- Create: `supabase/migrations/202611160002_drop_rwgps_route_index.sql`, `supabase/tests/drop_rwgps_route_index.sql` (registrados al final de `scripts/test-account-sql.mjs`)
- Modify:
  - `src/routes/generator.ts`: se queda solo con `ROUND_TRIP_POINTS`, `AIM_FRACTION`, `INITIAL_ROAD_FACTOR`, `MAX_INTENT_BACKTRACK`, `GeneratedRoute` y `rateCandidate` (los usan `adapt.ts` y el generador nuevo); se borran `generateRoutes` y el resto. `tests/generator.test.ts` se sustituye por `tests/rateCandidate.test.ts` con los casos de `rateCandidate` que ya existían.
  - `src/routes/splice.ts`: se queda solo con `SPLICE` (lo usa `adapt.ts`).
  - `src/routes/intent.ts`: sin `libraryIntent`, `passIntent` ni `RouteIntent` si nadie los usa; se quedan `orient` y `visitsWaypoints`.
  - `src/routes/sources/rwgpsExplore.ts`: `toReferenceRoute` pasa aquí desde `rwgpsProposals.ts`.
  - `src/routes/sources/rwgpsImport.ts`, `rwgpsService.ts`, `supabase/functions/rwgps/index.ts`: fuera la operación `nearby` (`rwgpsNearbySchema`, `rankNearby`, `passDistanceM`, `near`, `lastSyncAt`, `fetchRwgpsNearby`, `RwgpsIndexRow`). La sincronización cada 6 h se lanza ahora desde la lectura de la biblioteca: `route-sources` comprueba `rwgps_sync_state` y, si toca, llama a la función `rwgps` con una petición de servicio `{ op: 'sync' }` firmada con la clave de servicio, que solo acepta ese token.
  - `src/routes/sources/service.ts`, `client.ts`: fuera los `kind` `passes` y `waypoints`, `findMountainPasses`, `findWaypoints`, `findRouteReferences` y `routeSourcesEnabled` si no les queda importador. El `kind` de rutas (Wikiloc/OSM) se queda: no lo cita la spec.
  - `src/ai/llm.ts`: recibe `chatWithRetry` (sale de `routePlanner.ts`; lo usa `workoutPlanner.ts`).
  - `src/ai/shared/service.ts`, `src/ai/prompts.ts`, `src/ai/schema.ts`, `src/ai/contracts.ts`, `src/ai/sharedClient.ts`, `supabase/functions/ai-routes/index.ts`: solo queda la operación `workouts`. La función `ai-routes` sigue desplegada porque la usa la semana con IA.
  - `tests/sharedAi.test.ts`, `tests/prompts.test.ts`, `tests/aiSchema.test.ts`, `tests/llm.test.ts`, `tests/rwgpsService.test.ts`, `tests/rwgpsImport.test.ts`, `tests/routeSourcesService.test.ts`, `tests/rwgpsExplore.test.ts`: sin los casos de lo borrado.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `chatWithRetry` en `src/ai/llm.ts` (misma firma); `toReferenceRoute` en `rwgpsExplore.ts` (misma firma); la petición `{ op: 'sync' }` de `rwgps`. Migración `202611160002`: `drop function public.rwgps_routes_near(double precision, double precision, double precision); drop table public.rwgps_route_index;` (se queda `rwgps_sync_state`).

- [ ] **Step 1: Write the failing tests:**
  - `supabase/tests/drop_rwgps_route_index.sql`: `to_regclass('public.rwgps_route_index') is null`, `rwgps_routes_near` no existe y `rwgps_sync_state` y `reference_routes` siguen.
  - `tests/rwgpsService.test.ts`: `{ op: 'nearby', … }` → 400; `{ op: 'sync' }` con un token que no es el de servicio → 401; con el de servicio → 202 y lanza la sincronización una vez.
  - `tests/routeSourcesService.test.ts`: `kind: 'passes'` y `kind: 'waypoints'` → 400.
  - `tests/sharedAi.test.ts`: `operation: 'plan'`, `'splice'` y `'waypoints'` → 400; `workouts` sigue pasando.
- [ ] **Step 2: Run** `npm run test:db` y `npx vitest run tests/rwgpsService.test.ts tests/routeSourcesService.test.ts tests/sharedAi.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** en este orden, con `npx tsc --noEmit` en verde después de cada paso: mover `chatWithRetry`, `toReferenceRoute` y lo que se queda de `generator.ts` y `splice.ts`; borrar los motores y sus pruebas; podar la IA compartida; podar `rwgps` y `route-sources`; la migración `202611160002`.
- [ ] **Step 4: Run** `npx tsc --noEmit`, `npm run test:db` y `npx vitest run tests/rateCandidate.test.ts tests/adaptRoute.test.ts tests/rwgpsService.test.ts tests/rwgpsImport.test.ts tests/rwgpsExplore.test.ts tests/routeSourcesService.test.ts tests/sharedAi.test.ts tests/workoutPlanner.test.ts tests/prompts.test.ts tests/aiSchema.test.ts tests/llm.test.ts tests/catalog.test.ts tests/libraryGenerate.test.ts` — Expected: PASS. `npm run build` sin errores (lo pide esta tarea porque cambia el grafo de módulos).
- [ ] **Step 5:** Sin commit; propuesta de mensaje en `notes`. La migración `202611160002` se aplica la última en producción (lista final).

---

### Task 9: Script de prueba real `scripts/check-generator.ts`

**Files:**
- Rename + rewrite: `scripts/check-nearby.ts` → `scripts/check-generator.ts` (`git mv`)
- Create: `src/routes/library/acceptance.ts`
- Test: `tests/libraryAcceptance.test.ts`

**Interfaces:**
- Consumes: `generateProposals`, `GeneratorCard`, `meetsRoad`, `meetsTarget` (T5); `buildLibraryZone`, `normalizeLibrarySearch`, `circleBox` (T4); `cellOverlap`, `OVERLAP_LIMIT` (T2); `analyzeRoute`, `geometryQuality`, `buildOrsBody`, `orsExtras`.
- Produces:
  ```ts
  export type AcceptanceItem = { kind: 'biblioteca' | 'nueva'; distanceM: number; elevGainM: number | null; road: { unpavedM: number; trackM: number; mainRoadPct: number; motorway: boolean } | null; backtrackM: number; line: LatLng[] };
  export type AcceptanceRow = AcceptanceItem & { maxOverlap: number; valid: boolean; reasons: string[] };
  export function acceptanceReport(target: GeneratorTarget, items: AcceptanceItem[]): { rows: AcceptanceRow[]; valid: number; passed: boolean }; // passed = valid ≥ 3
  ```
  Script:
  - Uso: `ORS_API_KEY=… npx -y tsx scripts/check-generator.ts [km] [desnivel|-] [lat] [lng] [-v]`. Sin argumentos ejecuta los dos casos de la spec desde el centro público de Caldes (41,6327 / 2,1677): 60 km y 60 km con 800 m.
  - Biblioteca de producción por la Management API (token de `.local-secrets/supabase-access-token.txt`): `reference_routes_in_box` y `reference_heat_cells_in_box` de `circleBox`, y `buildLibraryZone(search, rows, cells, 'none')`. Sin llenado automático.
  - ORS real con la clave del usuario y el mismo límite que `ors-proxy` (38 por minuto).
  - Por cada propuesta escribe: tipo, km, desnivel, metros sin asfaltar y de pista, % de carretera principal (en las B, del re-trazado), % de retroceso, solape máximo con las demás, válida o no y por qué. Por caso: «N válidas de M (mínimo 3, ideal 5)», consultas a ORS, tiempo y factor de la zona. Nunca geometrías, claves ni ID.
  - Código de salida 1 si algún caso tiene menos de 3 válidas.

- [ ] **Step 1: Write the failing tests** (`tests/libraryAcceptance.test.ts`): 54,0 y 66,0 km valen con D = 60, y 53,9 y 66,1 no; con G = 800, 600 y 1.000 valen, 599 y 1.001 no, y `null` no vale; 21 % de carretera principal no vale; 150 m sin asfaltar no vale; dos vueltas que comparten el 75 % de las celdas de la corta: solo la primera vale; `passed` exige 3 válidas.
- [ ] **Step 2: Run** `npx vitest run tests/libraryAcceptance.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `acceptance.ts` y el script (mismo cargador de `import.meta.env` que el script anterior).
- [ ] **Step 4: Run** `npx vitest run tests/libraryAcceptance.test.ts` — Expected: PASS; `npx tsc --noEmit` limpio; `npx -y tsx scripts/check-generator.ts` sin `ORS_API_KEY` sale con un mensaje claro antes de pedir nada. La ejecución real necesita la migración `0007` aplicada y la carga hecha en producción: si no lo están, anótalo en `pendingUser` (la hace la sesión principal en la lista final).
- [ ] **Step 5:** Sin commit; propuesta de mensaje en `notes`.

---

### Task 10: Verificación del lote (QA)

**Files:**
- Modify: `docs/verificaciones.md` (resultado de las comprobaciones locales)

- [ ] **Step 1: Run** `npx tsc --noEmit`, `npx vitest run`, `npm run test:db` y `npm run build` — Expected: todo en verde (un test de jsdom que falla por tiempo se repite una vez antes de darlo por fallo).
- [ ] **Step 2: Run** `PLAYWRIGHT_PORT=4517 npx playwright test e2e/rutas.spec.ts e2e/compartida.spec.ts e2e/biblioteca-calidad.spec.ts e2e/escritorio.spec.ts e2e/mapa-rutas.spec.ts e2e/paleta.spec.ts e2e/ia-entrenos.spec.ts e2e/inicio.spec.ts` — Expected: PASS.
- [ ] **Step 3:** `break-ui` sobre `#/rutas` a 360 px: nombres de ruta de 300 caracteres y sin espacios, autor vacío, 0, 3 y 5 tarjetas, 4 avisos largos, desnivel de 20.000 m, 300 km. Y `web-design-guidelines` sobre la pantalla. Solo se informa de lo que rompe el uso.
- [ ] **Step 4:** Capturas a 360×740 y 430×932 (con resultados, sin resultados, buscando) en `test-results/rutas/`, revisadas. Anota en `docs/verificaciones.md` lo comprobado y lo que queda para la prueba real.
- [ ] **Step 5:** Sin commit; propuesta de mensaje en `notes`.

---

## Lista final (sesión principal, con confirmación del usuario en cada paso)

No es una tarea de agente: publicar es irreversible y lo hace la sesión principal.

1. Revisar los resultados de los lotes con el usuario y hacer los commits que confirme.
2. Aplicar `202611160001_reference_library.sql` en producción por la Management API.
3. Primera carga: con las credenciales de Ride with GPS en variables de entorno, `npx -y tsx scripts/library-import.ts --dry-run` y después sin `--dry-run`. Comprobar con SQL que hay ≥ 50 filas `source = 'rwgps'` (de las 54 de la lista; las privadas o con tierra se descartan) y celdas en `reference_heat_cells`. Los GPX de Komoot y Bikemap van aparte y no bloquean.
4. **Prueba real antes de publicar:** `ORS_API_KEY=… npx -y tsx scripts/check-generator.ts` y **enseñar la salida al usuario**. Criterio: al menos 3 válidas (ideal 5) en 60 km y en 60 km con 800 m. Si no se cumple, no se publica: se diagnostica con `-v`.
5. Desplegar `route-sources`, `rwgps` (con `supabase/functions/_shared/`) y `ai-routes`.
6. Push a `main` (GitHub Pages).
7. Prueba del usuario en el móvil, a 360-430 px, desde Caldes con los dos casos. Anotar en `docs/verificaciones.md` cuántas salen, de qué tipo, km, desnivel, solape máximo, consultas a ORS y tiempo.
8. Cuando `reference_routes` tenga las rutas de la sincronización (`source = 'rwgps'`), aplicar `202611160002_drop_rwgps_route_index.sql`.
9. Nueva sección en `docs/ESTADO.md`, referencia del plan en `CLAUDE.md` y recordar revocar el token de Supabase tras desplegar.

## Autorrevisión frente a la spec

- §1 Datos: Tarea 1 (tablas y RPC) y Tarea 4 (lectura `kind: 'library'` con cuadrículas, rutas con línea, factor y subida típica).
- §2 Carga: script del administrador y sincronización en la Tarea 3; llenado automático con menos de 15 rutas en la Tarea 4; borrado del índice antiguo en la Tarea 8, con la migración aplicada la última.
- §3 Generador: radio de biblioteca, B (70-140 %, ≤ 5 km, `adaptRoute`, como mucho 2), A (anillos de 4-6 puntos, factor de zona, corrección > 10 %), filtros, solape y presupuesto de unas 20 consultas en la Tarea 5.
- §4 Pantalla única y borrados: Tareas 6, 7 y 8, con grep antes de cada borrado. Biblioteca y Ruta compartida se quedan.
- §5 Pruebas: unitarias y SQL en cada tarea, `check-generator` en la Tarea 9 y en la lista final, e2e a 360 y 430 px en las Tareas 6 y 10.
- Tipos: `LinePoint` (T2) lo usan T3, T4 y T5; `LibraryZone`/`LibraryRoute` (T4) los usan T5 y T6; `GeneratorCard` (T5) lo usan T6 y T9; `requestsUsed` (T5) lo usa el presupuesto de B.
- Nada de esta lista publica: migraciones, carga, despliegues y push van en la lista final de la sesión principal.

## Lotes

Lote 1, datos y motor (sin UI). Cada tarea queda probada por separado:

```
Workflow({ scriptPath: 'C:/testTrain/.claude/workflows/develop-phase.js', args: { plan: 'docs/superpowers/plans/2026-11-13-generador-rutas-biblioteca.md', ui: false, reviewers: 'plan', tasks: [
  { n: 1, agent: 'cycling-data-engineer' }, { n: 2, agent: 'cycling-metrics-analyst' },
  { n: 3, agent: 'cycling-data-engineer' }, { n: 4, agent: 'cycling-routes-engineer' },
  { n: 5, agent: 'cycling-routes-engineer' } ] } })
```

Lote 2, pantalla, limpieza, prueba real y QA (después de revisar y confirmar el lote 1):

```
Workflow({ scriptPath: 'C:/testTrain/.claude/workflows/develop-phase.js', args: { plan: 'docs/superpowers/plans/2026-11-13-generador-rutas-biblioteca.md', ui: true, reviewers: 'plan', tasks: [
  { n: 6, agent: 'cycling-frontend-dev' }, { n: 7, agent: 'cycling-frontend-dev' },
  { n: 8, agent: 'cycling-routes-engineer' }, { n: 9, agent: 'cycling-routes-engineer' },
  { n: 10, agent: 'cycling-qa' } ] } })
```

El workflow cita siempre la spec general (`develop-phase.js`, constante `SPEC`); la spec de esta fase está en la cabecera de este plan y los agentes la leen desde aquí. Si se quiere doble revisión (plan + calidad), basta con quitar `reviewers: 'plan'`.
