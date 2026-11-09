# F2: historial y repetidas. Plan de implementación

> **Prioridad móvil (2026-11-07).** Rige `docs/requisito-mobile-first.md`. Las pantallas de este plan se implementan siguiendo el prototipo móvil `docs/design/prototipo-movil/` (README, kit `movil.css`/`movil.js` y la página correspondiente), que prevalece sobre las descripciones de interfaz de este plan si chocan. La lógica, las interfaces y las pruebas del plan siguen vigentes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ver todas las salidas con su mapa y su perfil, y reconocer las subidas y rutas que se repiten, con el tiempo, la velocidad y la VAM de cada pasada.

**Architecture:**
- Al importar, cada salida con track se analiza una vez: subidas detectadas (`ClimbEffort`) y firma del trazado (`RouteSig`). Se guardan en dos tablas nuevas de Dexie (versión 2). Las salidas importadas en F1 se analizan al abrir Historial, Subidas o Rutas.
- Agrupar subidas y rutas son funciones puras sobre esas tablas. Los grupos se calculan al abrir cada pantalla y no se guardan.
- La interfaz solo lee del repositorio y de esas funciones. El diseño es provisional: el rediseño tiene su propio plan.

**Tech Stack:** el de F1, sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md`, `docs/propuesta-ciclismo.html`. Interfaces de F1: `docs/superpowers/plans/2026-11-06-f0-f1-base-importacion-panel.md`.

**Requisito previo:** F1 completa (tareas 2 a 12).

## Global Constraints

- Las restricciones globales de F1 siguen vigentes: repositorio público sin claves, `HashRouter`, zona `Europe/Madrid`, unidades en SI con formato `es-ES`, textos en castellano sin emojis, CyclOSM con su atribución.
- Subida: tramo de ≥ 1.000 m con pendiente media ≥ 3 %.
- Misma subida en dos salidas: inicio con inicio y final con final, ambos a < 100 m.
- VAM en m/h = desnivel de la subida / tiempo transcurrido en la subida, en horas.
- Fixtures sintéticos: los tracks se generan en las pruebas con `tests/helpers/synth.ts`, sobre el mar (lat 41.0, lng 2.5). No entra ningún track real.
- Fuera de F2: la referencia de nivel (8 a 12 semanas) y las etiquetas Suave, Media y Dura, que van en F4.
- Skills: las de F1 (`karpathy-guidelines`, `superpowers:test-driven-development`, `react-best-practices`). Al cerrar: `code-simplifier`, `web-design-guidelines` y `break-ui`.

## Review Focus

1. **La misma subida abordada por caminos distintos** (desde un llano suave o tras una bajada) debe tener el mismo inicio. Lo cubre la tarea 1, prueba `start does not depend on the approach`.
2. **Ruido de altitud del GPS (±2 m)**: no inventa subidas ni parte una real. Lo cubre la tarea 1, prueba `noise of ±2 m does not split or invent climbs`.
3. **Una subida hecha dos veces en la misma salida**: cuenta como dos pasadas. Lo cubre la tarea 2, prueba `two passes in one ride count as two`.
4. **Salidas sin GPS o sin altitud** (rodillo, FIT sin altitud): sin subidas, sin ruta y sin errores; dos salidas de rodillo no son «la misma ruta». Lo cubren la tarea 1 (`track without elevation yields no climbs`), la tarea 3 (`empty cells never match`), la tarea 4 (`activity without track gets no analysis`) y la tarea 6 (`ride without track shows no map`).
5. **Más de 1.000 salidas importadas en F1 sin analizar**: se analizan por lotes, con progreso visible y sin congelar la pantalla. Lo cubren la tarea 4 (`reports progress in batches`) y la tarea 7 (`waits for analysis`).

## Lotes para develop-phase

Lote A, sin interfaz:

    Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f2-historial-repetidas.md', tasks: [
      { n: 1, agent: 'cycling-metrics-analyst' }, { n: 2, agent: 'cycling-metrics-analyst' },
      { n: 3, agent: 'cycling-metrics-analyst' }, { n: 4, agent: 'cycling-data-engineer' } ] } })

Lote B, pantallas y cierre:

    Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f2-historial-repetidas.md', ui: true, tasks: [
      { n: 5, agent: 'cycling-frontend-dev' }, { n: 6, agent: 'cycling-frontend-dev' },
      { n: 7, agent: 'cycling-frontend-dev' }, { n: 8, agent: 'cycling-frontend-dev' },
      { n: 9, agent: 'cycling-qa' } ] } })

---

## Estructura de ficheros

    src/metrics/climbs.ts             perfil suavizado y detección de subidas
    src/metrics/climbGroups.ts        misma subida en distintas salidas
    src/metrics/routes.ts             rejilla de celdas, similitud y rutas repetidas
    src/analysis/analysis.ts          analiza y guarda; recalcula lo pendiente
    src/db/db.ts  src/db/repo.ts      Dexie versión 2 y lecturas nuevas
    src/ui/pages/Historial.tsx  Salida.tsx  Subidas.tsx  Subida.tsx  Rutas.tsx  Ruta.tsx
    src/ui/components/RideMap.tsx  ElevationProfile.tsx   extraídos de LastRide
    src/ui/useAnalysis.ts             estado del análisis pendiente
    tests/helpers/synth.ts            generadores de tracks y GPX sintéticos
    e2e/historial.spec.ts

---

### Task 1: Perfil y detección de subidas

**Agente:** `cycling-metrics-analyst`

**Files:**
- Create: `src/metrics/climbs.ts`, `tests/helpers/synth.ts`
- Modify: `src/domain/types.ts`
- Test: `tests/climbs.test.ts`

**Interfaces:**
- Consumes: `TrackPoint`, `LatLng`, `haversineM(lat1, lng1, lat2, lng2): number` de `src/import/summary.ts`
- Produces:
  - constantes `CLIMB_MIN_LENGTH_M = 1000`, `CLIMB_MIN_GRADE_PCT = 3`, `CLIMB_SPLIT_DROP_M = 10`, `SMOOTH_WINDOW_M = 100`, `TRIM_WINDOW_M = 50`
  - `type ProfilePoint = { i: number /* índice en el track */; distM: number; ele: number /* suavizada */; t: number; lat: number; lng: number }`
  - `buildProfile(points: TrackPoint[]): ProfilePoint[]`: solo los puntos con lat, lng y ele; distancia acumulada por haversine; `ele` es la media de los puntos a ±50 m de distancia.
  - `type DetectedClimb = { startIdx: number; endIdx: number; start: LatLng; end: LatLng; startDistM: number; lengthM: number; gainM: number; avgGradePct: number; timeS: number; avgSpeedMs: number; vamMh: number }`. `startIdx` y `endIdx` son índices en `points`.
  - `detectClimbs(points: TrackPoint[]): DetectedClimb[]`, ordenadas por `startDistM`
  - en `tests/helpers/synth.ts`: `synthClimbTrack(segments: { lengthM: number; gradePct: number; speedMs?: number }[], opts?: { noiseM?: number }): TrackPoint[]`. Un punto cada 15 m hacia el norte desde (41.0, 2.5), con altitud inicial de 100 m y `t` desde 2026-01-04T08:00:00Z. `speedMs` vale 5 por defecto. El ruido del punto i es `noiseM * Math.sin(i * 1.7)`.

- [ ] **Step 1: pruebas que fallan**
  - `detects 2 km at 5 %`: con `[{1000,0},{2000,5},{1000,0}]` sale 1 subida, con `lengthM` 2000 ± 60, `avgGradePct` 5 ± 0,3 y `startDistM` 1000 ± 60.
  - `ignores 800 m at 8 %`: da `[]`.
  - `ignores 3 km at 2 %`: da `[]`.
  - `short dip does not split`: `[{1000,6},{100,-3},{1000,6}]` da 1 subida con `lengthM` ≥ 1950.
  - `drop over 10 m splits`: `[{1200,6},{500,-5},{1200,6}]` da 2 subidas.
  - `start does not depend on the approach`: A = `[{2000,1},{2000,6}]` y B = `[{1000,-4},{2000,6}]`, con `|(A.startDistM − 2000) − (B.startDistM − 1000)| < 50`.
  - `noise of ±2 m does not split or invent climbs`: `[{3000,0},{2000,5},{3000,0}]` con `noiseM: 2` da exactamente 1 subida.
  - `time speed and vam`: `[{1000,0},{2000,5,speedMs:10/3},{1000,0}]` da `timeS` 600 ± 20, `avgSpeedMs` 3,33 ± 0,1 y `vamMh` 600 ± 30.
  - `track without elevation yields no climbs`.
  - `climb at the very end of the track is detected`: `[{1000,0},{1500,6}]` da 1 subida.
- [ ] **Step 2:** `npx vitest run tests/climbs.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar `buildProfile` y `detectClimbs` con este algoritmo, sobre el perfil `p`:

      s = k = 0                                   // s: valle; k: cima desde s
      para j en 1..n-1:
        si p[j].ele < p[s].ele y p[k].ele - p[s].ele < CLIMB_SPLIT_DROP_M: s = k = j
        si no, si p[j].ele > p[k].ele: k = j
        si no, si p[k].ele - p[j].ele > CLIMB_SPLIT_DROP_M: candidato [s,k]; s = k = j
      al acabar: candidato [s,k]
      para cada candidato:
        avanzar s mientras la pendiente de los TRIM_WINDOW_M siguientes sea < CLIMB_MIN_GRADE_PCT
        retroceder k mientras la pendiente de los TRIM_WINDOW_M anteriores sea < CLIMB_MIN_GRADE_PCT
        se queda si lengthM ≥ CLIMB_MIN_LENGTH_M y avgGradePct ≥ CLIMB_MIN_GRADE_PCT
      gainM = p[k].ele - p[s].ele; timeS = (p[k].t - p[s].t) / 1000
      avgSpeedMs = lengthM / timeS; vamMh = gainM / (timeS / 3600)
      startIdx = p[s].i; endIdx = p[k].i

- [ ] **Step 4:** `npx vitest run tests/climbs.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 2: Misma subida en distintas salidas

**Agente:** `cycling-metrics-analyst`

**Files:**
- Create: `src/metrics/climbGroups.ts`
- Modify: `src/domain/types.ts`
- Test: `tests/climbGroups.test.ts`

**Interfaces:**
- Consumes: `DetectedClimb`, `haversineM`
- Produces:
  - `SAME_CLIMB_MAX_M = 100`
  - `type ClimbEffort = DetectedClimb & { id: string /* `${activityId}_${n}` */; activityId: string; activityStart: number }`
  - `sameClimb(a: Pick<ClimbEffort, 'start' | 'end'>, b: Pick<ClimbEffort, 'start' | 'end'>): boolean`: inicio con inicio y final con final, los dos a < 100 m.
  - `type ClimbGroup = { id: string; start: LatLng; end: LatLng; lengthM: number; avgGradePct: number; efforts: ClimbEffort[] /* por activityStart ascendente */; best: ClimbEffort /* menor timeS */ }`
  - `groupClimbs(efforts: ClimbEffort[]): ClimbGroup[]`

- [ ] **Step 1: pruebas que fallan.** Los esfuerzos se construyen en la prueba, con desplazamientos en metros (1 m ≈ 1/111320° de latitud).
  - `same climb within 100 m groups`: inicio desplazado 60 m y final 80 m da 1 grupo con 2 esfuerzos.
  - `120 m away is a different climb`: da 2 grupos.
  - `matching end only is not enough`: el mismo final con el inicio a 300 m da 2 grupos.
  - `two passes in one ride count as two`: dos esfuerzos de la misma `activityId` dan 1 grupo con 2 esfuerzos.
  - `best is the fastest`.
  - `group id is the earliest effort id`, aunque la entrada venga desordenada.
  - `sorted by number of passes`: un grupo de 3 va antes que uno de 1.
- [ ] **Step 2:** `npx vitest run tests/climbGroups.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Se ordena por `activityStart` y después por `startDistM`. Cada esfuerzo entra en el primer grupo cuyo representante (su primer esfuerzo) cumple `sameClimb`; si no hay ninguno, abre grupo. `id`, `start`, `end`, `lengthM` y `avgGradePct` son los del representante. Los candidatos se buscan con un índice por celda de 200 m del inicio (`cellKey` de la tarea 3 aún no existe; usar un `Map` local con la misma idea). Resultado: por número de pasadas descendente y después por la última pasada descendente.
- [ ] **Step 4:** `npx vitest run tests/climbGroups.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 3: Rutas repetidas por similitud del trazado

**Agente:** `cycling-metrics-analyst`

**Files:**
- Create: `src/metrics/routes.ts`
- Modify: `src/domain/types.ts`, `tests/helpers/synth.ts`
- Test: `tests/routes.test.ts`

**Interfaces:**
- Consumes: `TrackPoint`, `LatLng`
- Produces:
  - `ROUTE_CELL_M = 200`, `SAME_ROUTE_MIN_SIMILARITY = 0.6`, `SAME_ROUTE_MAX_DIST_DIFF = 0.2`
  - `cellKey(lat: number, lng: number, sizeM = ROUTE_CELL_M): string`, que devuelve `` `${row}:${col}` ``, con `row = floor(lat·111320/sizeM)` y `col = floor(lng·111320·cos(latCentroFila)/sizeM)`. F4 la reutiliza para la carretera nueva.
  - `type RouteSig = { activityId: string; activityStart: number; distanceM: number; cells: string[] /* sin repetidos */ }`
  - `routeCells(points: TrackPoint[]): string[]`
  - `routeSimilarity(a: string[], b: string[]): number`: Jaccard; con dos conjuntos vacíos vale 0.
  - `type RouteGroup = { id: string /* activityId del representante */; activityIds: string[] /* por activityStart ascendente */ }`
  - `groupRoutes(sigs: RouteSig[]): RouteGroup[]`: solo los grupos de 2 o más salidas, por tamaño descendente.
  - en `tests/helpers/synth.ts`: `synthPath(vertices: LatLng[], opts?: { offsetM?: number; startTime?: number; speedMs?: number }): TrackPoint[]`. Un punto cada 15 m a lo largo de la poligonal, desplazado `offsetM` hacia el este, con altitud constante de 100 m.

- [ ] **Step 1: pruebas que fallan.** El lazo es un cuadrado de 5 km de lado desde (41.0, 2.5): norte, este, sur, oeste.
  - `same loop with 10 m gps offset is same route`: `routeSimilarity` ≥ 0,8, y `groupRoutes` da 1 grupo de 2.
  - `reverse direction is same route`: con los vértices al revés, `routeSimilarity` = 1.
  - `mirrored loop sharing one side is different`: el cuadrado hacia el oeste da `routeSimilarity` < 0,6.
  - `distance 25 % longer is different`: dos firmas con las mismas celdas y `distanceM` 40.000 y 50.000 dan `[]`.
  - `single rides are not groups`: tres lazos distintos dan `[]`.
  - `empty cells never match`: dos firmas con `cells: []` y la misma distancia dan `[]`.
- [ ] **Step 2:** `npx vitest run tests/routes.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Voraz, como `groupClimbs`, con la primera salida del grupo como representante. Solo se compara si `|Δdistancia|` ≤ 20 % de la mayor: con la lista ordenada por distancia, los candidatos se descartan sin calcular la similitud. Mismo grupo si la similitud es ≥ 0,6.
- [ ] **Step 4:** `npx vitest run tests/routes.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 4: Análisis guardado

**Agente:** `cycling-data-engineer`

**Files:**
- Create: `src/analysis/analysis.ts`
- Modify: `src/db/db.ts`, `src/db/repo.ts`, `src/import/importService.ts`, `tests/helpers/synth.ts`
- Test: `tests/analysis.test.ts`

**Interfaces:**
- Consumes: `detectClimbs`, `ClimbEffort`, `routeCells`, `RouteSig`, `getTrack`, `listActivities`, `saveActivity`, `importFiles`
- Produces:
  - Dexie `version(2)`: añade `climbEfforts: 'id, activityId'` y `routeSigs: 'activityId, distanceM'`. Las tablas de la versión 1 no cambian.
  - `ANALYSIS_VERSION = 1`
  - `type RouteSigRow = RouteSig & { analysisVersion: number }`
  - `analyzeActivity(a: StoredActivity, points: TrackPoint[]): { efforts: ClimbEffort[]; sig: RouteSigRow }`
  - `saveAnalysis(r: { efforts: ClimbEffort[]; sig: RouteSigRow }): Promise<void>`: en una transacción, borra los esfuerzos de esa salida y escribe los nuevos y la firma.
  - `ensureAnalysis(onProgress?: (done: number, total: number) => void): Promise<number>`: analiza las salidas con `hasTrack` que no tienen fila en `routeSigs` o la tienen con `analysisVersion` < `ANALYSIS_VERSION`. Va en lotes de 50 y cede el hilo entre lotes. Devuelve cuántas analizó.
  - repo: `getActivity(id: string): Promise<StoredActivity | undefined>`, `listClimbEfforts(): Promise<ClimbEffort[]>`, `listRouteSigs(): Promise<RouteSig[]>`
  - `importFiles` analiza y guarda cada salida nueva con track justo después de `saveActivity`.
  - en `tests/helpers/synth.ts`: `toGpx(points: TrackPoint[], name?: string): string`, con `<type>cycling</type>`, `<ele>` y `<time>`.

- [ ] **Step 1: pruebas que fallan**, con fake-indexeddb:
  - `migrates v1 database keeping activities`: se crea `ciclismo` con el esquema de la versión 1 de F1 y una actividad, y se cierra. Al abrir `CyclingDb`, la actividad sigue y `climbEfforts` está vacía.
  - `import stores efforts and route signature`: `importFiles([new File([toGpx(synthClimbTrack([{1000,0},{2000,5}]))], 'subida.gpx')])` deja 1 fila en `climbEfforts` con la `activityId` de la salida y 1 en `routeSigs`.
  - `activity without track gets no analysis`: una salida con `hasTrack: false` hace que `ensureAnalysis()` devuelva 0 y deja las dos tablas vacías.
  - `ensureAnalysis analyzes only missing or outdated`: de 3 salidas con track, una analizada con la versión actual y otra con `analysisVersion: 0`, devuelve 2.
  - `reports progress in batches`: con 120 salidas sin analizar, `onProgress` recibe (50, 120), (100, 120) y (120, 120).
  - `reanalysis replaces efforts`: `saveAnalysis` dos veces con el mismo resultado no duplica esfuerzos.
- [ ] **Step 2:** `npx vitest run tests/analysis.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. El Worker no cambia, porque el análisis va dentro de `importFiles`.
- [ ] **Step 4:** `npx vitest run tests/analysis.test.ts tests/importService.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 5: Historial

**Agente:** `cycling-frontend-dev`

**Files:**
- Create: `src/ui/pages/Historial.tsx`
- Modify: `src/App.tsx`
- Test: `tests/historial.test.tsx`

**Interfaces:**
- Consumes: `listActivities`, `formatKm`, `formatMeters`, `formatDuration`, `formatSpeed`, `TZ`
- Produces: ruta `#/historial` y enlace «Historial» en el menú, justo después de «Inicio».

- [ ] **Step 1: pruebas que fallan**, con un repositorio sembrado:
  - `sidebar links to historial`.
  - `lists rides newest first`. Cada fila lleva fecha (`EEE d MMM yyyy`, en Madrid, por ejemplo «dom 4 ene 2026»), nombre, km con un decimal, desnivel, tiempo y velocidad.
  - `shows 50 and loads more`: con 120 salidas hay 50 filas; «Mostrar más» lleva a 100 y después a 120, y entonces el botón desaparece.
  - `row links to detail`: el enlace es `#/historial/<encodeURIComponent(id)>`.
  - `untitled ride shows fallback`: «Salida sin nombre».
  - `ride without gps is tagged`: «Sin GPS».
  - `empty state invites import`: «Aún no hay salidas», con un enlace a `#/importar`.
- [ ] **Step 2:** `npx vitest run tests/historial.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar con el título «Historial».
- [ ] **Step 4:** `npx vitest run tests/historial.test.tsx tests/app.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 6: Detalle de una salida

**Agente:** `cycling-frontend-dev`

**Files:**
- Create: `src/ui/pages/Salida.tsx`, `src/ui/components/RideMap.tsx`, `src/ui/components/ElevationProfile.tsx`, `src/ui/useAnalysis.ts`
- Modify: `src/ui/components/LastRide.tsx` (usa los dos componentes extraídos), `src/ui/format.ts`, `src/App.tsx`
- Test: `tests/salida.test.tsx`, `tests/format.test.ts`

**Interfaces:**
- Consumes: `getActivity`, `getTrack`, `listClimbEfforts`, `groupClimbs`, `listRouteSigs`, `groupRoutes`, `buildProfile`, `ensureAnalysis`
- Produces:
  - ruta `#/historial/:id`
  - `RideMap({ points, label }: { points: LatLng[]; label: string })`: CyclOSM con la polilínea; `label` va en el `aria-label` de la región.
  - `ElevationProfile({ points, climbs }: { points: TrackPoint[]; climbs?: { startDistM: number; lengthM: number }[] })`: SVG con el eje x en la distancia de `buildProfile` y los tramos de subida sombreados. El `aria-label` es «Perfil de altitud: …».
  - `useAnalysis(): { status: 'running'; done: number; total: number } | { status: 'ready' } | { status: 'error' }`. Llama a `ensureAnalysis` una sola vez por carga de la app, con la promesa guardada a nivel de módulo.
  - `formatVam(mh: number): string` («712 m/h»), `formatGrade(pct: number): string` («5,1 %»), `formatClimb(lengthM: number, gradePct: number): string` («2,0 km al 5,0 %»)

- [ ] **Step 1: pruebas que fallan**
  - `format.test.ts`: `formatClimb(2000, 5)` da «2,0 km al 5,0 %»; `formatVam(712.4)` da «712 m/h»; `formatVam(1240)` da «1.240 m/h».
  - `shows stats map and profile`: una región «Mapa de la salida» y una imagen cuyo nombre empieza por «Perfil de altitud».
  - `ride without track shows no map`: «Esta salida no tiene GPS, así que no tiene mapa.», sin sección de subidas.
  - `lists climbs with time speed and vam`: un esfuerzo de 2.000 m al 5 % en 600 s muestra «2,0 km al 5,0 %», «10 min», «12,0 km/h» y «600 m/h», bajo el encabezado «Subidas de esta salida».
  - `climb links to its passes`: en un grupo de 2 se ve «2 pasadas», con enlace a `#/subidas/<id del grupo>`.
  - `no climbs message`: «Esta salida no tiene subidas de 1 km o más al 3 %.»
  - `links to repeated route`: en un grupo de 3 se ve «Has hecho esta ruta 3 veces», con enlace a `#/rutas/<id del grupo>`.
  - `unknown id shows not found`: «No se encuentra la salida», con enlace a `#/historial`.
  - `shows analysis progress`: con `useAnalysis` en `running` 3/10 se ve «Analizando salidas: 3 de 10».
- [ ] **Step 2:** `npx vitest run tests/salida.test.tsx tests/format.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Las cifras de la salida reutilizan las de `LastRide`, con pulso y potencia solo si hay datos.
- [ ] **Step 4:** `npx vitest run tests/salida.test.tsx tests/format.test.ts tests/inicio.test.tsx`. Esperado: PASS; Inicio no se rompe.
- [ ] **Step 5:** commit, previa confirmación.

### Task 7: Subidas

**Agente:** `cycling-frontend-dev`

**Files:**
- Create: `src/ui/pages/Subidas.tsx`, `src/ui/pages/Subida.tsx`
- Modify: `src/App.tsx`
- Test: `tests/subidas.test.tsx`

**Interfaces:**
- Consumes: `listClimbEfforts`, `groupClimbs`, `getTrack`, `useAnalysis`, `RideMap`, `formatClimb`, `formatVam`
- Produces: rutas `#/subidas` y `#/subidas/:id`, y el enlace «Subidas» en el menú, después de «Historial».

- [ ] **Step 1: pruebas que fallan**
  - `lists climbs with pass count`: con 3 esfuerzos de una subida y 1 de otra, las filas muestran «3 pasadas» y «1 pasada», en ese orden. Cada fila lleva «2,0 km al 5,0 %», el mejor tiempo, la mejor VAM y la fecha de la última vez.
  - `climb page shows all passes`: 3 filas, de la más reciente a la más antigua. La más rápida lleva «Mejor». Cada fila muestra la fecha, el tiempo, la velocidad y la VAM. El título es «Subida de 2,0 km al 5,0 %».
  - `pass links to its ride`: `#/historial/<activityId>`.
  - `unknown climb shows not found`: «No se encuentra la subida».
  - `empty state`: «Aún no hay subidas detectadas».
  - `waits for analysis`: en `running` 3/10 se ve «Analizando salidas: 3 de 10».
- [ ] **Step 2:** `npx vitest run tests/subidas.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar. En el detalle, el mapa pinta el tramo `startIdx..endIdx` del track del representante.
- [ ] **Step 4:** `npx vitest run tests/subidas.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 8: Rutas repetidas

**Agente:** `cycling-frontend-dev`

**Files:**
- Create: `src/ui/pages/Rutas.tsx`, `src/ui/pages/Ruta.tsx`
- Modify: `src/App.tsx`
- Test: `tests/rutas.test.tsx`

**Interfaces:**
- Consumes: `listRouteSigs`, `groupRoutes`, `listActivities`, `getTrack`, `useAnalysis`, `RideMap`
- Produces: rutas `#/rutas` y `#/rutas/:id`, y el enlace «Rutas» en el menú, entre «Historial» y «Subidas», como en la maqueta.

- [ ] **Step 1: pruebas que fallan**
  - `lists repeated routes`: un grupo de 3 muestra «3 veces», el nombre de la salida más reciente («Ruta sin nombre» si no tiene), la distancia y el desnivel del representante, el mejor tiempo y la última vez.
  - `route page lists all rides with best marked`: una fila por salida, con fecha (que enlaza a la salida), tiempo, velocidad media y desnivel. La de menor `movingTimeS` lleva «Mejor».
  - `empty state`: «Aún no has repetido ninguna ruta».
  - `unknown route shows not found`: «No se encuentra la ruta».
  - `waits for analysis`.
- [ ] **Step 2:** `npx vitest run tests/rutas.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar. El mapa del detalle pinta el track del representante.
- [ ] **Step 4:** `npx vitest run tests/rutas.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 9: Extremo a extremo y cierre de fase

**Agente:** `cycling-qa`

**Files:**
- Create: `e2e/historial.spec.ts`
- Modify: `docs/verificaciones.md`

- [ ] **Step 1:** pruebas con dos GPX generados dentro de la prueba con `synthClimbTrack([{1000,0},{2000,5},{1000,0}])` y `toGpx`, con fechas 2026-01-04 y 2026-01-11. Se suben como buffers en `#/importar`.
  - `repeated climb shows all passes`: `#/subidas` muestra «2 pasadas»; al hacer clic se ven 2 filas.
  - `ride detail shows map and climbs`: desde `#/historial`, al hacer clic en la primera salida se ven la región «Mapa de la salida» y un texto que contiene «km al».
  - `repeated route`: `#/rutas` muestra «2 veces».
- [ ] **Step 2:** `npx vitest run && npx tsc --noEmit && npm run build && npx playwright test`. Esperado: todo PASS.
- [ ] **Step 3:** pasar `code-simplifier` sobre los ficheros de F2 y repetir el paso 2.
- [ ] **Step 4:** pasar `web-design-guidelines` y `break-ui` sobre Historial, Salida, Subidas y Rutas, con 5.000 salidas, un nombre larguísimo, una subida con 300 pasadas, una salida de 400 km y una salida sin GPS. Se corrige lo que rompe el uso; lo visual queda para el rediseño.
- [ ] **Step 5:** comprobación manual con el archivo real, en el navegador del usuario. Elegir una subida conocida: las pasadas detectadas deben ser las reales, y la longitud y la pendiente deben coincidir con el segmento de Strava a ± 10 %. Anotarlo en `docs/verificaciones.md`, sin coordenadas.
- [ ] **Step 6:** revisión final con `feature-dev:code-reviewer` y commit de cierre de F2, previa confirmación.
