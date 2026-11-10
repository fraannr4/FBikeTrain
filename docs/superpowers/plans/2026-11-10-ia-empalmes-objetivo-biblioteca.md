# IA: empalmes de hasta 3 tramos, objetivo como contexto y referencias de la biblioteca

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empalmar admite hasta tres tramos (biblioteca, salidas del historial o una ruta IA recién propuesta) y guarda el resultado; la IA recibe el objetivo del usuario como contexto en rutas y empalmes; las rutas de la biblioteca (por ejemplo, GPX bajados a mano de Wikiloc) sirven de referencia a la IA con su enlace y autor.

**Architecture:** Tres tareas independientes sobre código existente. `spliceRoutes` pasa de dos entradas fijas a una lista de 2 o 3 en el orden elegido por el usuario; la página Empalmar amplía sus orígenes y guarda en la biblioteca. Un módulo puro `goalContext.ts` resume el objetivo (evento o volumen) y viaja en los prompts de `plan` y `splice`, en el cliente y en la función compartida. `references.ts` mezcla referencias de la biblioteca con las del servidor.

**Tech Stack:** Vite + React + TypeScript, Dexie, zod 4, OpenRouteService (`cycling-road`), Groq vía `ai-routes` (Deno), Vitest, Playwright, PGlite para SQL.

**Spec:** `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md`. Decisiones del usuario del 2026-11-10 (sesión de grilling):
- Objetivos: la IA recibe el próximo objetivo como contexto (evento con fecha; si no hay, el volumen pendiente del periodo). Sin pantallas nuevas. Los revisores comprueban la especificación.
- Empalmar: hasta 3 tramos, en el orden en que se eligen; también salidas del historial con track; el resultado se guarda en la biblioteca; desde la tarjeta de Rutas con IA, «Empalmar con…» guarda la ruta en la biblioteca y abre Empalmar con ella como primer tramo.
- Wikiloc bloquea el acceso automático (Cloudflare, 403 incluso en `robots.txt`). No se elude. El usuario baja el GPX con su cuenta y lo importa; la app conserva enlace y autor, y la IA usa la biblioteca como referencia. El adaptador `route-sources` de Wikiloc sigue apagado; OSM sigue como fuente automática.
- No hay valoración de rutas en este lote.
- Cuota de la IA compartida: 30 operaciones al día por usuario y 300 globales.

## Global Constraints

- Repositorio público: ninguna clave en el código ni en el bundle; fixtures sintéticos.
- La IA recibe solo cifras resumidas: nunca coordenadas, tracks GPS, la dirección de «Casa», ni el nombre o el lugar del objetivo.
- Mobile-first: cada pantalla tocada se valida a 360-430 px con capturas reales.
- Textos de la interfaz en castellano, con el mismo tono que los existentes.
- Verificación: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run test:db` y Playwright de las pantallas tocadas.
- Ningún agente hace commit: los confirma el usuario.
- Comportamiento con dos rutas sin cambios: los tests actuales de `splice.test.ts` y `empalmar.test.tsx` siguen pasando salvo los que cambian de firma, que se adaptan.

## Review Focus

1. Salida del historial con puntos sin GPS (`lat`/`lng` undefined) o con menos de 2 puntos válidos: se descarta con el mensaje «Esa salida no tiene un track válido para empalmar.» y no se llama a ORS. Test en la Task 1.
2. Tres tramos donde dos son la misma ruta: el empalme se calcula igual y `overlapM` lo refleja; nunca se lanza una excepción. Test en la Task 1.
3. Objetivo de evento con fecha pasada o volumen cuyo periodo ya terminó: no se envía nada (`null`), y las cifras restantes nunca son negativas. Test en la Task 2.
4. GPX con `<link href>` que no es `http(s)` o con credenciales, o `<author>` de más de 120 caracteres: se ignora el enlace o se recorta el autor; la importación no falla. Test en la Task 3.
5. Subida de cuota: la función reemplazada sigue leyendo los contadores existentes de `shared_ai_usage` sin cambiar la tabla; un usuario con 12 operaciones hechas hoy puede seguir hasta 30. Test SQL en la Task 2.

---

### Task 1: Empalmar hasta 3 tramos, salidas del historial, guardado y acceso desde Rutas con IA

**Files:**
- Modify: `src/routes/splice.ts` (tipos y `spliceRoutes`, líneas 52-92 y 333-436)
- Modify: `src/routes/library.ts` (nueva `saveSplicedRoute`)
- Modify: `src/ui/pages/Empalmar.tsx`
- Modify: `src/ui/components/AiRoutes.tsx` y `src/ui/pages/RutasIa.tsx` (botón «Empalmar con…»)
- Modify: `src/ui/routes/useSaveRoute.ts` solo si hace falta devolver la ruta guardada
- Modify: `src/ui/styles/rutas.css` si la tercera selección o el botón nuevo lo necesitan
- Test: `tests/splice.test.ts`, `tests/empalmar.test.tsx`, `tests/routeLibrary.test.ts`, `tests/rutasIa.test.tsx`, `e2e/empalmar.spec.ts`

**Interfaces:**
- Consumes: `getTrack(id)` y `listActivities(range?)` de `src/db/repo.ts`; `listReferenceRoutes`, `saveGeneratedRoute`, `routePointsToGpx`, `analyzeReferenceRoutePoints` de `src/routes/library.ts`; `orsConnectors`, `spliceGpx`, `adviseSplice` como hoy.
- Produces:
  - `export type SpliceLetter = 'A' | 'B' | 'C'`
  - `export type PieceSource = SpliceLetter | 'conector' | 'regreso'`
  - `SpliceOption.order: string` (letras en el orden unido, por ejemplo `'AB'`, `'BA'` o `'ABC'`) y `SpliceOption.reversed: Record<SpliceLetter, boolean>` (`C` siempre `false` con dos tramos).
  - `export const SPLICE = { ..., maxInputs: 3 }`
  - `export async function spliceRoutes(inputs: SpliceInput[], opts: { returnToStart: boolean }, deps: SpliceDeps): Promise<SpliceResult>`; lanza `RangeError('Se empalman entre 2 y 3 rutas.')` fuera de rango.
  - `export function activityToSpliceInput(activity: StoredActivity, track: TrackPoint[]): SpliceInput` en `src/routes/splice.ts`: filtra puntos sin `lat` o `lng`, copia `ele` si existe; con menos de 2 puntos válidos lanza `RouteLibraryError('Esa salida no tiene un track válido para empalmar.')`.
  - `export async function saveSplicedRoute(name: string, points: RoutePoint[]): Promise<ReferenceRoute>` en `src/routes/library.ts`: `format: 'gpx'`, `sourceFileName: 'empalme.gpx'`, `originalXml: routePointsToGpx(name, points)`, nombre recortado a 120.
  - Query de Empalmar: `/rutas/empalmar?primera=lib:<id>` preselecciona el primer tramo.
  - `AiRoutesCarousel` gana la prop `onSplice: (card: RouteCardData) => void` y cada tarjeta un botón «Empalmar con…».

- [x] **Step 1: Tests de `spliceRoutes` con lista de entradas**

En `tests/splice.test.ts`, adaptar las llamadas existentes a `spliceRoutes([a, b], ...)` y añadir:

```ts
it('con tres tramos solo prueba el orden elegido y los conectores entre consecutivos', async () => {
  // a, b, c circulares sintéticos separados 2 km; connectors cuenta llamadas por par (from>to)
  const out = await spliceRoutes([a, b, c], { returnToStart: false }, { connectors });
  expect(out.options.every((o) => o.order === 'ABC')).toBe(true);
  expect(out.options[0].pieces.map((p) => p.source)).toEqual(['A', 'conector', 'B', 'conector', 'C']);
  expect(calls.size).toBe(2); // un par de puntos por unión, cacheado entre sentidos
});
it('con dos tramos sigue probando AB y BA', ...); // igual que hoy
it('rechaza 1 o 4 entradas', async () => {
  await expect(spliceRoutes([a], { returnToStart: false }, deps)).rejects.toThrow('Se empalman entre 2 y 3 rutas.');
  await expect(spliceRoutes([a, b, c, a], { returnToStart: false }, deps)).rejects.toThrow('Se empalman entre 2 y 3 rutas.');
});
it('dos tramos iguales entre tres no rompen y el solape se mide', async () => {
  const out = await spliceRoutes([a, a, b], { returnToStart: false }, deps);
  expect(out.options.length).toBeGreaterThan(0);
  expect(out.options[0].overlapM).toBeGreaterThan(0);
});
it('activityToSpliceInput descarta puntos sin GPS y exige 2 válidos', () => {
  expect(activityToSpliceInput(act, [{ t: 1 }, { t: 2, lat: 40, lng: -3 }, { t: 3, lat: 40.01, lng: -3 }]).points).toHaveLength(2);
  expect(() => activityToSpliceInput(act, [{ t: 1, lat: 40, lng: -3 }])).toThrow('Esa salida no tiene un track válido para empalmar.');
});
```

- [x] **Step 2: Ejecutar `npx vitest run tests/splice.test.ts` y ver fallar los nuevos**

- [x] **Step 3: Implementar en `src/routes/splice.ts`**

`spliceRoutes` generaliza el bucle actual: `orders = inputs.length === 2 ? ['AB', 'BA'] : ['ABC']`; para cada orden, los tramos consecutivos se unen por parejas con `joinPair` (salida del tramo i, entrada del i+1) y se exploran los sentidos de cada tramo circular (abiertos no se invierten, como hoy). `id` de opción: `${order}-${bits}` con un bit por tramo. `connectorsFor` conserva la caché por par de puntos. `measure`, `thin`, el regreso y el ranking no cambian.

- [x] **Step 4: `npx vitest run tests/splice.test.ts` en verde**

- [x] **Step 5: Tests de `saveSplicedRoute`** en `tests/routeLibrary.test.ts`: guarda puntos sin `ele`, `summary.elevGainM === null`, `sourceFileName === 'empalme.gpx'`, nombre recortado a 120. Ver fallar, implementar en `library.ts`, ver pasar.

- [x] **Step 6: Tests de la página** en `tests/empalmar.test.tsx` (mismos mocks que los existentes):
  - el desplegable muestra dos grupos: «Biblioteca» y «Salidas» (salidas con `hasTrack: true`, etiqueta `nombre · fecha · km`, las 50 más recientes);
  - «Tercera ruta (opcional)» vacío por defecto; con dos elegidas se llama `spliceRoutes` con 2 entradas, con tres con 3;
  - elegir una salida llama `getTrack(id)` y pasa `activityToSpliceInput`; con track inválido se muestra el mensaje de la Review Focus 1 y no se llama a ORS;
  - `?primera=lib:<id>` preselecciona la primera ruta;
  - tras calcular, el botón «Guardar en la biblioteca» llama `saveSplicedRoute(nombre, selected.points)` y muestra «Guardada en la biblioteca.»; el botón GPX sigue igual.
  Ver fallar.

- [x] **Step 7: Implementar en `Empalmar.tsx`**: valores de selección `lib:<id>` / `act:<id>`; `Names` pasa a `Partial<Record<SpliceLetter, string>>`; `title()` y `OptionCard` muestran A, B y C; el nombre del empalme es `Empalme ${A} y ${B}` o `Empalme ${A}, ${B} y ${C}`. Mobile-first: los tres `select` apilados a 360 px.

- [x] **Step 8: Tests de `rutasIa.test.tsx`**: la tarjeta tiene «Empalmar con…»; al pulsar se guarda la ruta en la biblioteca (`saveGeneratedRoute` o el hook) y se navega a `/rutas/empalmar?primera=lib:<id>`. Ver fallar, implementar en `AiRoutes.tsx` y `RutasIa.tsx`, ver pasar.

- [x] **Step 9: e2e** `e2e/empalmar.spec.ts`: añadir un caso con tres rutas de la biblioteca y otro con una salida del historial (track sintético sembrado en IndexedDB como hace `e2e/paleta.spec.ts`), a 390x844, con ORS simulado; capturas a 360 y 430 del formulario con tres tramos. Ejecutar `npx playwright test e2e/empalmar.spec.ts e2e/break-ui-empalmar.spec.ts e2e/rutas-ia.spec.ts`.

- [x] **Step 10: `npx vitest run`, `npx tsc --noEmit`, `npm run build`**

---

### Task 2: Objetivo como contexto en rutas y empalmes, y cuota 30/300

**Files:**
- Create: `src/ai/goalContext.ts`
- Modify: `src/ai/contracts.ts`, `src/ai/prompts.ts`, `src/ai/routePlanner.ts`, `src/ai/spliceAdvisor.ts`, `src/ai/sharedClient.ts`, `src/ai/shared/service.ts`
- Modify: `src/ui/pages/RutasIa.tsx` y `src/ui/pages/Empalmar.tsx` (calculan el objetivo y lo pasan)
- Create: `supabase/migrations/202611100004_shared_ai_quota_raise.sql`
- Modify: el test SQL de la cuota de IA en `supabase/tests/` y `scripts/test-account-sql.mjs` si cambia el nombre; `supabase/functions/ai-routes/README.md` (tabla de cuotas)
- Test: `tests/goalContext.test.ts` (nuevo), `tests/prompts.test.ts`, `tests/aiSchema.test.ts` o el test del servicio compartido existente, `tests/routePlanner.test.ts`, `tests/spliceAdvisor.test.ts`

**Interfaces:**
- Consumes: `nextGoal(goals, today)` de `src/ai/workoutPlanner.ts`; `volumeProgress(goal, acts, now)` y `periodRange` de `src/metrics/calendar.ts`; `listGoals()` de `src/calendar/calendarRepo.ts`; `listActivities` de `src/db/repo.ts`.
- Produces:
  - `export type AiGoal = { tipo: 'evento'; diasHasta: number; distanciaKm: number | null; desnivelM: number | null } | { tipo: 'volumen'; diasRestantes: number; distanciaRestanteKm: number | null; desnivelRestanteM: number | null }` en `src/ai/contracts.ts`.
  - `export function aiGoal(goals: Goal[], acts: StoredActivity[], now: number, today: LocalDate): AiGoal | null` en `src/ai/goalContext.ts`: prioridad al evento futuro más próximo (vía `nextGoal`); si no hay, el objetivo de volumen cuyo periodo contiene `today` con menos días restantes; restantes = objetivo − hecho, nunca negativos; km con 1 decimal, m enteros; `null` si no hay ninguno vigente.
  - `buildPlanMessages(summary, answers, maxDistanciaKm, referencias = [], objetivo: AiGoal | null = null)` y `buildSpliceMessages(facts, objetivo: AiGoal | null = null)`: el JSON de usuario lleva `objetivo` solo si no es `null`.
  - Regla nueva en `PLAN_SYSTEM`: «Puedes recibir el objetivo del usuario («objetivo»): un evento con los días que faltan y sus cifras, o el volumen que le falta en el periodo. Úsalo para orientar las opciones sin salir del margen del 5-15 % y cítalo en «motivo» cuando lo uses.» Regla equivalente en el sistema de `splice`: recomendar la opción más cercana a la dimensión del objetivo.
  - `SharedRoutePlanner.plan(summary, answers, maxDistanciaKm, signal?, referencias?, objetivo?: AiGoal | null)`; `adviseSplice(options, deps: SpliceAdvisorDeps & { objetivo?: AiGoal | null })`; `createSharedSpliceAdvisor` envía `objetivo`.
  - `src/ai/shared/service.ts`: `aiGoalSchema` estricto (`evento`: `diasHasta` entero 0-730, `distanciaKm` 0-1000 o null, `desnivelM` 0-20000 o null; `volumen`: `diasRestantes` entero 0-366, `distanciaRestanteKm` 0-5000 o null, `desnivelRestanteM` 0-100000 o null); campo `objetivo: aiGoalSchema.nullable().optional()` en `plan` y `splice`.
  - Migración `202611100004_shared_ai_quota_raise.sql`: `create or replace function public.consume_shared_ai_quota` copiada de `202611090002_shared_ai_quota.sql` cambiando solo los límites: usuario/día 12 → 30, global/día 40 → 300, global/minuto 3 → 10; usuario/minuto sigue en 2. Misma firma, mismos `revoke`/`grant`.

- [x] **Step 1: `tests/goalContext.test.ts`**

```ts
it('prefiere el evento futuro más próximo', () => expect(aiGoal([volume, eventIn20d, eventIn5d], acts, NOW, TODAY)).toEqual({ tipo: 'evento', diasHasta: 5, distanciaKm: 120, desnivelM: 1500 }));
it('sin evento usa el volumen vigente con restantes no negativos', () => {
  const g = aiGoal([monthVolume400km], actsWith430km, NOW, TODAY);
  expect(g).toEqual({ tipo: 'volumen', diasRestantes: expect.any(Number), distanciaRestanteKm: 0, desnivelRestanteM: null });
});
it('evento pasado y periodo terminado dan null', () => expect(aiGoal([pastEvent, lastMonthVolume], acts, NOW, TODAY)).toBeNull());
it('no incluye nombre ni lugar', () => expect(JSON.stringify(aiGoal([eventIn5d], acts, NOW, TODAY))).not.toMatch(/Mallorca|title/));
```

- [x] **Step 2: Ver fallar, implementar `goalContext.ts`, ver pasar**

- [x] **Step 3: `tests/prompts.test.ts`**: con `objetivo` el JSON de usuario lo incluye y el sistema de `plan` y de `splice` mencionan «objetivo»; con `null` no aparece la clave. Ver fallar, implementar en `prompts.ts` y `contracts.ts`, ver pasar.

- [x] **Step 4: Esquema compartido**: en el test existente del servicio compartido, `plan` y `splice` aceptan `objetivo` válido y rechazan `{ tipo: 'evento', diasHasta: 5, extra: 1 }` y `diasHasta: -1`. Ver fallar, implementar `aiGoalSchema`, ver pasar. La función `ai-routes` importa este módulo: no hay cambios en `supabase/functions/ai-routes/index.ts`.

- [x] **Step 5: `tests/routePlanner.test.ts` y `tests/spliceAdvisor.test.ts`**: el objetivo pasado en `deps` llega a `buildPlanMessages`/`buildSpliceMessages` y al cliente compartido. Ver fallar, implementar (`routePlanner` recibe `goal: AiGoal | null` en sus deps; `adviseSplice` recibe `objetivo`), ver pasar.

- [x] **Step 6: Páginas**: `RutasIa.tsx` y `Empalmar.tsx` calculan `aiGoal(await listGoals(), acts, Date.now(), today)` antes de pedir el plan o el consejo; cualquier error al leer objetivos deja `null`. Sin cambios visuales.

- [x] **Step 7: Migración y test SQL**: añadir `202611100004_shared_ai_quota_raise.sql`; en el test SQL de la cuota, un usuario con 12 llamadas hoy sigue permitido, la 31.ª se deniega y la 301.ª global también; `npm run test:db` en verde. Actualizar la tabla del README de `ai-routes`.

- [x] **Step 8: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run test:db`**

---

### Task 3: Referencias desde la biblioteca, con enlace y autor del GPX

> Pendiente (2026-11-10): el lote se paró antes de esta tarea por el presupuesto semanal. T1 y T2 están en `031a5c4`.

**Files:**
- Modify: `src/routes/library.ts` (`ReferenceRoute.author?`, lectura de `<link>` y `<author>` en `parseReferenceRoute`)
- Modify: `src/ai/references.ts` (`KnownRoute`, `libraryReferences`, mezcla en `pickReferences`), `src/ai/contracts.ts` (`AiReference.fuente`), `src/ai/routePlanner.ts` (`AiRoute.basadaEn.url` opcional; deps `library`), `src/ai/shared/service.ts` (`referenceSchema.fuente`)
- Modify: `src/ui/components/AiRoutes.tsx` (`SOURCE_LABEL.biblioteca`, enlace solo si hay URL), `src/ui/pages/BibliotecaRutas.tsx` (origen y autor), `src/ui/styles/rutas.css` si hace falta
- Test: `tests/routeLibrary.test.ts`, `tests/aiReferences.test.ts`, `tests/routePlanner.test.ts`, el test del servicio compartido, `tests/rutasIa.test.tsx`, el test existente de BibliotecaRutas

**Interfaces:**
- Consumes: `listReferenceRoutes()`; `pickReferences(known, maxDistanciaKm)` y `MAX_AI_REFERENCES` de `src/ai/references.ts`; `SOURCES_RADIUS_M` de `routePlanner.ts`; la distancia haversine ya existente en `src/routes` (`metres` de `src/routes/sources/overpass.ts` o la de `grid.ts`), sin duplicarla.
- Produces:
  - `ReferenceRoute.author?: string` (≤120). `parseReferenceRoute` toma `sourceUrl` del parámetro `url` y, si falta, del primer `<link href>` de `<metadata>` o `<trk>` que pase `sourceLink`; un `href` inválido se ignora sin error. `author` sale de `<metadata><author><name>`, y si no, de `<trk><src>`.
  - `export function referenceSite(url: string | undefined): 'wikiloc' | 'otro' | null` en `src/routes/library.ts` (`*.wikiloc.com` → `'wikiloc'`).
  - `export type KnownRoute = { name: string; distanceM: number; ascentM: number | null; source: 'wikiloc' | 'osm' | 'biblioteca'; url?: string; author?: string }` en `src/ai/references.ts`; `RouteReference` del servidor es asignable.
  - `export function libraryReferences(routes: ReferenceRoute[], start: LatLng, radiusM: number): KnownRoute[]`: rutas cuyo primer punto está a ≤ `radiusM` del inicio; `source: 'wikiloc'` si `referenceSite(sourceUrl) === 'wikiloc'`, si no `'biblioteca'`; `ascentM = summary.elevGainM`.
  - `pickReferences(known: KnownRoute[], maxDistanciaKm)`: las de la biblioteca van primero; se descartan duplicados (mismo nombre normalizado o distancia que difiere < 2 % con la misma fuente); máximo 6 en total, como hoy.
  - `AiReference.fuente: 'wikiloc' | 'osm' | 'biblioteca'`; `AiRoute.basadaEn: { nombre; fuente; url?: string; autor?: string }`.
  - `routePlanner` deps: `library: () => Promise<ReferenceRoute[]>`; se consulta siempre, sin variable de entorno; el servidor solo con `routeSourcesEnabled` como hoy.
  - `SOURCE_LABEL.biblioteca = 'tu biblioteca'`; la tarjeta muestra «Basada en: {nombre} (tu biblioteca)» o «(Wikiloc, {autor})» y enlaza solo si hay URL.
  - Biblioteca: cada ruta con `sourceUrl` muestra «Origen: Wikiloc · {autor}» (o «Origen: enlace») con `target="_blank" rel="noopener noreferrer"`.

- [ ] **Step 1: `tests/routeLibrary.test.ts`**

```ts
it('lee enlace y autor del GPX', () => {
  const r = parseReferenceRoute(GPX_WITH_LINK_AND_AUTHOR, 'ruta.gpx');
  expect(r.sourceUrl).toBe('https://es.wikiloc.com/rutas-ciclismo/ejemplo-1234');
  expect(r.author).toBe('ciclista_ejemplo');
});
it('ignora enlaces no http o con credenciales y recorta el autor', () => {
  const r = parseReferenceRoute(GPX_WITH_BAD_LINK_AND_LONG_AUTHOR, 'ruta.gpx');
  expect(r.sourceUrl).toBeUndefined();
  expect(r.author).toHaveLength(120);
});
it('referenceSite', () => { expect(referenceSite('https://www.wikiloc.com/x')).toBe('wikiloc'); expect(referenceSite('https://ejemplo.org')).toBe('otro'); expect(referenceSite(undefined)).toBeNull(); });
```

- [ ] **Step 2: Ver fallar, implementar en `library.ts`, ver pasar**

- [ ] **Step 3: `tests/aiReferences.test.ts`**: `libraryReferences` filtra por radio y mapea fuente/autor; `pickReferences` pone la biblioteca primero, quita duplicados y no pasa de 6; `JSON.stringify` de lo que va a la IA no contiene `lat`, `lng`, `url` ni `author`. Ver fallar, implementar, ver pasar.

- [ ] **Step 4: Esquema y prompts**: el test del servicio compartido acepta `fuente: 'biblioteca'`; `tests/routePlanner.test.ts`: con la biblioteca cercana y el servidor apagado, el plan recibe referencias y la ruta resultante lleva `basadaEn` sin `url`. Ver fallar, implementar, ver pasar.

- [ ] **Step 5: UI**: `tests/rutasIa.test.tsx` (etiqueta «tu biblioteca», sin enlace cuando no hay URL; con Wikiloc, enlace y autor) y el test de BibliotecaRutas (línea «Origen: Wikiloc · autor» con enlace). Ver fallar, implementar, ver pasar. Capturas a 360 y 430 de la biblioteca y de una tarjeta IA con nombre largo.

- [ ] **Step 6: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npx playwright test e2e/rutas-ia.spec.ts`**

---

## Comprobaciones del usuario (anotar en `docs/verificaciones.md`)

1. Tras el lote, Claude redespliega `ai-routes` (esquema con `objetivo` y `fuente: 'biblioteca'`) y aplica la migración `202611100004` en remoto.
2. En el móvil: bajar un GPX de Wikiloc con su cuenta, importarlo en la biblioteca y ver que una ruta con IA cita «Basada en: … (Wikiloc, autor)».
3. En el móvil: empalmar tres tramos (una de ellas una salida del historial), guardar el resultado en la biblioteca y exportarlo al BSC200S.
4. Con un evento en Objetivos: pedir rutas con IA y comprobar que el motivo cita el objetivo.
