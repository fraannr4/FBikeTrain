# F4: generador de rutas sin IA. Plan de implementación

> **Prioridad móvil (2026-11-07).** Rige `docs/requisito-mobile-first.md`. Las pantallas de este plan se implementan siguiendo el prototipo móvil `docs/design/prototipo-movil/` (README, kit `movil.css`/`movil.js` y la página correspondiente), que prevalece sobre las descripciones de interfaz de este plan si chocan. La lógica, las interfaces y las pruebas del plan siguen vigentes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** en una pantalla «Rutas», el usuario elige el inicio (Casa u otro punto en el mapa), una distancia y, si quiere, un desnivel, y recibe de 3 a 5 rutas circulares de carretera asfaltada. Cada una tiene su forma, su perfil coloreado por pendiente, su etiqueta Suave, Media o Dura, su porcentaje de carretera nueva y un botón para descargar el GPX que abre la app de iGPSPORT.

**Architecture:**
- El navegador llama directamente a OpenRouteService (`POST /v2/directions/cycling-road/geojson`) con la clave del usuario. No hay Worker de reenvío: la tarea 1 de F0 comprobó que ORS admite el preflight CORS, y la tarea 1 de este plan confirma la respuesta 200.
- Cada búsqueda pide varias candidatas `round_trip` con semillas distintas. El código las analiza (asfalto, tipo de vía, pendiente), descarta las que no son de carretera, las puntúa contra el objetivo y contra una rejilla de celdas de 200 m del historial, y se queda con las mejores.
- Las funciones de análisis, puntuación, referencia y GPX son puras. La interfaz solo llama a `generateRoutes` y pinta el resultado.

**Tech Stack:** el de F1 (Vite 5, React 18, TypeScript 5 strict, Dexie 4, ECharts 5, Leaflet 1.9 con CyclOSM, `@xmldom/xmldom`, Vitest, Playwright). Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md` (decisiones 5, 8, 9, 11 y 13), `docs/verificaciones.md`

## Datos verificados en la documentación (2026-11-06)

| Dato | Valor | Fuente |
|---|---|---|
| Opciones de vuelta circular | `options.round_trip.length` (metros, valor preferido: el resultado puede variar), `points` (entero; más puntos, ruta más circular), `seed` (entero, opcional, cambia la dirección). Sin mínimos ni máximos publicados. La documentación titula la sección `round-trip`, pero las peticiones reales del foro usan la clave `round_trip`; la tarea 1 lo confirma. | https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options , https://ask.openrouteservice.org/t/description-of-round-trip-feature/4170 |
| `avoid_features` para `cycling-*` | `ferries`, `fords`, `steps` | routing-options (misma URL) |
| `extra_info` | se piden `surface`, `waytype`, `steepness`. En la respuesta, `waytype` vuelve como **`waytypes`**. Cada entrada trae `values: [desde, hasta, valor][]` (índices de punto) y `summary: { value, distance, amount }[]` (`amount` en %). | https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/ |
| Superficie | 0 Unknown, 1 Paved, 2 Unpaved, 3 Asphalt, 4 Concrete, 5 Cobblestone, 6 Metal, 7 Wood, 8 Compacted Gravel, 9 Fine Gravel, 10 Gravel, 11 Dirt, 12 Ground, 13 Ice, 14 Paving Stones, 15 Sand, 16 Woodchips, 17 Grass, 18 Grass Paver | .../extra-info/surface |
| Tipo de vía | 0 Unknown, 1 State Road (`motorway`, `trunk`, `primary` y sus `_link`), 2 Road (`secondary`, `tertiary`, `unclassified`, `road`), 3 Street, 4 Path, 5 Track, 6 Cycleway, 7 Footway, 8 Steps, 9 Ferry, 10 Construction | .../extra-info/waytype |
| Pendiente | −5 (≥ 16 % bajada) … 0 (0 a < 1 %) … 1 (1–4 %), 2 (4–7 %), 3 (7–10 %), 4 (10–16 %), 5 (≥ 16 %) | .../extra-info/steepness |
| Formato GeoJSON | `FeatureCollection`; cada ruta es un `Feature` con `LineString` y `properties` (`summary`, `segments`, `way_points`, `extras`). Con `elevation: true` la coordenada es `[lng, lat, ele]` (lo confirma la tarea 1). | https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types |
| Cuota del plan Standard (gratuito) | Directions: 2.000 al día y 40 por minuto. El día se reinicia 24 h después de la primera petición; el minuto es una ventana deslizante. Día agotado: `403`; minuto agotado: `429`. Cabeceras `x-ratelimit-remaining` y `x-ratelimit-reset`. | https://giscience.github.io/openrouteservice/frequently-asked-questions , https://openrouteservice.org/plans/ |
| Códigos de error | `404` sin resultados; `2004` límite superado; `2009` sin ruta; `2010` punto no encontrado. | https://giscience.github.io/openrouteservice/api-reference/error-codes |
| CORS | El `403` de ORS llega sin `access-control-allow-origin`: en el navegador, una clave mala o el día agotado se ven como `TypeError` de red. | `docs/verificaciones.md`, paso 5 |

## Global Constraints

- Las de F1 siguen vigentes: repositorio público, ninguna clave en código, fixtures ni historial; textos en castellano sin emojis; unidades SI por dentro y formato `es-ES` al mostrar; CyclOSM con su atribución; `HashRouter`.
- Las pruebas nunca hacen llamadas reales: `fetch` se inyecta o se simula. Los fixtures de ORS se graban una vez en la tarea 1 desde un punto público (Puerta del Sol, Madrid: lat 40.4168, lng −3.7038), nunca desde Casa, y con la clave fuera del fichero.
- Endpoint: `POST https://api.openrouteservice.org/v2/directions/cycling-road/geojson`, cabeceras `Authorization: <clave>` y `Content-Type: application/json`.
- Cuerpo fijo de cada petición: `coordinates: [[lng, lat]]`, `elevation: true`, `instructions: false`, `extra_info: ['surface', 'waytype', 'steepness']`, `options: { round_trip: { length, points, seed }, avoid_features: ['ferries', 'fords', 'steps'] }`.
- Cuota: `ORS_DAILY_LIMIT = 2000`, `ORS_MINUTE_LIMIT = 40`. Las peticiones de una búsqueda van una detrás de otra, nunca en paralelo.
- Filtro de carretera (valores fijos de este plan): sin asfaltar ≤ 100 m; `Track` ≤ 100 m; `State Road` ≤ 20 % de la distancia; distancia real dentro de ±25 % del objetivo.
- Rejilla del historial: celdas de 200 m. Las celdas nunca salen del navegador.
- Referencia del usuario: ventana de 8 semanas si tiene ≥ 5 salidas; si no, 12 semanas; si sigue sin llegar a 5, no hay referencia.
- Etiquetas: con `ratio = max(distancia / media, desnivel / media)`, Suave si `ratio < 0,85`, Media si `0,85 ≤ ratio ≤ 1,10`, Dura si `ratio > 1,10`.
- GPX 1.1 con `trk`, `trkseg`, `trkpt lat lon` y `ele`, sin `time`. Espacio de nombres `http://www.topografix.com/GPX/1/1`.
- Diseño visual provisional: tokens y estilos de F1; el rediseño tiene plan propio.
- Skills: `karpathy-guidelines` y `superpowers:test-driven-development` en todas; `react-best-practices` en componentes; `dataviz` en el perfil; `web-design-guidelines` y `break-ui` al cerrar.

## Review Focus

1. **Clave mala o cuota diaria agotada:** el navegador solo ve un error de red. El usuario debe leer un mensaje que nombre las tres causas posibles y, si el contador local ya llega a 2.000, que diga que se ha agotado la cuota. Tarea 2: `network error with usage >= 2000 maps to quota_day` y `network error maps to unreachable with combined message`.
2. **Inicio sin carreteras cerca (mar, monte, una finca):** ORS responde 404 con código 2009 o 2010. El usuario debe leer «Mueve el inicio a una carretera». Tarea 2: `404 with code 2010 maps to no_route`.
3. **Todas las candidatas descartadas** (zona de pistas, o solo nacionales): no debe quedar una pantalla vacía sin explicación. Tarea 7: `all rejected returns no routes with reasons`; tarea 8: `shows why no route passed`.
4. **Sin historial o con menos de 5 salidas:** sin rejilla, todo cuenta como carretera nueva (100 %), y sin referencia no hay etiqueta. Las tarjetas no deben romperse. Tarea 5: `empty history gives 100 % new`; tarea 8: `card without reference hides label`.
5. **Cuota por minuto:** una segunda búsqueda seguida puede pasar de 40 peticiones por minuto. Debe parar, conservar las rutas ya obtenidas y avisar. Tarea 7: `rate limit mid-search keeps partial routes`.

---

## Estructura de ficheros

```
src/routes/ors.ts           cliente ORS: cuerpo, llamada y errores
src/routes/orsUsage.ts      contador local de peticiones (tabla meta)
src/routes/analyze.ts       candidata ORS -> RouteCandidate, filtro de carretera
src/routes/gpx.ts           exportación GPX 1.1
src/routes/generator.ts     búsqueda completa: semillas, filtro, puntuación, top N
src/routes/history.ts       carga de la rejilla del historial desde el repositorio
src/metrics/reference.ts    referencia de 8-12 semanas y etiquetas
src/metrics/grid.ts         rejilla de 200 m y porcentaje de carretera nueva
src/metrics/score.ts        puntuación de candidatas
src/ui/pages/Rutas.tsx
src/ui/components/RouteForm.tsx  StartPointMap.tsx  RouteCard.tsx  RouteShape.tsx  SlopeProfile.tsx
tests/fixtures/ors/         respuestas grabadas en la tarea 1
tests/*.test.ts(x), e2e/rutas.spec.ts
```

---

### Task 1: Comprobaciones con el usuario y fixtures de ORS

Tarea manual, sin código de producción. La hace `cycling-routes-engineer` con el usuario. Las tareas 2, 3 y 7 dependen de sus fixtures.

**Files:**
- Create: `tests/fixtures/ors/round-trip-ok.json`, `tests/fixtures/ors/no-route-404.json`, `tests/fixtures/ors/README.md`
- Modify: `docs/verificaciones.md` (sección «F4. ORS con clave válida»)

**Interfaces:**
- Produces: los dos fixtures y estos hechos anotados: si el 200 trae `access-control-allow-origin`; si `access-control-expose-headers` incluye `x-ratelimit-remaining`; la clave real del parámetro (`round_trip`); la forma `[lng, lat, ele]`; el nombre de las claves de `extras` (`surface`, `waytypes`, `steepness`); el cuerpo de un 404.

- [ ] **Step 1:** el usuario abre la web en `npm run dev`, pega su clave ORS en Ajustes y, desde la consola del navegador, lanza un `fetch` con el cuerpo de Global Constraints, inicio en Puerta del Sol, `length: 30000`, `points: 4`, `seed: 1`. Guardar la respuesta en `round-trip-ok.json`. Recortar `coordinates` a lo sumo a 400 puntos si pasa de 200 KB, ajustando los índices de `extras` (anotarlo en el README).
- [ ] **Step 2:** repetir con un inicio en el mar (lat 40.0, lng 1.5) y guardar el 404 en `no-route-404.json`.
- [ ] **Step 3:** anotar en `docs/verificaciones.md` las cabeceras de la respuesta 200 (`access-control-allow-origin`, `access-control-expose-headers`, `x-ratelimit-*`) y los hechos de «Produces». Si `round_trip` no funciona y sí `round-trip`, corregir este plan antes del lote B.
- [ ] **Step 4:** el usuario importa en la app de iGPSPORT un GPX 1.1 de prueba (`tests/fixtures/route-sample.gpx`, creado a mano con 10 puntos en el mar) y anota si lo acepta y cómo se llama el menú. El BSC200S no hace falta: la ruta llega al aparato por la app.
- [ ] **Step 5:** comprobar con `git diff` que ningún fichero contiene la clave. Commit, previa confirmación.

### Task 2: Cliente ORS y errores de cuota

Agente: `cycling-routes-engineer`.

**Files:**
- Create: `src/routes/ors.ts`, `src/routes/orsUsage.ts`
- Test: `tests/ors.test.ts`, `tests/orsUsage.test.ts`

**Interfaces:**
- Consumes: `LatLng`, `db` (tabla `meta`), fixtures de la tarea 1
- Produces:
  - `type RoundTripRequest = { start: LatLng; lengthM: number; points: number; seed: number }`
  - `type OrsExtra = { values: [number, number, number][]; summary: { value: number; distance: number; amount: number }[] }`
  - `type OrsFeature = { geometry: { type: 'LineString'; coordinates: [number, number, number][] }; properties: { summary: { distance: number; duration: number; ascent?: number; descent?: number }; extras: { surface: OrsExtra; waytypes: OrsExtra; steepness: OrsExtra } } }`
  - `buildRoundTripBody(r: RoundTripRequest): object`
  - `fetchRoundTrip(apiKey: string, r: RoundTripRequest, fetchImpl?: typeof fetch): Promise<OrsFeature>`
  - `type OrsErrorKind = 'unreachable' | 'quota_day' | 'rate_minute' | 'no_route' | 'bad_request' | 'server'`
  - `class OrsError extends Error { constructor(public kind: OrsErrorKind, message: string, public code?: number) }`. `message` es el texto que ve el usuario.
  - `ORS_DAILY_LIMIT = 2000`, `ORS_MINUTE_LIMIT = 40`
  - `recordOrsCall(now: number): Promise<void>`, `getOrsUsage(now: number): Promise<{ count: number; windowStart: number }>`. La ventana dura 24 h desde la primera petición, como en la FAQ de ORS.

- [ ] **Step 1: pruebas que fallan**
  - `body uses lng,lat order and fixed options`: `buildRoundTripBody({ start: { lat: 40.4168, lng: -3.7038 }, lengthM: 30000, points: 4, seed: 7 })` es igual al objeto de Global Constraints con `coordinates: [[-3.7038, 40.4168]]` y `options.round_trip` igual a `{ length: 30000, points: 4, seed: 7 }`.
  - `posts to cycling-road geojson with key header`: el `fetch` simulado recibe la URL del endpoint, `method: 'POST'` y `headers.Authorization === 'test-key'`.
  - `parses fixture into feature`: con `round-trip-ok.json`, `coordinates[0].length === 3` y `extras.waytypes.summary` es un array.
  - `404 with code 2010 maps to no_route`: con `no-route-404.json`, lanza `OrsError` con `kind 'no_route'` y el mensaje «ORS no encuentra carreteras desde ese punto. Mueve el inicio a una carretera.».
  - `429 maps to rate_minute`: mensaje «Has pasado de 40 consultas por minuto en ORS. Espera un minuto y vuelve a probar.».
  - `403 maps to quota_day`: mensaje «Has gastado las 2.000 consultas diarias de ORS. La cuota se renueva 24 h después de la primera consulta del día.».
  - `network error maps to unreachable with combined message`: un `TypeError` con el uso en 10 da `kind 'unreachable'` y «ORS no responde. Puede ser la clave, la cuota diaria (2.000 consultas) o la conexión. Comprueba la clave en Ajustes.».
  - `network error with usage >= 2000 maps to quota_day`.
  - `400 keeps ors code and message`: cuerpo `{ error: { code: 2003, message: 'x' } }` da `kind 'bad_request'`, `code 2003`.
  - `orsUsage.test.ts`: `counts calls in 24h window`, `resets after 24h from first call`.
- [ ] **Step 2:** `npx vitest run tests/ors.test.ts tests/orsUsage.test.ts`. Esperado: FAIL, módulos inexistentes.
- [ ] **Step 3:** implementar. `fetchRoundTrip` registra la llamada con `recordOrsCall` antes de enviarla, toma la primera `Feature` de la colección y lee `error.code` del cuerpo cuando lo hay. El uso se guarda en `meta` con la clave `orsUsage`.
- [ ] **Step 4:** `npx vitest run tests/ors.test.ts tests/orsUsage.test.ts` y `npx tsc --noEmit`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 3: Análisis de candidatas y filtro de carretera

Agente: `cycling-routes-engineer`.

**Files:**
- Create: `src/routes/analyze.ts`
- Test: `tests/analyze.test.ts`

**Interfaces:**
- Consumes: `OrsFeature`, `haversineM` y `ELEVATION_HYSTERESIS_M` de `src/import/summary.ts` (no se modifica ese fichero)
- Produces:
  - `type Coord3 = [lng: number, lat: number, ele: number]`
  - `type SteepSegment = { fromM: number; toM: number; cls: number }` (`cls` de −5 a 5)
  - `type RouteCandidate = { id: string; seed: number; coords: Coord3[]; distanceM: number; elevGainM: number; unpavedM: number; trackM: number; mainRoadPct: number; unknownSurfacePct: number; steep: SteepSegment[]; profile: { dM: number; ele: number }[]; maxSteepCls: number }`
  - `UNPAVED_SURFACES: ReadonlySet<number>` = {2, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18}
  - `ROAD_FILTER = { maxUnpavedM: 100, maxTrackM: 100, maxMainRoadPct: 20, lengthTolerance: 0.25 }`
  - `analyzeRoute(f: OrsFeature, seed: number): RouteCandidate`
  - `type RejectReason = 'sin asfaltar' | 'pistas' | 'carretera principal' | 'longitud'`
  - `rejectReason(c: RouteCandidate, targetM: number): RejectReason | null`

- [ ] **Step 1: pruebas que fallan**, con features sintéticas pequeñas y con el fixture real:
  - `distance and gain computed from coords`: tres puntos a 0,009° de latitud con alturas 100, 104 y 108 dan `distanceM` ≈ 2000 ± 10 y `elevGainM` = 8.
  - `unpaved meters from surface summary`: resumen `{ value: 10, distance: 150 }` da `unpavedM` = 150 y `rejectReason` = `'sin asfaltar'`.
  - `cobblestone and unknown are not unpaved`: valores 5 y 0 dan `unpavedM` = 0; el 0 suma a `unknownSurfacePct`.
  - `state road over 20 % rejected`: `waytypes` con `value 1, amount 25` da `'carretera principal'`; con `amount 20`, `null`.
  - `track over 100 m rejected as pistas`.
  - `rejects candidate 30% longer than target`: `distanceM` 39.000 con objetivo 30.000 da `'longitud'`.
  - `steep segments map point indices to meters`: `values [[0, 1, 0], [1, 2, 3]]` da dos tramos con `fromM` y `toM` acumulados y `maxSteepCls` = 3.
  - `fixture analyzes without NaN`: con `round-trip-ok.json`, todos los números son finitos y `profile.length === coords.length`.
- [ ] **Step 2:** `npx vitest run tests/analyze.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Distancia y desnivel salen de `coords` (haversine e histéresis de 3 m), no de `summary`, para medir igual que el historial. `mainRoadPct` y `trackM` salen del `summary` de `waytypes`; `unpavedM`, del de `surface`. `id` = `` `${seed}-${Math.round(distanceM)}` ``.
- [ ] **Step 4:** `npx vitest run tests/analyze.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 4: Referencia del usuario y etiquetas Suave, Media y Dura

Agente: `cycling-metrics-analyst`. El plan de F2 no las incluye, así que van aquí.

**Files:**
- Create: `src/metrics/reference.ts`
- Test: `tests/reference.test.ts`

**Interfaces:**
- Consumes: `StoredActivity`
- Produces:
  - `type UserReference = { source: 'history' | 'declared'; weeks: 8 | 12 | null; rides: number; ridesPerWeek: number; avgDistanceM: number; avgElevGainM: number; avgMovingTimeS: number; avgSpeedMs: number; longestDistanceM: number; maxElevGainM: number }`
  - `MIN_RIDES = 5`
  - `computeReference(acts: StoredActivity[], now: number): UserReference | null`
  - `type Difficulty = 'Suave' | 'Media' | 'Dura'`
  - `difficulty(x: { distanceM: number; elevGainM: number }, ref: UserReference): Difficulty`
  - `upliftPct(x: { distanceM: number; elevGainM: number }, ref: UserReference, dim: 'distance' | 'elevation'): number`, en % sobre la media (positivo si está por encima).

- [ ] **Step 1: pruebas que fallan**
  - `uses 8 weeks when 5 rides in 8 weeks`: `weeks` = 8 y solo cuentan esas salidas.
  - `falls back to 12 weeks`: 3 salidas en 8 semanas y 6 en 12 dan `weeks` = 12, `rides` = 6.
  - `null below 5 rides in 12 weeks`.
  - `averages are per ride and speed is distance over moving time`.
  - `ridesPerWeek is rides over window weeks`.
  - `difficulty boundaries`: con media 50 km y 500 m, (42 km, 400 m) es Suave; (42,5 km, 0 m) es Media; (55 km, 550 m) es Media; (55,5 km, 0 m) es Dura; (40 km, 600 m) es Dura.
  - `zero average elevation ignores elevation ratio`: con `avgElevGainM` = 0, solo cuenta la distancia.
  - `upliftPct distance`: 55 km sobre una media de 50 km da 10.
- [ ] **Step 2:** `npx vitest run tests/reference.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. La ventana va hacia atrás desde `now` (`now − semanas × 7 días`), no por semanas ISO.
- [ ] **Step 4:** `npx vitest run tests/reference.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 5: Rejilla del historial y puntuación

Agente: `cycling-metrics-analyst`.

**Files:**
- Create: `src/metrics/grid.ts`, `src/metrics/score.ts`
- Test: `tests/grid.test.ts`, `tests/score.test.ts`

**Interfaces:**
- Consumes: `TrackPoint`, `haversineM`, `Coord3`
- Produces:
  - `CELL_M = 200`
  - `cellKey(lat: number, lng: number): string`
  - `buildVisitedCells(tracks: Iterable<TrackPoint[]>): Set<string>`
  - `newRoadPct(coords: Coord3[], visited: ReadonlySet<string>): number` (0 a 100)
  - `type Target = { distanceM: number; elevGainM: number | null; preferNew: boolean }`
  - `scoreCandidate(c: { distanceM: number; elevGainM: number; newPct: number }, t: Target): number` (0 a 1)

- [ ] **Step 1: pruebas que fallan**
  - `same cell within 200 m grid`: dos puntos a 50 m dentro de la misma celda dan la misma clave; dos puntos a 450 m en latitud, claves distintas.
  - `cell width corrected by latitude`: a lat 60, dos puntos separados 0,003° de longitud (≈ 167 m) caen como mucho en celdas contiguas, nunca a 2 columnas.
  - `gaps over 100 m are densified`: un track con dos puntos a 1 km marca al menos 5 celdas.
  - `empty history gives 100 % new`.
  - `route over visited road gives 0 % new`: una ruta que repite el track del historial da 0.
  - `half visited gives about 50 %`: ±5.
  - `exact target scores higher than 20 % off`.
  - `elevation target counts when set`: con `elevGainM: null` el desnivel no cambia la puntuación.
  - `preferNew false rewards known roads`: con `preferNew: false`, `newPct` 0 puntúa más que 100.
- [ ] **Step 2:** `npx vitest run tests/grid.test.ts tests/score.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
  - `cellKey`: `latStep = 200 / 111320`; `row = floor(lat / latStep)`; `lngStep = 200 / (111320 · cos(row · latStep · π/180))`; `col = floor(lng / lngStep)`; clave `` `${row}:${col}` ``.
  - `newRoadPct`: remuestrear la ruta cada 50 m y contar las muestras cuya celda no está en `visited`.
  - `scoreCandidate`: `closeness` = media de `1 − min(1, |real − objetivo| / objetivo)` de las dimensiones con objetivo; `novelty` = `newPct / 100`, o `1 − newPct / 100` si `preferNew` es falso; resultado `0,7 · closeness + 0,3 · novelty`.
- [ ] **Step 4:** `npx vitest run tests/grid.test.ts tests/score.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 6: Exportación GPX para iGPSPORT

Agente: `cycling-routes-engineer`.

**Files:**
- Create: `src/routes/gpx.ts`
- Test: `tests/routeGpx.test.ts`

**Interfaces:**
- Consumes: `Coord3`
- Produces:
  - `toGpx(name: string, coords: Coord3[]): string`
  - `gpxFileName(c: { distanceM: number; elevGainM: number }): string`. Ejemplo: `ruta-62km-850m.gpx`.

- [ ] **Step 1: pruebas que fallan**, leyendo el resultado con `DOMParser` de `@xmldom/xmldom`:
  - `gpx 1.1 root with namespace`: raíz `gpx`, `version="1.1"`, `xmlns="http://www.topografix.com/GPX/1/1"` y `creator` no vacío.
  - `one trk with one trkseg and all points`: 3 coordenadas dan 3 `trkpt` dentro de `trk > trkseg`.
  - `trkpt has lat lon attributes and ele child`: `lat="40.416800"` y `lon="-3.703800"` (6 decimales) y `<ele>650.0</ele>`.
  - `no time elements`.
  - `escapes name`: `Vuelta & <Sol>` sale escapado y el XML sigue siendo válido.
  - `file name rounds km and m`: (62.400 m, 849,6 m) da `ruta-62km-850m.gpx`.
- [ ] **Step 2:** `npx vitest run tests/routeGpx.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar con plantillas de texto. `metadata > name` y `trk > name` con el mismo nombre. Primera línea `<?xml version="1.0" encoding="UTF-8"?>`.
- [ ] **Step 4:** `npx vitest run tests/routeGpx.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 7: Generador de rutas

Agente: `cycling-routes-engineer`.

**Files:**
- Create: `src/routes/generator.ts`, `src/routes/history.ts`
- Test: `tests/generator.test.ts`

**Interfaces:**
- Consumes: `fetchRoundTrip`, `OrsError`, `analyzeRoute`, `rejectReason`, `newRoadPct`, `scoreCandidate`, `Target`, `UserReference`, `difficulty`, `buildVisitedCells`, `repo.listActivities`, `repo.getTrack`
- Produces:
  - `type GenerateRequest = { start: LatLng; target: Target; count?: number; seeds?: number }`. `count` de 3 a 5, 5 por defecto; `seeds`, 8 por defecto. F5 pide `count: 1, seeds: 3` por opción.
  - `type GeneratedRoute = RouteCandidate & { newPct: number; score: number; difficulty: Difficulty | null; estTimeS: number | null }`
  - `type GenerateResult = { routes: GeneratedRoute[]; rejected: { seed: number; reason: RejectReason }[]; requestsUsed: number; stoppedBy: OrsError | null }`
  - `generateRoutes(req: GenerateRequest, deps: { apiKey: string; reference: UserReference | null; visited: ReadonlySet<string>; seedBase?: number; fetchRoundTrip?: typeof fetchRoundTrip }): Promise<GenerateResult>`
  - `loadVisitedCells(): Promise<Set<string>>` en `history.ts`

- [ ] **Step 1: pruebas que fallan**, con `fetchRoundTrip` simulado que devuelve features sintéticas por semilla:
  - `requests seeds sequentially with points 4`: con `seeds: 3` y `seedBase: 10`, las llamadas reciben las semillas 10, 11 y 12 una tras otra (la segunda empieza cuando termina la primera).
  - `returns best count sorted by score`: de 8 candidatas válidas, devuelve 5 ordenadas por `score` descendente.
  - `filters and reports rejected`: una candidata con 300 m sin asfaltar aparece en `rejected` con `'sin asfaltar'`.
  - `dedupes identical loops`: dos semillas con la misma distancia (redondeada a 100 m) y el mismo desnivel (redondeado a 10 m) dejan una sola ruta.
  - `all rejected returns no routes with reasons`.
  - `rate limit mid-search keeps partial routes`: la tercera llamada lanza `OrsError('rate_minute')`; el resultado trae las 2 primeras rutas y `stoppedBy.kind === 'rate_minute'`.
  - `error on first call throws`: un `OrsError('unreachable')` en la primera llamada se propaga.
  - `no_route skips seed and continues`.
  - `difficulty and time null without reference`; con referencia, `estTimeS = distanceM / avgSpeedMs`.
- [ ] **Step 2:** `npx vitest run tests/generator.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. `points` = 4 en todas las peticiones; `seedBase` por defecto, un entero aleatorio entre 0 y 10.000, para que dos búsquedas iguales den rutas distintas. `loadVisitedCells` recorre las actividades con `hasTrack` y lee cada track con `repo.getTrack`.
- [ ] **Step 4:** `npx vitest run tests/generator.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 8: Pantalla Rutas

Agente: `cycling-frontend-dev`.

**Files:**
- Create: `src/ui/pages/Rutas.tsx`, `src/ui/components/RouteForm.tsx`, `StartPointMap.tsx`, `RouteCard.tsx`, `RouteShape.tsx`, `SlopeProfile.tsx`
- Modify: `src/App.tsx` (entrada «Rutas» en el menú y ruta `/rutas`)
- Test: `tests/rutas.test.tsx`

**Interfaces:**
- Consumes: `generateRoutes`, `loadVisitedCells`, `computeReference`, `toGpx`, `gpxFileName`, `loadSettings`, `saveSettings`, `getOrsUsage`, `OrsError`, funciones de `src/ui/format.ts`
- Produces (F5 los reutiliza):
  - `RouteForm(props: { initial?: Partial<Target>; onSubmit: (t: Target) => void; busy?: boolean })`
  - `StartPointMap(props: { value: LatLng | null; home: LatLng | null; onChange: (p: LatLng) => void; onSaveHome: (p: LatLng) => void })`
  - `RouteCard(props: { route: GeneratedRoute; title?: string; children?: ReactNode })`. `children` es la explicación de F5.
  - `useRouteSearch(): { run: (start: LatLng, t: Target, opts?: { count?: number; seeds?: number }) => Promise<GenerateResult | null>; busy: boolean; error: string | null }`

- [ ] **Step 1: pruebas que fallan**, con `generateRoutes` simulado y `StartPointMap` sustituido por un doble sin Leaflet:
  - `asks for ors key when missing`: sin clave, se ve «Añade tu clave de OpenRouteService en Ajustes» con enlace a `#/ajustes`.
  - `start defaults to Casa`: con `home` en Ajustes, el inicio es Casa y se ve «Inicio: Casa».
  - `asks to pick start when no home`: sin `home`, «Elige el inicio en el mapa» y el botón de buscar desactivado.
  - `form defaults to reference plus 10 %`: con una referencia de 50 km, la distancia por defecto es 55.
  - `form validates range`: distancia fuera de 10–200 km muestra «Entre 10 y 200 km».
  - `renders cards with figures and gpx button`: 3 rutas dan 3 tarjetas con «62 km», «850 m», «74 % carretera nueva», la etiqueta y «Descargar GPX».
  - `card without reference hides label`.
  - `shows why no route passed`: `routes: []` con rechazos muestra «Ninguna candidata pasa el filtro de carretera: 5 sin asfaltar, 3 carretera principal. Prueba otra distancia u otro inicio.».
  - `shows ors error message`: un `OrsError('quota_day', …)` muestra su `message` tal cual.
  - `shows partial warning`: `stoppedBy` con `rate_minute` muestra las rutas y el aviso.
  - `shows daily usage`: «Consultas ORS hoy: 16 de 2.000 (cuenta de este navegador)».
  - `save as home`: cambiar el inicio y pulsar «Guardar como Casa» llama a `saveSettings` con el nuevo `home`.
- [ ] **Step 2:** `npx vitest run tests/rutas.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
  - `StartPointMap`: Leaflet con CyclOSM (constantes de `LastRide.tsx`), marcador arrastrable y clic para mover.
  - `RouteShape`: SVG con la polilínea proyectada, sin teselas.
  - `SlopeProfile`: ECharts, altitud por distancia, tramos coloreados por `steep.cls` (0 o menos, 1, 2, 3, 4, 5), con leyenda de pendiente. Aplicar `dataviz`.
  - Descarga con `Blob` y un enlace temporal.
  - Formulario: distancia en km (10–200), desnivel en m opcional (0–4.000), casilla «Prefiero carretera nueva», marcada por defecto.
- [ ] **Step 4:** `npx vitest run tests/rutas.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 9: Extremo a extremo y cierre de F4

Agente: `cycling-qa`.

**Files:**
- Create: `e2e/rutas.spec.ts`

- [ ] **Step 1:** prueba `rutas generates and downloads gpx`:
  - `page.route('https://api.openrouteservice.org/**')` responde con `round-trip-ok.json`; nunca hay llamada real;
  - en Ajustes, clave `test-key`; en Rutas, clic en el mapa para el inicio, 30 km y «Buscar rutas»;
  - aparece al menos una tarjeta; «Descargar GPX» produce un fichero `.gpx` cuyo texto contiene `<trkseg>` y `<ele>`.
- [ ] **Step 2:** prueba `rutas shows quota message`: `page.route` aborta la petición (`route.abort('failed')`); se ve «ORS no responde. Puede ser la clave…».
- [ ] **Step 3:** `npx vitest run && npx tsc --noEmit && npx playwright test`. Esperado: todo PASS.
- [ ] **Step 4:** `web-design-guidelines` y `break-ui` sobre Rutas: 0 rutas, 5 rutas de 200 km, nombres largos, perfil plano y con rampas del 16 %. Corregir lo que rompa el uso; lo visual queda para el rediseño.
- [ ] **Step 5:** prueba manual del usuario con su clave y su Casa: una búsqueda de su distancia habitual da rutas; un GPX descargado se importa en la app de iGPSPORT y se envía al BSC200S cuando esté conectado. Anotar en `docs/verificaciones.md`.
- [ ] **Step 6:** revisión final y propuesta de commit de cierre de F4, previa confirmación.

---

## Lotes

La tarea 1 es manual y va antes del lote B.

**Lote A.** No depende de los fixtures de ORS:

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f4-generador-rutas.md', tasks: [
  { n: 4, agent: 'cycling-metrics-analyst' }, { n: 5, agent: 'cycling-metrics-analyst' },
  { n: 6, agent: 'cycling-routes-engineer' } ] } })
```

**Lote B.** Necesita la tarea 1 (fixtures y forma real de la respuesta):

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f4-generador-rutas.md', tasks: [
  { n: 2, agent: 'cycling-routes-engineer' }, { n: 3, agent: 'cycling-routes-engineer' },
  { n: 7, agent: 'cycling-routes-engineer' } ] } })
```

**Lote C.** Interfaz y cierre:

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f4-generador-rutas.md', ui: true, tasks: [
  { n: 8, agent: 'cycling-frontend-dev' }, { n: 9, agent: 'cycling-qa' } ] } })
```

## Decisiones abiertas (con el supuesto tomado)

1. Umbrales del filtro: sin asfaltar ≤ 100 m, `Track` ≤ 100 m, `State Road` ≤ 20 %. Se ajustan tras la prueba manual de la tarea 9.
2. `State Road` mezcla autovías, nacionales (`trunk`) y `primary`; no se distinguen. `cycling-road` no entra en autovías, así que el 20 % lo forman nacionales y carreteras primarias.
3. Etiquetas: cortes en 0,85 y 1,10 sobre `max(distancia, desnivel)`. Así, una ruta un 5 % por encima es Media y una un 15 % por encima es Dura.
4. Referencia: 8 semanas si hay ≥ 5 salidas; si no, 12.
5. Búsqueda de 8 semillas con `points: 4`: unas 250 búsquedas al día con la cuota gratuita.
6. Contador local de cuota: no ve lo que gasten otros navegadores con la misma clave. Si la tarea 1 confirma que `x-ratelimit-remaining` es legible por CORS, se usa esa cabecera.
7. El desnivel y la distancia se calculan desde las coordenadas, no desde el `summary` de ORS, para medir igual que el historial.
