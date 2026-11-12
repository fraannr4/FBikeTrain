# Rutas cerca: motor propio por puntos de paso (fase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. En este proyecto se ejecuta con el workflow `develop-phase` (ver «Ejecución» al final). Los agentes no hacen commit: el paso «Commit» de cada tarea es solo `git add`; el commit lo hace el usuario al final del lote.

**Goal:** Sustituir `#/rutas/catalogo` por «Rutas cerca», que propone al menos 5 vueltas de carretera desde el inicio elegido: primero las rutas reales que encajan (índice de Ride with GPS) y después las del motor propio, que encadena puntos de paso (puertos, subidas CIMA, tramos habituales, pueblos) con ORS `directions`. Objetivo de fondo: que cada vuelta tenga sentido de ciclista y pase por los puntos más espectaculares de la zona (puertos y cimas conocidos), como haría una buena ruta de Wikiloc.

**Architecture:** Tres fuentes de puntos de paso (servidor `route-sources` con Overpass para puertos, cimas y pueblos; historial local para subidas y tramos repetidos) alimentan un combinador. La IA compartida agrupa los puntos por dirección recibiendo solo nombres y cifras; si falla, el código hace las combinaciones. Cada combinación se convierte en una vuelta con `fetchPathFeature` y pasa el filtro de carretera, el de objetivo (±10 % km, ±25 % desnivel) y el de diversidad (rumbos ≥ 45°, solape < 70 %), compartido con las propuestas de Ride with GPS.

**Tech Stack:** Vite + React + TypeScript, Vitest, Playwright, zod, OpenRouteService (proxy común `ors-proxy`), Supabase Edge Functions (`route-sources`, `ai-routes`), Overpass.

**Spec:** `docs/ESTADO.md`, sección «Retomar aquí (2026-11-12, noche)», decisiones 1, 2, 3 y 8. Especificación general: `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md`. Requisito móvil: `docs/requisito-mobile-first.md`.

## Global Constraints

- Mobile-first con prioridad absoluta: cada pantalla se valida primero con capturas reales a 360 y 430 px (`docs/requisito-mobile-first.md`).
- La IA solo recibe nombres y cifras: nunca coordenadas, tracks, celdas del historial ni la palabra o dirección de «Casa».
- Las celdas y tracks del historial nunca salen del navegador (los tramos habituales se calculan en local).
- Repositorio público: nada de claves, archivos de Strava ni tracks reales; los fixtures son sintéticos.
- ORS común: 8 consultas por minuto por persona (`orsProxy.ts`). Las consultas van de una en una, nunca en paralelo; un `rate_minute` espera 60 s con aviso y se puede cancelar.
- Presupuesto por búsqueda: `NEARBY_ORS_BUDGET = 14` consultas a ORS para el motor (las de adaptar rutas de Ride with GPS van aparte, ya limitadas en `rwgpsProposals.ts`).
- Objetivo de cada propuesta automática: distancia dentro de ±10 % de la pedida; desnivel dentro de ±25 % cuando se pide; filtro de carretera `ROAD_FILTER` de `analyze.ts` (≤ 100 m sin asfaltar, ≤ 100 m de pista, ≤ 20 % de carretera principal, sin autopista).
- Diversidad de la lista final (reales + motor): rumbos separados ≥ 45° (`MIN_HEADING_GAP_DEG = 45`) y solape < 0,7 (`OVERLAP_LIMIT` de `catalog/recommend.ts`).
- Al menos 5 propuestas (`MIN_PROPOSALS = 5`), hasta 6.
- Textos de la interfaz en castellano, sin anglicismos innecesarios. Marca B Trazado y tokens de la app; nada de colores sueltos.

## Review Focus

1. **Sin puntos de paso** (route-sources caído, inicio en una zona sin pueblos ni puertos en la banda): el motor sigue con vueltas `round_trip` dirigidas a los lados libres y la pantalla dice cuántas ha encontrado y por qué no hay más; nunca se queda en blanco ni lanza. Prueba en Tarea 5.
2. **Límite por minuto de ORS a media búsqueda:** espera 60 s con cuenta atrás visible, «Cancelar» corta al momento y conserva las rutas ya aceptadas. Prueba en Tarea 5 (lógica) y Tarea 6 (UI).
3. **Respuesta de la IA inválida** (ids que no se enviaron, más de 3 puntos, texto con coordenadas, JSON roto, 429): se descarta lo inválido y se completa con las combinaciones del código, sin aviso alarmante. Prueba en Tarea 4.
4. **Cima en fondo de saco** (Turó de l'Home, Farell): subir y bajar por la misma carretera es legítimo en esas cimas; se admite un retroceso de hasta el 30 % solo si el punto es `cima` con `deadEnd`, y en ningún otro caso. Prueba en Tarea 5.
5. **Desnivel imposible para la zona** (800 m pedidos con pocos puertos cerca): nunca se cuentan para las 5 rutas que estén fuera de ±25 %; se muestran las que cumplen y un aviso con el desnivel más alto conseguido. Prueba en Tarea 5.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/routes/sources/waypoints.ts` (nuevo) | Consulta Overpass de puntos de paso (puertos, cimas, pueblos), parseo y esquema zod |
| `src/routes/sources/service.ts`, `client.ts` (modificar) | Nuevo `kind: 'waypoints'` en `route-sources` y cliente `findWaypoints` |
| `src/metrics/grid.ts` (modificar) | `buildCellCounts`: actividades distintas por celda de 200 m |
| `src/routes/historyWaypoints.ts` (nuevo) | Subidas (`historyPasses`) y tramos repetidos como puntos de paso locales |
| `src/routes/waypointEngine.ts` (nuevo) | Tipos de punto de paso, banda, combinaciones por código, filtro de objetivo |
| `src/routes/diversity.ts` (nuevo) | Rumbo de una línea y selección diversa compartida (sale de `rwgpsProposals.ts`) |
| `src/ai/shared/service.ts`, `src/ai/prompts.ts`, `src/ai/sharedClient.ts`, `src/ai/waypointCombos.ts` (nuevo) | Operación `waypoints` de la IA compartida y su validación |
| `src/routes/generator.ts` (modificar) | Exportar `rateCandidate` (antes `rate`) y admitir `budget` |
| `src/routes/nearby.ts` (nuevo) | Orquestador `proposeNearbyRoutes`: reales primero, motor después |
| `src/ui/pages/RutasCerca.tsx` (nuevo), `src/ui/routes/NearbyCard.tsx` (nuevo), `src/App.tsx`, `src/ui/pages/Rutas.tsx` (modificar); `src/ui/pages/Catalogo.tsx` (borrar) | Pantalla «Rutas cerca» |
| `e2e/rutas-cerca.spec.ts` (nuevo; sustituye `e2e/catalogo.spec.ts`) | Extremo a extremo a 360 y 430 px |

---

### Task 1: Puntos de paso de OSM en `route-sources`

**Files:**
- Create: `src/routes/sources/waypoints.ts`
- Modify: `src/routes/sources/service.ts` (nuevo `kind: 'waypoints'`, clave de caché `v1:waypoints`), `src/routes/sources/client.ts` (`findWaypoints`)
- Test: `tests/waypointsSource.test.ts`, ampliar `tests/routeSourcesService.test.ts`

**Interfaces:**
- Consumes: `metres` (`overpass.ts`), `RouteSourceError`, `SourceTransport`, la función privada `suitableRoad` de `passes.ts` (exportarla como `suitablePavedRoad`).
- Produces:
  ```ts
  export type OsmWaypointKind = 'puerto' | 'cima' | 'pueblo';
  export type OsmWaypoint = { id: string; kind: OsmWaypointKind; name: string; lat: number; lng: number; ele: number | null; distanceM: number; deadEnd?: boolean; interes: 0 | 1 | 2 | 3 };
  export const waypointSearchSchema // { lat, lon, radiusM: int 8_000..35_000 }
  export const osmWaypointsSchema   // z.array(...).max(60)
  export function buildWaypointQuery(input: WaypointSearch): string
  export function parseWaypoints(raw: unknown, input: WaypointSearch): OsmWaypoint[]
  // client.ts
  export async function findWaypoints(start: LatLng, radiusM: number, functions: RouteSourceInvoker, signal?: AbortSignal): Promise<OsmWaypoint[]>
  ```

Qué cuenta como punto:
- `puerto`: `node[mountain_pass=yes]` o `node[natural=saddle]` con `name`, a ≤ 120 m de una vía `suitablePavedRoad`. id `osm-pass-<n>`.
- `cima`: `node[natural=peak][name]` con una vía `suitablePavedRoad` a ≤ 150 m (las subidas CIMA terminan en carretera asfaltada: Farell, Tagamanent, Turó de l'Home). `deadEnd: true` si las vías asfaltadas a ≤ 150 m tienen un solo extremo libre (el nodo final de la carretera está a ≤ 150 m de la cima). id `osm-peak-<n>`.
- `pueblo`: `node[place~"^(village|town)$"][name]` a ≤ 250 m de una vía `highway~"^(secondary|tertiary)$"`. id `osm-place-<n>`; `ele` null.
- `interes` (cuánto vale la pena pasar por él): +1 si tiene `wikidata` o `wikipedia`; +1 si `ele ≥ 700`; +1 si es `puerto` o `cima`. Un pueblo sin ficha queda en 0.
- Se descartan los de menos de 3 km del inicio. Como mucho 20 de cada tipo: primero los de más `interes` y, a igualdad, los más cercanos.

- [ ] **Step 1: Write the failing tests** (`tests/waypointsSource.test.ts`), con un JSON de Overpass sintético:
  - Un `puerto` con `wikidata` y `ele: 1150` sale con `interes: 3`; un `pueblo` sin ficha, con `interes: 0`.
  - `parseWaypoints` devuelve un `puerto` con su carretera asfaltada a 80 m y descarta otro cuya única vía tiene `surface=gravel`.
  - Una `cima` con la carretera acabando a 100 m sale con `deadEnd: true`; una con la carretera pasando de largo, `deadEnd` ausente.
  - Un `pueblo` junto a una `tertiary` entra; uno junto solo a `residential` no.
  - Un punto a 2 km del inicio no entra; el resultado nunca pasa de 60 elementos.
  - `buildWaypointQuery` usa `[bbox:...]` (no `around` global) y lanza con `radiusM: 40_000`.
  - En el test del servicio: `{ source: 'osm', kind: 'waypoints', lat, lon, radiusM }` se cachea con clave que empieza por `v1:waypoints:`, y una caché que no valida con `osmWaypointsSchema` se ignora.
- [ ] **Step 2: Run** `npx vitest run tests/waypointsSource.test.ts` — Expected: FAIL (módulo no existe).
- [ ] **Step 3: Implement** `waypoints.ts`, el `kind: 'waypoints'` en `service.ts` (misma cuantización a 3 decimales y radio redondeado a 5 km que `normalizePassSearch`) y `findWaypoints` en `client.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/waypointsSource.test.ts tests/routeSourcesService.test.ts tests/mountainPassSources.test.ts` — Expected: PASS. `npx tsc --noEmit` limpio.
- [ ] **Step 5: Stage** `git add src/routes/sources tests/waypointsSource.test.ts`. El despliegue de `route-sources` lo hace la sesión principal al final del lote, con confirmación del usuario.

---

### Task 2: Puntos de paso del historial (local)

**Files:**
- Modify: `src/metrics/grid.ts` (añadir `buildCellCounts`)
- Create: `src/routes/historyWaypoints.ts`
- Test: `tests/historyWaypoints.test.ts`, ampliar `tests/grid.test.ts`

**Interfaces:**
- Consumes: `cellKey`, `historyPasses(start, climbs, track, signal)` (`historyPasses.ts`), `listActivities`, `getTrack` (`db/repo`).
- Produces:
  ```ts
  // grid.ts
  export type CellCount = { count: number; at: LatLng };   // at = primer punto real del track en esa celda
  export function buildCellCounts(tracks: Iterable<TrackPoint[]>): Map<string, CellCount>; // count = tracks distintos
  // historyWaypoints.ts
  export type HistoryWaypoint = { id: string; kind: 'habitual'; name: string; lat: number; lng: number; ele: number | null; distanceM: number; approach?: LatLng; departure?: LatLng };
  export const MIN_REPEATS = 3;
  export const HABITUAL_SPACING_M = 2_000;
  export async function historyWaypoints(start: LatLng, band: { minM: number; maxM: number }, deps: { climbs: ClimbEffort[]; listTracks?: () => AsyncIterable<TrackPoint[]>; track?: (id: string) => Promise<TrackPoint[] | undefined>; signal?: AbortSignal }): Promise<HistoryWaypoint[]>;
  ```
  Reglas: subidas de `historyPasses` dentro de la banda, con nombre «Subida habitual N»; tramos = celdas con `count ≥ MIN_REPEATS` dentro de la banda, ordenadas por `count` descendente, separadas ≥ `HABITUAL_SPACING_M` entre sí y de las subidas, nombre «Tramo habitual N», punto = `at` (sobre la carretera, no el centro de la celda). Como mucho 6 subidas y 6 tramos. Ids `hist-climb-N` y `hist-cell-N`.

- [ ] **Step 1: Write the failing tests:**
  - `buildCellCounts` con tres tracks sintéticos que pasan por la misma celda cuenta 3, y un track que pasa dos veces por la misma celda cuenta 1 ahí.
  - `historyWaypoints` con tracks sintéticos devuelve un tramo con `count ≥ 3` dentro de la banda y descarta uno con 2 repeticiones y otro fuera de la banda.
  - Dos celdas repetidas a 800 m entre sí dan un solo tramo (la de más repeticiones).
  - Con un `signal` abortado lanza `AbortError` sin leer más tracks.
- [ ] **Step 2: Run** `npx vitest run tests/historyWaypoints.test.ts tests/grid.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Lee los tracks de uno en uno como `loadVisitedCells` en `history.ts` (por defecto `listActivities` + `getTrack`).
- [ ] **Step 4: Run** los mismos tests — Expected: PASS.
- [ ] **Step 5: Stage** los ficheros.

---

### Task 3: Combinaciones por código y filtro de objetivo

**Files:**
- Create: `src/routes/waypointEngine.ts`, `src/routes/diversity.ts`
- Modify: `src/routes/sources/rwgpsProposals.ts` (usar `diversity.ts`; sin cambio de comportamiento)
- Test: `tests/waypointEngine.test.ts`, `tests/diversity.test.ts`; `tests/rwgpsProposals.test.ts` debe seguir pasando sin tocarlo.

**Interfaces:**
- Consumes: `OsmWaypoint` (Task 1), `HistoryWaypoint` (Task 2), `directionName`, tipo `Direccion` (`src/ai/references.ts`), `overlap`, `OVERLAP_LIMIT` (`catalog/recommend.ts`), `rejectReason`, `RouteCandidate` (`analyze.ts`).
- Produces:
  ```ts
  // diversity.ts (movidos desde rwgpsProposals.ts, que los reexporta)
  export const MIN_HEADING_GAP_DEG = 45;
  export function bearingDeg(from: LatLng, to: LatLng): number;
  export function routeBearing(line: LatLng[], start: LatLng): number;
  export function angleGap(a: number, b: number): number;
  export function sameRoute(a: LatLng[], b: LatLng[]): boolean;            // overlap > OVERLAP_LIMIT en cualquier sentido
  export function fitsDiversity(line: LatLng[], start: LatLng, chosen: LatLng[][], minGapDeg?: number): boolean;
  // waypointEngine.ts
  export type Waypoint = (OsmWaypoint | HistoryWaypoint) & { bearing: number; direccion: Direccion };
  export type Combo = { id: string; waypointIds: string[]; direccion: Direccion; source: 'ia' | 'codigo'; titulo?: string };
  export type EngineTarget = { distanceKm: number; elevGainM: number | null };
  export const ROAD_FACTOR = 1.3;
  export function waypointBand(distanceKm: number): { minM: number; maxM: number };    // 0,15·D a 0,42·D en línea recta
  export function toWaypoints(start: LatLng, points: (OsmWaypoint | HistoryWaypoint)[], band: { minM: number; maxM: number }): Waypoint[]; // filtra banda, quita duplicados a < 300 m (gana el del historial)
  export function estimateLoopKm(start: LatLng, points: LatLng[], roadFactor?: number): number;
  export function codeCombos(start: LatLng, waypoints: Waypoint[], target: EngineTarget, roadFactor?: number): Combo[];
  export function comboWaypoints(start: LatLng, combo: Combo, byId: ReadonlyMap<string, Waypoint>): LatLng[]; // [start, ...puntos (con approach/departure si los hay), start]
  export function fitsTarget(c: RouteCandidate, target: EngineTarget): boolean;
  ```
  Reglas de `codeCombos`:
  - Combinaciones de 1 punto, o de 2 puntos cuyo rumbo difiere entre 20° y 90°, ordenados por rumbo para dar una vuelta sin cruzarse.
  - Solo entran las que tienen `estimateLoopKm` dentro de ±15 % de la distancia pedida.
  - Puntuación: suma de `interes` de sus puntos (los del historial cuentan 2: el usuario ya los elige) y, con desnivel pedido, +2 por cada `puerto`/`cima`. Más 1 si la estimación queda a ±5 %. Así, en cada rumbo gana la vuelta por el puerto o la cima más conocidos, no la del pueblo más cercano.
  - Orden de salida: la mejor de cada uno de los 8 rumbos (`direccion`), de más a menos puntuación; después la segunda mejor de cada rumbo. Como mucho 16.
  - `fitsTarget`: `rejectReason(c, D) === null`, `|distanceM − D| ≤ 0,10·D` y, si hay desnivel, `|elevGainM − G| ≤ 0,25·G`.

- [ ] **Step 1: Write the failing tests:**
  - `waypointBand(60)` → `{ minM: 9_000, maxM: 25_200 }`.
  - `codeCombos` con puntos sintéticos en los 8 rumbos alrededor de un inicio sintético (no Caldes) da como primeras 8 combinaciones una por rumbo, sin repetir `direccion`.
  - Sin desnivel pedido, en un rumbo con un `puerto` de `interes: 3` y un `pueblo` de `interes: 0` a la misma distancia, la primera combinación pasa por el puerto.
  - Con `elevGainM: 800`, la primera combinación de un rumbo con un `puerto` y un `pueblo` incluye el `puerto`.
  - Ninguna combinación tiene `estimateLoopKm` fuera de ±15 %.
  - `fitsTarget`: 54,0 km y 66,0 km con D = 60 pasan; 53,9 y 66,1 no. Con G = 800: 600 y 1.000 pasan; 599 y 1.001 no. Una candidata con 150 m sin asfaltar no pasa.
  - `fitsDiversity`: dos líneas a 40° no caben con 45°; a 50° sí; dos líneas que se solapan un 75 % no caben aunque estén a 90°.
- [ ] **Step 2: Run** `npx vitest run tests/waypointEngine.test.ts tests/diversity.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** ambos módulos y cambia `rwgpsProposals.ts` para importar de `diversity.ts` (reexporta `bearingDeg` y `routeBearing` para no romper importaciones).
- [ ] **Step 4: Run** `npx vitest run tests/waypointEngine.test.ts tests/diversity.test.ts tests/rwgpsProposals.test.ts` — Expected: PASS.
- [ ] **Step 5: Stage** los ficheros.

---

### Task 4: La IA combina los puntos por dirección

**Files:**
- Modify: `src/ai/shared/service.ts` (operación `waypoints`), `src/ai/prompts.ts` (prompt), `src/ai/sharedClient.ts` (`combine` en `SharedAiPlanner` o planificador propio `SharedWaypointPlanner`), `supabase/functions/ai-routes/index.ts` solo si hace falta enrutar la operación nueva
- Create: `src/ai/waypointCombos.ts`
- Test: `tests/waypointCombos.test.ts`, ampliar `tests/sharedAi.test.ts`

**Interfaces:**
- Consumes: `Waypoint`, `Combo`, `EngineTarget`, `codeCombos` (Task 3); `createSharedAiPlanner` y patrón de `chatWithRetry`.
- Produces:
  ```ts
  // Lo único que viaja a la IA:
  export type AiWaypoint = { id: string; tipo: 'puerto' | 'cima' | 'pueblo' | 'habitual'; nombre: string; cotaM: number | null; distanciaKm: number; direccion: Direccion; interes: number };
  export type AiCombo = { puntos: string[]; direccion: Direccion; titulo: string };
  export function toAiWaypoints(waypoints: Waypoint[]): { forAi: AiWaypoint[]; byAiId: Map<string, Waypoint> }; // ids 'w1'..'wN', máx. 24, nombres ≤ 60
  export function validateAiCombos(raw: AiCombo[], byAiId: ReadonlyMap<string, Waypoint>): Combo[];      // source 'ia'
  export async function combineWaypoints(start: LatLng, waypoints: Waypoint[], target: EngineTarget, ai: SharedWaypointPlanner | null, signal?: AbortSignal): Promise<{ combos: Combo[]; usedAi: boolean }>;
  export type SharedWaypointPlanner = { combine: (objetivo: { distanciaKm: number; desnivelM: number | null }, puntos: AiWaypoint[], signal?: AbortSignal) => Promise<{ combinaciones: AiCombo[] }> };
  ```
  - Esquema de salida (zod, en el servicio): `combinaciones` de 1 a 10; cada una con `puntos` de 1 a 3 ids únicos, `direccion` de las 8 y `titulo` de 1 a 60 caracteres.
  - El prompt pide vueltas que un ciclista local elegiría: por direcciones distintas, que pasen por los puntos más espectaculares (más `interes`, puertos y cimas conocidos) y que encadenen 2 o 3 puntos con sentido (subir un puerto y volver por otro valle, no ir y volver por la misma carretera). Deben cuadrar con km y desnivel. Solo usa ids de la lista. No inventa lugares.
  - `combineWaypoints`: combinaciones de la IA validadas primero. Después las de `codeCombos` que no repiten el mismo conjunto de puntos. Si la IA lanza, devuelve `usedAi: false` y solo las del código. `ai === null` (sin IA común) también va al código.

- [ ] **Step 1: Write the failing tests:**
  - `toAiWaypoints`: el JSON serializado no contiene la latitud ni la longitud del inicio ni de ningún punto (busca los números con 4 decimales), ni la palabra «Casa», ni `approach`/`departure`.
  - `validateAiCombos` descarta una combinación con un id que no se envió, otra con 4 puntos y otra con ids repetidos; conserva una válida.
  - `combineWaypoints` con una IA que lanza `LlmError('rate_limit')` devuelve las de `codeCombos` y `usedAi: false`; con una IA que devuelve 2 válidas, esas 2 van primero con `source: 'ia'`.
  - El servicio rechaza (400) una petición `waypoints` con 25 puntos o con un campo `lat`.
- [ ] **Step 2: Run** `npx vitest run tests/waypointCombos.test.ts tests/sharedAi.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Reutiliza el límite de cuota de la IA común y el reintento con el error de validación de `chatWithRetry`.
- [ ] **Step 4: Run** los mismos tests — Expected: PASS.
- [ ] **Step 5: Stage** los ficheros. El despliegue de `ai-routes` lo hace la sesión principal con confirmación del usuario.

---

### Task 5: Orquestador «Rutas cerca»

**Files:**
- Modify: `src/routes/generator.ts` (exportar `rate` como `rateCandidate`; `GenerateRequest.budget?: number` con techo 14, por defecto `SEARCH_REQUEST_BUDGET`)
- Create: `src/routes/nearby.ts`
- Test: `tests/nearby.test.ts`; `tests/generator.test.ts` debe seguir pasando.

**Interfaces:**
- Consumes: `proposeRwgpsRoutes` (sin cambios), `findWaypoints` (T1), `historyWaypoints` (T2), `toWaypoints`, `waypointBand`, `comboWaypoints`, `estimateLoopKm`, `fitsTarget`, `fitsDiversity`, `routeBearing` (T3), `combineWaypoints` (T4), `fetchPathFeature`, `analyzeRoute`, `visitsWaypoints`, `geometryQuality`, `generateRoutes`, `rateCandidate`.
- Produces:
  ```ts
  export const NEARBY_ORS_BUDGET = 14;
  export const DEAD_END_BACKTRACK = 0.3;   // solo combinaciones con una 'cima' deadEnd; el resto usa MAX_INTENT_BACKTRACK (0,15)
  export type NearbyTarget = RecommendTarget;   // { start, distanceKm, elevGainM }
  export type NearbyCard =
    | { kind: 'real'; source: 'rwgps'; proposal: Proposal }
    | { kind: 'motor'; route: GeneratedRoute; via: string[]; combo: 'ia' | 'codigo' | 'vuelta' };
  export type NearbyUpdate = RwgpsProposalUpdate | { kind: 'waypoints'; count: number } | { kind: 'engine'; tried: number; accepted: number; budget: number } | { kind: 'waiting'; seconds: number };
  export type NearbyDeps = RwgpsProposalDeps & {
    reference: UserReference | null; visited: ReadonlySet<string>;
    findWaypoints?: (start: LatLng, radiusM: number, signal?: AbortSignal) => Promise<OsmWaypoint[]>;
    historyWaypoints?: (start: LatLng, band: { minM: number; maxM: number }, signal?: AbortSignal) => Promise<HistoryWaypoint[]>;
    ai: SharedWaypointPlanner | null;
    fetchPath?: typeof fetchPathFeature; generate?: typeof generateRoutes; wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  };
  export type NearbyResult = { cards: NearbyCard[]; warnings: string[]; requestsUsed: number; usedAi: boolean };
  export async function proposeNearbyRoutes(target: NearbyTarget, deps: NearbyDeps): Promise<NearbyResult>;
  ```
  Algoritmo:
  1. Reales: `proposeRwgpsRoutes`. Cada propuesta entra si cumple `fitsDiversity` con las ya elegidas. Un fallo de Ride with GPS no fatal añade un aviso y sigue. Uno fatal de sesión o cuota diaria de ORS corta.
  2. Puntos: OSM (`findWaypoints` con radio `maxM` redondeado hacia arriba a 5 km, entre 8 y 35 km) e historial, en paralelo. Un fallo de cualquiera añade aviso y sigue con el otro.
  3. `combineWaypoints`.
  4. Para cada combinación, mientras queden presupuesto y huecos (hasta 6):
     - recalcula su estimación con la mediana de `distanciaReal / estimación` de las ya pedidas (al principio, `ROAD_FACTOR`) y salta las que quedan fuera de ±12 %;
     - salta las que van a una `direccion` ya ocupada por una aceptada;
     - pide `fetchPathFeature(comboWaypoints(...))`, comprueba `visitsWaypoints`, analiza, aplica el límite de retroceso (`DEAD_END_BACKTRACK` o `MAX_INTENT_BACKTRACK`), `fitsTarget` y `fitsDiversity`, y puntúa con `rateCandidate`;
     - `rate_minute`: espera 60 s con `{ kind: 'waiting' }` (como mucho 3 veces) y repite; `no_route`/`server`: siguiente combinación; `quota_day`/`session`/`unreachable`: corta y conserva lo aceptado.
  5. Si faltan para 5 y queda presupuesto: `generateRoutes` con `usedSides` de las aceptadas y `budget` = lo que queda; solo entran las que cumplen `fitsTarget` y `fitsDiversity` (`combo: 'vuelta'`).
  6. Si hay menos de 5: aviso que dice cuántas cumplen y, con desnivel pedido, el desnivel más alto conseguido.
  - Orden final: reales primero; después las del motor, de más a menos puntuación.
  - `via`: nombres de los puntos en el orden de paso. Para los tramos del historial, «tramo habitual» sin coordenadas.

- [ ] **Step 1: Write the failing tests** (`tests/nearby.test.ts`, con ORS, Ride with GPS, OSM, historial e IA falsos y geometrías sintéticas):
  - Con 0 rutas reales y 8 combinaciones válidas en 8 rumbos: devuelve ≥ 5 tarjetas `motor`, rumbos separados ≥ 45° dos a dos, ninguna pareja con solape > 0,7, todas dentro de ±10 % km.
  - Con 2 rutas reales: van primero y una combinación del motor en el mismo rumbo que una real no entra.
  - `requestsUsed ≤ NEARBY_ORS_BUDGET` siempre, también cuando todas las combinaciones fallan.
  - Una vuelta que sube y baja por la misma carretera (retroceso 25 %) se acepta si su punto es `cima` con `deadEnd` y se rechaza si es un `pueblo`.
  - Con `elevGainM: 800` y solo vueltas de 400 m: 0 tarjetas del motor y un aviso que cita «400 m».
  - `findWaypoints` que lanza: sigue con historial y `round_trip` y añade un aviso.
  - `rate_minute` en la 3.ª consulta: llama a `wait(60_000)`, emite `{ kind: 'waiting', seconds: 60 }` y luego acepta la ruta. Un `signal` abortado durante la espera lanza `AbortError`.
  - `quota_day` tras 3 aceptadas: devuelve esas 3 y un aviso; no lanza.
- [ ] **Step 2: Run** `npx vitest run tests/nearby.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `nearby.ts` y los dos cambios de `generator.ts`.
- [ ] **Step 4: Run** `npx vitest run tests/nearby.test.ts tests/generator.test.ts tests/rwgpsProposals.test.ts` — Expected: PASS.
- [ ] **Step 5: Stage** los ficheros.

---

### Task 6: Pantalla «Rutas cerca» (mobile-first)

**Files:**
- Create: `src/ui/pages/RutasCerca.tsx`, `src/ui/routes/NearbyCard.tsx`
- Modify: `src/App.tsx` (`/rutas/cerca` → `RutasCerca`; `/rutas/catalogo` y `/rutas/wikiloc/*` → `Navigate` a `/rutas/cerca`), `src/ui/pages/Rutas.tsx:353` (fila «Rutas cerca», meta «Al menos 5 vueltas de carretera desde donde salgas»)
- Delete: `src/ui/pages/Catalogo.tsx`, `e2e/catalogo.spec.ts` (sus casos de Wikiloc pasan a la nueva spec)
- Test: `e2e/rutas-cerca.spec.ts`

**Interfaces:**
- Consumes: `proposeNearbyRoutes`, `NearbyCard`, `NearbyUpdate` (T5); `StartChoice`, `startPoint`, `ProposalCard`, `RouteMapSheet`, `gpxExport`, `CyclingLoader`, `chooseOrsAccess`, `loadVisitedCells`, `findWaypoints` + invocador de `route-sources`, `createSharedAiPlanner` (planificador `combine`); bloque de Wikiloc actual de `Catalogo.tsx` (`wikilocSearchUrl`, subir GPX) tal cual.
- Produces: pantalla `#/rutas/cerca`.

Contenido:
- Formulario igual que hoy: km, desnivel opcional, salida Casa / Aquí / Mapa y botón «Proponer rutas». La búsqueda nunca arranca sola.
- Progreso con `CyclingLoader` y una línea de estado: «Buscando rutas reales a 15 km», «12 puntos de paso», «Probando 4 de 14», «Esperando 60 s por el límite de consultas». Botón «Cancelar».
- Tarjetas `NearbyCard`:
  - una etiqueta de origen: «Ride with GPS · autor» o «Motor FBikeTrain»;
  - para el motor, «Por Collformic · Sant Feliu de Codines» y la marca «Combinada por la IA» si `combo === 'ia'`;
  - km, desnivel, rumbo («Hacia el norte»), dificultad y tiempo estimado;
  - acciones Mapa, GPX y Guardar. Las reales siguen usando `ProposalCard`.
- Avisos de `warnings` en una sola tarjeta `StateView` informativa, nunca roja salvo error que corta.
- Wikiloc, debajo y plegado: «¿Buscas en Wikiloc?».
- Mobile-first:
  - una columna a 360 px, sin scroll horizontal;
  - objetivos táctiles ≥ 44 px;
  - el botón principal queda visible sin desplazar con el teclado cerrado a 360×740;
  - textos largos de `via` cortados con elipsis en una línea y completos en el mapa.

- [ ] **Step 1: Write the failing e2e** (`e2e/rutas-cerca.spec.ts`, con `page.route` para `ors-proxy`, `rwgps`, `route-sources` y `ai-routes`; cuenta de `accountFixture.ts`), a 360×740 y 430×932:
  - `#/rutas/catalogo` redirige a `#/rutas/cerca`.
  - Pedir 60 km enseña ≥ 5 tarjetas, cada una con etiqueta de origen; con 2 reales simuladas, las 2 primeras dicen «Ride with GPS».
  - `document.documentElement.scrollWidth <= innerWidth`; todos los botones de las tarjetas miden ≥ 44 px de alto.
  - Con un 429 simulado de ORS, aparece «Esperando» y «Cancelar» deja las tarjetas ya aceptadas.
  - El cuerpo de la petición a `ai-routes` con `operation: 'waypoints'` no contiene `lat`, `lng` ni «Casa».
  - Capturas en `test-results/rutas-cerca/` de las dos anchuras, con y sin resultados.
- [ ] **Step 2: Run** `PLAYWRIGHT_PORT=4517 npx playwright test e2e/rutas-cerca.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** la página, la tarjeta y las rutas. Carga antes las skills de UI que indica `CLAUDE.md` (frontend-design, ui-ux-pro-max, react-best-practices) y usa los tokens existentes.
- [ ] **Step 4: Run** la spec — Expected: PASS a 360 y 430 px. `npx tsc --noEmit` limpio. Revisa las capturas.
- [ ] **Step 5: Stage** los ficheros (y el borrado de `Catalogo.tsx` y `e2e/catalogo.spec.ts`).

---

### Task 7: Verificación del lote y prueba real

**Files:**
- Modify: `docs/verificaciones.md` (resultado de la prueba real), `docs/ESTADO.md` (sección nueva arriba)

- [ ] **Step 1: Run** `npx tsc --noEmit`, `npx vitest run`, `npm run build` y `PLAYWRIGHT_PORT=4517 npx playwright test e2e/rutas-cerca.spec.ts e2e/rwgps.spec.ts e2e/rutas.spec.ts` — Expected: todo en verde (anota el test intermitente conocido de la Biblioteca si aparece).
- [ ] **Step 2:** `web-design-guidelines` y `break-ui` sobre `RutasCerca` (nombres de pueblo larguísimos en `via`, 0 resultados, 6 resultados, avisos largos) a 360 px.
- [ ] **Step 3 (sesión principal, con confirmación del usuario):** desplegar `route-sources` y `ai-routes`.
- [ ] **Step 4 (sesión principal + usuario, datos reales):** desde Caldes, en el móvil del usuario y en Playwright contra producción con su sesión:
  - 60 km sin desnivel;
  - 60 km con 800 m.
  Para cada búsqueda, anota en `docs/verificaciones.md`:
  - cuántas propuestas salen (≥ 5) y su origen;
  - km y desnivel de cada una;
  - la separación mínima de rumbos (≥ 45°) y el solape máximo (< 70 %);
  - si todas son de asfalto;
  - las consultas a ORS gastadas y el tiempo total.
  Si alguna búsqueda da menos de 5, es un fallo: no se cierra la fase.
- [ ] **Step 4b (usuario): contraste con Wikiloc.** El usuario abre en Wikiloc las 5 rutas de carretera mejor valoradas de unos 60 km desde Caldes y anota por qué puertos y cimas pasan. Se compara con las nuestras. Criterio: los puertos y cimas que repiten 2 o más de esas rutas de Wikiloc aparecen en al menos una de nuestras propuestas. Si falta alguno, se mira si está entre los puntos de paso (Tarea 1) y por qué no se eligió (puntuación de Tarea 3 o prompt de Tarea 4), y se corrige antes de cerrar.
- [ ] **Step 5:** sección nueva en `docs/ESTADO.md` y propuesta de mensaje de commit (sin hacer commit).

---

## Ejecución

Lote único de develop-phase. El usuario lo pide así: `ui: true`, modelo sonnet y un solo revisor. El workflow lanza hoy dos revisores por tarea (`develop-phase.js:97-98`). Antes de lanzar hay que añadirle `args.reviewers: 'plan'`, que deja solo `cycling-reviewer`.

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-12-rutas-cerca-motor.md', ui: true, model: 'sonnet', reviewers: 'plan', tasks: [
  { n: 1, agent: 'cycling-routes-engineer' }, { n: 2, agent: 'cycling-metrics-analyst' },
  { n: 3, agent: 'cycling-routes-engineer' }, { n: 4, agent: 'cycling-routes-engineer' },
  { n: 5, agent: 'cycling-routes-engineer' }, { n: 6, agent: 'cycling-frontend-dev' } ] } })
```

La tarea 7 la hace la sesión principal con el usuario: lanza las comprobaciones, despliega con su confirmación y hace la prueba real.
