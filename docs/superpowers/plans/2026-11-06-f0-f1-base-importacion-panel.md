# F0 + F1: base técnica, importación y panel. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una web publicada en GitHub Pages que importa el archivo de Strava y ficheros FIT, GPX y TCX sueltos, los guarda en el navegador y muestra en Inicio los km, el desnivel, el tiempo y la velocidad por semana y por mes, junto con la última salida.

**Architecture:** una SPA estática sin servidor.
- Las salidas se leen en un Web Worker y pasan a un modelo común (`ParsedActivity`). Se descartan duplicados y se guardan en IndexedDB con Dexie.
- Las métricas son funciones puras sobre las actividades guardadas. La interfaz React solo lee de esas funciones y del repositorio.
- Las claves de ORS y de la IA se guardan en Ajustes. En esta fase solo se usan para comprobar la conexión.

**Tech Stack:** Vite 5, React 18, TypeScript 5 (strict), React Router 6 (`HashRouter`), Dexie 4, `@garmin/fitsdk`, JSZip 3, fflate, Papa Parse 5, date-fns 4 con `@date-fns/tz`, ECharts 5, Leaflet 1.9, Vitest con Testing Library y fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md`, `docs/propuesta-ciclismo.html`

## Global Constraints

- El repositorio en GitHub es público. Ninguna clave va en el código, en los fixtures ni en el historial.
- Los fixtures son sintéticos: ningún track real del usuario entra en el repositorio, porque revelaría su domicilio.
- Control de versiones: git con remoto en GitHub. Es una excepción a la norma de SVN, porque GitHub Pages lo exige. Cada commit necesita la confirmación explícita del usuario.
- Las rutas de la app usan `HashRouter`, porque GitHub Pages no sirve una página de respaldo para las rutas de una SPA. `vite.config.ts` lleva `base: '/<nombre-repo>/'`.
- La zona horaria de agregación es `Europe/Madrid`. Las semanas son ISO y empiezan en lunes.
- Unidades internas en SI: metros, segundos y m/s. Se convierten solo al mostrarlas, con formato `es-ES` (`1.240 m`, `24,6 km/h`).
- Solo cuentan las actividades de ciclismo: en FIT `sport` = `cycling`; en Strava, `Activity Type` ∈ {`Ride`, `Virtual Ride`, `E-Bike Ride`, `Gravel Ride`, `Mountain Bike Ride`}. Las listas se pueden ampliar tras la tarea 1.
- Textos de la interfaz en castellano, en voz activa y sin emojis.
- Las tarjetas de pulso y potencia solo se muestran si hay datos.
- Mapa: CyclOSM `https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`, con la atribución de CyclOSM y de OpenStreetMap.
- Skills por tipo de trabajo:
  - cualquier tarea: `karpathy-guidelines` y `superpowers:test-driven-development`;
  - componentes React: `react-best-practices`;
  - gráficas: `dataviz`;
  - antes de cerrar la fase: `superpowers:verification-before-completion`, `code-simplifier`, `web-design-guidelines` y `break-ui`.
  - El rediseño visual queda fuera de este plan: tendrá su propio plan con `frontend-design`, `ui-ux-pro-max` e `impeccable`.

## Review Focus

1. **La misma salida importada dos veces** (archivo de Strava y FIT suelto): debe quedar una sola actividad. Lo cubre la tarea 7, prueba `dedupes same ride from archive and loose fit`.
2. **Un archivo de varios años, con más de 1.000 actividades y más de 500 MB:**
   - la pantalla no se congela, se ve el progreso y la memoria no se dispara;
   - el ZIP se procesa entrada a entrada y el track se guarda simplificado.
   - Lo cubren la tarea 7 (`downsamples track to >=15 m spacing`) y la tarea 9 (`shows progress while importing`).
3. **Salidas sin GPS (rodillo, actividades manuales) o deportes que no son ciclismo:**
   - las de rodillo cuentan en los totales, pero sin mapa;
   - las carreras a pie y caminatas no entran.
   - Lo cubren la tarea 6 (`skips non-cycling rows`) y la tarea 10 (`last ride without track shows no map`).
4. **Fichero corrupto o en formato desconocido:** aparece en el informe con su motivo y el resto de la importación continúa. Lo cubre la tarea 7, prueba `corrupt file is reported and others import`.
5. **Salida un domingo a las 23:30 o en un cambio de hora:** cuenta en la semana local correcta. Lo cubre la tarea 8, pruebas `sunday 23:30 madrid belongs to that week` y `dst change week`.

---

## Estructura de ficheros

```
.github/workflows/deploy.yml     despliegue en GitHub Pages
vite.config.ts  vitest.config.ts  playwright.config.ts  tsconfig.json  index.html
src/main.tsx  src/App.tsx         router y layout con menú lateral
src/domain/types.ts               tipos compartidos
src/db/db.ts                      esquema Dexie
src/db/repo.ts                    lectura y escritura de actividades y metadatos
src/settings/settings.ts          carga y guardado de ajustes
src/settings/probes.ts            comprobación de ORS y de la IA
src/import/gpx.ts  tcx.ts  fit.ts lectores por formato que devuelven ParsedActivity
src/import/summary.ts             totales a partir de los puntos
src/import/stravaArchive.ts       lectura del ZIP de Strava
src/import/importService.ts       orquesta: leer, descartar duplicados, simplificar, guardar
src/import/import.worker.ts       envoltorio fino del servicio en un Web Worker
src/metrics/aggregate.ts          totales por semana y por mes, y variaciones
src/backup/backup.ts              exportar y restaurar copia
src/ui/pages/Inicio.tsx  Importar.tsx  Ajustes.tsx
src/ui/components/…               KpiTile, ProgressChart, LastRide, Dropzone, ImportReportView
tests/fixtures/                   ride.gpx, ride.tcx, ride.fit (sintéticos), corrupt.fit
tests/**/*.test.ts(x)             pruebas unitarias
e2e/import.spec.ts                prueba de extremo a extremo
docs/verificaciones.md            resultados de la tarea 1
```

---

### Task 1: Comprobaciones previas (F0)

Tarea de investigación, sin código de producción. Su resultado fija valores que usan las tareas 2, 5 y 6.

**Files:**
- Create: `docs/verificaciones.md`

**Interfaces:**
- Produces:
  - nombres exactos de las columnas de `activities.csv`;
  - formato de los ficheros dentro de `activities/`;
  - valores de `Activity Type` de ciclismo;
  - si el BSC200S se monta como disco USB, y en qué carpeta;
  - política de datos de Groq;
  - si ORS y Groq aceptan llamadas directas desde el navegador (CORS).

- [ ] **Step 1:** pedir al usuario que solicite «Descargar tu cuenta» en strava.com, en Ajustes > Mi cuenta. Anotar si está disponible sin suscripción y cuánto tarda en llegar.
- [ ] **Step 2:** con el ZIP, anotar:
  - la lista de carpetas;
  - la cabecera de `activities.csv`, sin copiar filas;
  - las extensiones presentes en `activities/` (`.fit.gz`, `.gpx`, `.tcx.gz`…);
  - los valores distintos de `Activity Type`.
  No subir el ZIP al repositorio.
- [ ] **Step 3:** pedir al usuario que conecte el BSC200S por USB y anotar si aparece como unidad y la ruta de sus FIT.
- [ ] **Step 4:** leer la política de privacidad y uso de datos de Groq (si entrena con lo que recibe y cuánto lo conserva) y anotarla con su URL.
- [ ] **Step 5:** desde una página servida en `http://localhost:5173`, hacer `fetch` a `https://api.openrouteservice.org/v2/directions/cycling-road` (POST) y a `https://api.groq.com/openai/v1/models` (GET) con claves de prueba del usuario. Anotar si CORS lo permite. Si alguno falla, anotar que hace falta el plan B: un reenvío en Cloudflare Worker, que tendrá su propia tarea en el plan de F4.
- [ ] **Step 6:** commit de `docs/verificaciones.md`, previa confirmación.

### Task 2: Esqueleto, despliegue y Ajustes

**Files:**
- Create:
  - configuración: `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `index.html`, `.github/workflows/deploy.yml`, `.gitignore` (`node_modules`, `dist`, `*.zip`, `*.fit` fuera de `tests/fixtures`);
  - código: `src/main.tsx`, `src/App.tsx`, `src/domain/types.ts`, `src/db/db.ts`, `src/settings/settings.ts`, `src/settings/probes.ts`, `src/ui/pages/{Inicio,Importar,Ajustes}.tsx`.
- Test: `tests/app.test.tsx`, `tests/settings.test.ts`, `tests/probes.test.ts`

**Interfaces:**
- Produces:
  - `type Settings = { displayName: string; home: LatLng | null; ors: { apiKey: string }; llm: { baseUrl: string; apiKey: string; model: string } }`
  - `type LatLng = { lat: number; lng: number }`
  - `DEFAULT_SETTINGS`, con `llm.baseUrl = 'https://api.groq.com/openai/v1'` y `llm.model = ''`. El usuario elige el modelo en Ajustes; si la tarea 1 recomienda uno, Ajustes lo sugiere como texto de ejemplo del campo.
  - `loadSettings(): Promise<Settings>`
  - `saveSettings(s: Settings): Promise<void>`
  - `probeOrs(apiKey: string): Promise<ProbeResult>`
  - `probeLlm(cfg: Settings['llm']): Promise<ProbeResult>`
  - `type ProbeResult = { ok: true } | { ok: false; reason: 'unauthorized' | 'network' | 'cors' | 'other'; detail: string }`
  - `db` (Dexie): tablas `activities`, `tracks`, `settings`, `meta`. Tarea 7 las rellena.

- [ ] **Step 1: pruebas que fallan**
  - `app.test.tsx`: `renders sidebar with Inicio, Importar, Ajustes`. Navegar a `#/ajustes` muestra el encabezado `Ajustes`.
  - `settings.test.ts`, con fake-indexeddb: `returns defaults when empty` (`loadSettings()` devuelve un valor igual a `DEFAULT_SETTINGS`) y `persists round trip`.
  - `probes.test.ts`, con `fetch` simulado: 401 da `{ok:false, reason:'unauthorized'}`; `TypeError` de red da `reason:'network'`; 200 da `{ok:true}`.
- [ ] **Step 2:** `npx vitest run`. Esperado: FAIL, módulos inexistentes.
- [ ] **Step 3:** implementar los tipos, `db.ts` (Dexie versión 1), `settings.ts`, `probes.ts` y las páginas vacías con su encabezado. En Ajustes:
  - campos de nombre, clave ORS, URL base, clave y modelo de la IA;
  - botones «Probar conexión», que muestran el resultado de la comprobación en texto.
- [ ] **Step 4:** `npx vitest run`. Esperado: PASS.
- [ ] **Step 5:** `npm run build`. Esperado: `dist/` sin errores de TypeScript.
- [ ] **Step 6:** `deploy.yml` usa `actions/upload-pages-artifact` y `actions/deploy-pages` al hacer push a `main`. Después de que el usuario cree el repositorio y active Pages > «GitHub Actions», la URL pública carga Inicio.
- [ ] **Step 7:** commit, previa confirmación.

### Task 3: Totales a partir de puntos

**Files:**
- Create: `src/import/summary.ts`
- Modify: `src/domain/types.ts`
- Test: `tests/summary.test.ts`

**Interfaces:**
- Produces:
  - `type TrackPoint = { t: number /* epoch ms */; lat?: number; lng?: number; ele?: number; dist?: number; speed?: number; cad?: number; hr?: number; power?: number }`
  - `type ActivityTotals = { distanceM: number; movingTimeS: number; elapsedTimeS: number; elevGainM: number; avgSpeedMs: number; maxSpeedMs: number; avgCadence?: number; avgHr?: number; avgPower?: number }`
  - `computeTotals(points: TrackPoint[]): ActivityTotals`

- [ ] **Step 1: pruebas que fallan**
  - `distance from lat/lng with haversine`: dos puntos a 0,009° de latitud dan `distanceM` ≈ 1000 ± 5.
  - `moving time excludes stops`: un tramo a menos de 1,0 m/s durante 300 s no suma a `movingTimeS`.
  - `elevation gain uses 3 m hysteresis`: la serie 100, 101, 100, 102, 100 da `elevGainM` = 0; la serie 100, 104, 108 da 8.
  - `avg cadence ignores zeros`: cadencias 0, 80, 90 dan 85.
  - `avgHr undefined when no hr`.
- [ ] **Step 2:** `npx vitest run tests/summary.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar `computeTotals`:
  - umbral de movimiento: 1,0 m/s;
  - histéresis de desnivel: 3 m;
  - si los puntos traen `dist`, se usa esa distancia en lugar de haversine;
  - `avgSpeedMs = distanceM / movingTimeS`.
- [ ] **Step 4:** `npx vitest run tests/summary.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 4: Lectores GPX y TCX

**Files:**
- Create: `src/import/gpx.ts`, `src/import/tcx.ts`, `tests/fixtures/ride.gpx`, `tests/fixtures/ride.tcx`
- Modify: `src/domain/types.ts`
- Test: `tests/gpx.test.ts`, `tests/tcx.test.ts`

**Interfaces:**
- Consumes: `computeTotals`, `TrackPoint`
- Produces:
  - `type ParsedActivity = { startTime: number; sport: 'cycling' | 'other'; name?: string; totals: ActivityTotals; points: TrackPoint[]; source: 'gpx' | 'tcx' | 'fit' | 'strava-archive'; externalId?: string }`
  - `parseGpx(xml: string): ParsedActivity`
  - `parseTcx(xml: string): ParsedActivity`
  - `class ParseError extends Error { constructor(public reason: 'empty' | 'malformed' | 'unsupported', msg: string) }`

- [ ] **Step 1:** crear fixtures sintéticos de 20 puntos, un punto cada 10 s:
  - coordenadas en el mar frente a la costa (lat 41.0, lng 2.5) para no revelar una ubicación real;
  - altitud de 0 a 40 m;
  - cadencia en `gpxtpx:cad`.
- [ ] **Step 2: pruebas que fallan**
  - `parses gpx points and time`: 20 puntos y `startTime` igual a la del primer `<time>`.
  - `gpx without time throws ParseError malformed`.
  - `reads cadence extension`: `totals.avgCadence` definido.
  - `parses tcx`: `sport` `cycling` cuando `Activity Sport="Biking"`, y se usa `DistanceMeters` del lap como `totals.distanceM`.
- [ ] **Step 3:** `npx vitest run tests/gpx.test.ts tests/tcx.test.ts`. Esperado: FAIL.
- [ ] **Step 4:** implementar con `DOMParser`; en el Worker y en las pruebas, `@xmldom/xmldom`. Si el TCX trae totales de lap, prevalecen sobre `computeTotals`.
- [ ] **Step 5:** `npx vitest run tests/gpx.test.ts tests/tcx.test.ts`. Esperado: PASS.
- [ ] **Step 6:** commit, previa confirmación.

### Task 5: Lector FIT

**Files:**
- Create: `src/import/fit.ts`, `tests/fixtures/ride.fit`, `tests/fixtures/corrupt.fit` (ride.fit truncado a la mitad)
- Test: `tests/fit.test.ts`

**Interfaces:**
- Consumes: `ParsedActivity`, `ParseError`, `computeTotals`
- Produces: `parseFit(buf: ArrayBuffer): ParsedActivity`

- [ ] **Step 1:** fixture `ride.fit`. Si `@garmin/fitsdk` trae `Encoder`, generar una actividad de ciclismo sintética con las coordenadas de la tarea 4, mensaje de sesión incluido. Si no lo trae, copiar un FIT de actividad de ejemplo del FIT SDK. Anotar el origen en `tests/fixtures/README.md`.
- [ ] **Step 2: pruebas que fallan**
  - `uses session totals when present`: `totals.distanceM` es igual a `session.totalDistance` del fixture.
  - `maps sport cycling`.
  - `semicircles converted to degrees`: lat del primer punto ≈ 41.0 ± 0.001.
  - `corrupt fit throws ParseError malformed`.
- [ ] **Step 3:** `npx vitest run tests/fit.test.ts`. Esperado: FAIL.
- [ ] **Step 4:** implementar con `Decoder` y `Stream` de `@garmin/fitsdk`:
  - opciones `convertTypesToStrings: true` y `applyScaleAndOffset: true`;
  - semicírculos × (180 / 2³¹);
  - si el FIT trae los totales de la sesión (`totalDistance`, `totalTimerTime`, `totalElapsedTime`, `totalAscent`), prevalecen sobre `computeTotals`;
  - `checkIntegrity()` falso lanza `ParseError('malformed')`.
- [ ] **Step 5:** `npx vitest run tests/fit.test.ts`. Esperado: PASS.
- [ ] **Step 6:** commit, previa confirmación.

### Task 6: Lector del archivo de Strava

**Files:**
- Create: `src/import/stravaArchive.ts`
- Test: `tests/stravaArchive.test.ts`. El ZIP se construye dentro de la prueba con JSZip; no hay fixture binario.

**Interfaces:**
- Consumes: `parseFit`, `parseGpx`, `parseTcx`, `ParseError`, las columnas anotadas en la tarea 1
- Produces:
  - `STRAVA_COLUMNS`: objeto `{ id, name, type, filename }` con los nombres exactos de cabecera de la tarea 1.
  - `CYCLING_TYPES: ReadonlySet<string>`
  - `type ArchiveItem = { ok: true; activity: ParsedActivity } | { ok: false; file: string; reason: string }`
  - `readStravaArchive(zip: Blob, onProgress?: (done: number, total: number) => void): AsyncGenerator<ArchiveItem>`

- [ ] **Step 1: pruebas que fallan**
  - `reads csv rows and linked files`: un ZIP con `activities.csv` de 2 filas de ciclismo y sus ficheros (`activities/1.gpx`, `activities/2.fit.gz`) devuelve 2 elementos `ok`. Cada `name` y `externalId` vienen del CSV.
  - `skips non-cycling rows`: una fila `Run` no devuelve actividad.
  - `row without file yields ok:false reason "sin fichero"`.
  - `reports progress`: `onProgress` se llama con `total` = 2.
- [ ] **Step 2:** `npx vitest run tests/stravaArchive.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar:
  - JSZip para abrir el archivo y Papa Parse para el CSV;
  - descompresión de `.gz` con `gunzipSync` de fflate;
  - las entradas se leen de una en una (`zip.file(name).async('arraybuffer')`), nunca todas a la vez;
  - el nombre y el tipo salen del CSV; la hora de inicio y los totales, del fichero.
- [ ] **Step 4:** `npx vitest run tests/stravaArchive.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 7: Servicio de importación, duplicados y repositorio

**Files:**
- Create: `src/import/importService.ts`, `src/import/import.worker.ts`, `src/db/repo.ts`
- Modify: `src/db/db.ts`
- Test: `tests/importService.test.ts`

**Interfaces:**
- Consumes: todos los lectores, `readStravaArchive`, `db`
- Produces:
  - `type StoredActivity = { id: string; startTime: number; sport: 'cycling'; name?: string; totals: ActivityTotals; hasTrack: boolean; source: ParsedActivity['source']; importedAt: number }`
  - `activityKey(a: Pick<ParsedActivity, 'startTime' | 'totals'>): string`, que es `startTime` redondeado al minuto y `distanceM` redondeado a 100 m.
  - `isDuplicate(a: ParsedActivity, existing: StoredActivity[]): boolean`. Es duplicado si el inicio difiere ≤ 60 s y la distancia ≤ 2 %.
  - `downsample(points: TrackPoint[], minSpacingM = 15): TrackPoint[]`
  - `type ImportReport = { added: number; duplicates: number; skipped: { file: string; reason: string }[] }`
  - `importFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<ImportReport>`, que decide el lector por extensión (`.zip`, `.fit`, `.gpx`, `.tcx`, con o sin `.gz`).
  - `repo.listActivities(range?: { from: number; to: number }): Promise<StoredActivity[]>`
  - `repo.getTrack(id: string): Promise<TrackPoint[] | undefined>`
  - `repo.getMeta(): Promise<{ lastImportAt?: number }>`
  - Worker: `postMessage({ files })` responde con `{ type: 'progress', done, total }` y al final `{ type: 'done', report }`.

- [ ] **Step 1: pruebas que fallan**, con fake-indexeddb:
  - `imports gpx and stores activity and track`.
  - `dedupes same ride from archive and loose fit`: la misma salida con inicio desplazado 30 s y distancia un 1 % distinta da `added: 1, duplicates: 1`.
  - `corrupt file is reported and others import`: con `[corrupt.fit, ride.gpx]` da `added: 1` y `skipped[0].file === 'corrupt.fit'`.
  - `unknown extension reported as "formato no soportado"`.
  - `downsamples track to >=15 m spacing`: entre dos puntos consecutivos guardados hay al menos 15 m, salvo el último.
  - `updates lastImportAt`.
- [ ] **Step 2:** `npx vitest run tests/importService.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Al buscar duplicados, consultar solo las actividades del mismo día (índice `startTime`). El Worker es un envoltorio sin lógica propia.
- [ ] **Step 4:** `npx vitest run tests/importService.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 8: Totales por semana y mes

**Files:**
- Create: `src/metrics/aggregate.ts`
- Test: `tests/aggregate.test.ts`

**Interfaces:**
- Consumes: `StoredActivity`
- Produces:
  - `type Period = 'week' | 'month'`
  - `type PeriodTotals = { start: number; label: string; distanceM: number; elevGainM: number; movingTimeS: number; rides: number; avgSpeedMs: number }`
  - `aggregate(acts: StoredActivity[], period: Period, from: number, to: number): PeriodTotals[]`. Devuelve todos los periodos del rango, también los vacíos con 0.
  - `currentWeekVsAverage(acts: StoredActivity[], now: number, weeks = 4): { current: PeriodTotals; avg: PeriodTotals; deltaPct: { distance: number | null; elev: number | null; time: number | null } }`. Si la media es 0, el valor es `null`.
  - `TZ = 'Europe/Madrid'`

- [ ] **Step 1: pruebas que fallan**
  - `sunday 23:30 madrid belongs to that week`: 2026-11-08T22:30Z cae en la semana que empieza el lunes 2026-11-02.
  - `dst change week`: las salidas del 2026-10-25 (cambio de hora) cuentan en una sola semana.
  - `empty weeks are zero-filled`.
  - `delta null when no history`.
  - `avgSpeed is distance over moving time of the period`.
- [ ] **Step 2:** `npx vitest run tests/aggregate.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar con `TZDate` de `@date-fns/tz` y `startOfISOWeek` y `startOfMonth` de date-fns.
- [ ] **Step 4:** `npx vitest run tests/aggregate.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 9: Pantalla Importar

**Files:**
- Create: `src/ui/components/Dropzone.tsx`, `src/ui/components/ImportReportView.tsx`
- Modify: `src/ui/pages/Importar.tsx`
- Test: `tests/importar.test.tsx`

**Interfaces:**
- Consumes: el Worker de la tarea 7 (inyectable para las pruebas mediante `useImporter()`), `ImportReport`

- [ ] **Step 1: pruebas que fallan**, con un importador simulado:
  - `shows progress while importing`: con `progress 3/10` se muestra `3 de 10`.
  - `shows report`: `added 5, duplicates 2, skipped 1` muestra «5 salidas nuevas», «2 ya estaban» y el fichero saltado con su motivo.
  - `accepts drop and file picker`: el `input type=file` acepta `.zip,.fit,.gpx,.tcx,.gz`.
- [ ] **Step 2:** `npx vitest run tests/importar.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Textos:
  - título «Importar salidas»;
  - ayuda: «Arrastra aquí el archivo de “Descargar tu cuenta” de Strava, o ficheros FIT, GPX o TCX.»;
  - un enlace a los pasos para pedir el archivo en Strava.
- [ ] **Step 4:** `npx vitest run tests/importar.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 10: Inicio (funcional, con diseño provisional)

**Files:**
- Create: `src/ui/components/KpiTile.tsx`, `ProgressChart.tsx`, `LastRide.tsx`
- Modify: `src/ui/pages/Inicio.tsx`
- Test: `tests/inicio.test.tsx`

**Interfaces:**
- Consumes: `repo.listActivities`, `repo.getTrack`, `repo.getMeta`, `aggregate`, `currentWeekVsAverage`, `Settings.displayName`

- [ ] **Step 1: pruebas que fallan**, con un repositorio sembrado:
  - `empty state invites import`: sin actividades se ve el texto «Aún no hay salidas» y un enlace a `#/importar`.
  - `week kpis`: con salidas de ejemplo se ve «88 km», «1.240 m», «3 h 42 min» y «24,6 km/h».
  - `delta shown vs own average`: −8 % se muestra como «−8 % vs tu media».
  - `import reminder after 7 days`: con `lastImportAt` de hace 9 días se muestra «Última importación hace 9 días».
  - `last ride without track shows no map`.
  - `range switch`: «12 meses», «6 meses», «3 meses» y «30 días» cambian los periodos que se pasan a la gráfica. Los tres primeros van por meses y «30 días» por semanas.
- [ ] **Step 2:** `npx vitest run tests/inicio.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar:
  - ECharts con dos series, distancia en km y desnivel en m, con ejes separados y colores de los tokens; aplicar la skill `dataviz`;
  - en `LastRide`, Leaflet con CyclOSM y la polilínea del track, más un perfil de altitud;
  - saludo con `displayName` si existe.
- [ ] **Step 4:** `npx vitest run tests/inicio.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 11: Copia de seguridad

**Files:**
- Create: `src/backup/backup.ts`
- Modify: `src/ui/pages/Ajustes.tsx`
- Test: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `loadSettings`, `saveSettings`. Las tablas de calendario y objetivos llegan en F3, y `BackupFile` las incluirá como arrays vacíos.
- Produces:
  - `type BackupFile = { app: 'ciclismo'; version: 1; exportedAt: string; settings: Omit<Settings, 'ors' | 'llm'> & { ors?: Settings['ors']; llm?: Settings['llm'] }; calendar: unknown[]; goals: unknown[] }`
  - `exportBackup(opts: { includeKeys: boolean }): Promise<Blob>`
  - `restoreBackup(file: Blob): Promise<void>`, que lanza `BackupError('version' | 'format')`.

- [ ] **Step 1: pruebas que fallan**
  - `round trip restores settings`.
  - `keys excluded by default`: el JSON exportado no contiene la clave de prueba.
  - `rejects other version`.
  - `rejects non-json`.
- [ ] **Step 2:** `npx vitest run tests/backup.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. En Ajustes:
  - botones «Exportar copia» y «Restaurar»;
  - casilla «Incluir claves», sin marcar por defecto, con el aviso: «Quien tenga el fichero podrá usar tus claves».
- [ ] **Step 4:** `npx vitest run tests/backup.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 12: Prueba de extremo a extremo y cierre de fase

**Files:**
- Create: `playwright.config.ts`, `e2e/import.spec.ts`

- [ ] **Step 1:** prueba `import gpx then inicio shows totals`:
  - `npm run build && npx vite preview`;
  - ir a `#/importar` y subir `tests/fixtures/ride.gpx`;
  - comprobar que aparece «1 salida nueva»;
  - ir a `#/` y comprobar que el km de la semana del fixture no es «0 km».
  Fijar la fecha con `page.clock`.
- [ ] **Step 2:** `npx playwright test`. Esperado: PASS. Si el MCP de Playwright no conecta, usar la CLI.
- [ ] **Step 3:** pasar `code-simplifier` sobre `src/`. Después, `npx vitest run && npx playwright test`. Esperado: todo PASS.
- [ ] **Step 4:** pasar `web-design-guidelines` y `break-ui` sobre Inicio e Importar, con nombres larguísimos, 0 salidas, 5.000 salidas y una salida de 400 km. Corregir lo que rompa el uso; lo visual se deja para el plan de rediseño.
- [ ] **Step 5:** prueba manual con el archivo real del usuario, en su navegador y sin subirlo al repositorio. Los totales de un mes deben coincidir con Strava: distancia ± 1 % y desnivel ± 5 %. Anotar el resultado en `docs/verificaciones.md`.
- [ ] **Step 6:** revisión final con `feature-dev:code-reviewer` y commit de cierre de F1, previa confirmación.

---

## Planes siguientes, uno por fase

Cada uno se escribirá con esta misma skill cuando termine la fase anterior.

- **F2 · Historial y repetidas:**
  - lista y detalle de cada salida (mapa y perfil);
  - subidas detectadas en el perfil: tramo de ≥ 1 km con pendiente media ≥ 3 %;
  - reconocimiento de la misma subida en distintas salidas, por inicio y final a menos de 100 m;
  - VAM;
  - rutas repetidas por similitud del trazado.
  - Listo cuando una subida que se repite muestra todas sus pasadas.
- **F3 · Calendario:**
  - entrenos y objetivos con fecha, en tablas `calendar` y `goals` incluidas en la copia;
  - marcar como hecho al importar una salida de ese día;
  - progreso del objetivo.
- **F4 · Generador de rutas (sin IA):**
  - cliente ORS con `round_trip` (`length`, `points`, `seed`), `elevation` y `extra_info: ['surface', 'waytype', 'steepness']`;
  - filtros de asfalto y tipo de vía;
  - puntuación por cercanía al objetivo y porcentaje de carretera nueva, con una rejilla de celdas de unos 200 m sobre el historial;
  - exportación GPX validada en el BSC200S;
  - Cloudflare Worker de reenvío si la tarea 1 lo pide;
  - referencia del usuario (8 a 12 semanas) y etiquetas Suave, Media y Dura relativas a ella.
- **F5 · Rutas con IA:**
  - preguntas guiadas;
  - resumen del nivel, sin GPS;
  - llamada compatible con OpenAI y salida en JSON validada con zod; si el JSON no es válido, reintento y después formulario de F4;
  - explicación que cita cifras;
  - preguntas iniciales cuando hay menos de 5 salidas.
- **Rediseño visual:**
  - dirección propia, no genérica, con `frontend-design`, `ui-ux-pro-max` e `impeccable`;
  - animación con `animate` o `choreograph` respetando `prefers-reduced-motion`;
  - revisión con `web-design-guidelines` y `review-animations`.
