# Rediseño visual «Relieve grabado» (FBikeTrain). Plan de implementación

> **Prioridad móvil (2026-11-06).** Rige `docs/requisito-mobile-first.md`. Si existe `docs/design/prototipo-movil/` (kit `movil.css`/`movil.js` y páginas), es la referencia para la composición en móvil de cada pantalla y prevalece sobre `prototipo-final/` en caso de conflicto. Valida cada tarea primero a 360-430 px.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** llevar a la app de F1 (Inicio, Importar y Ajustes) el diseño final «Relieve grabado»: paisaje SVG con la cresta de tu última salida, cuatro KPI de vidrio con chispa, progresión en área con tu periodo anterior en discontinua, rendimiento, objetivo de la semana, mapa CyclOSM oscuro con trazado luminoso, tema oscuro por defecto y claro completo, menú lateral en escritorio y barra inferior en móvil.

**Architecture:**
- Solo cambia la capa `src/ui/`, salvo las tareas 1 y 2, que atienden las peticiones de datos D1–D3 y D8–D10 en `src/metrics`, `src/import`, `src/db` y `src/backup`.
- Los tokens de `docs/design/tokens.css` se copian tal cual. Todo color sale de ellos; ECharts los lee en tiempo de ejecución y Leaflet los aplica por CSS.
- Las piezas de dibujo (paisaje, chispas, formas, perfiles, ventanas de la gráfica) son funciones puras con pruebas. Los componentes solo las pintan.
- Lo que no tiene datos hasta F2–F5 (Próximas salidas, rutas) se construye y se prueba con fixtures, pero Inicio no lo monta: las tarjetas sin datos no aparecen.

**Tech Stack:** React 18, TypeScript 5 strict, React Router 6 (`HashRouter`), ECharts 5.6.0 (`LineChart`, `MarkPointComponent`, `MarkLineComponent`, SVG), Leaflet 1.9.4 con CyclOSM, `lucide-react` 1.60.0, `@fontsource/barlow` 5.3.0 y `@fontsource/barlow-semi-condensed` 5.3.0, Vitest con Testing Library, Playwright.

**Spec:**
- Sistema de diseño: `docs/design/design-system.md` (manda en caso de duda).
- Tokens: `docs/design/tokens.css`. Recursos SVG: `docs/design/assets/`.
- Prototipo: `docs/design/prototipo-final/` (abrir `inicio.html?fase=1` con `file://`) y sus capturas en `docs/design/prototipo-final/capturas/`.
- Viabilidad y contratos con las pruebas: `docs/design/viabilidad.md`, secciones 1 y 4.
- Especificación general: `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md`.

## Global Constraints

- Base: el código de F1 completo, con el lote B terminado. Antes de empezar, `npx vitest run`, `npx tsc --noEmit` y `npx playwright test` en verde.
- Dependencias nuevas, exactas y solo estas: `npm install --save-exact lucide-react@1.60.0 @fontsource/barlow@5.3.0 @fontsource/barlow-semi-condensed@5.3.0`. `echarts` sigue en 5.6.0 y `leaflet` en 1.9.4. Nada de bibliotecas de animación, Tailwind, kits de componentes ni complementos de Leaflet. Nada de CDN en tiempo de ejecución.
- La familia es Barlow, no una `@fontsource-variable`: la eligió `cycling-ui-designer` en el sistema de diseño (sección 3). Pesos: Barlow 400, 500 y 600; Barlow Semi Condensed 600, 700 y 700 cursiva. Solo el subconjunto `latin`.
- Iconos de `lucide-react`, importados uno a uno desde `src/ui/icons.ts`. Trazo 2 px; 20, 16 o 15 px. Con texto al lado, `aria-hidden`; solos, el botón lleva `aria-label`.
- `src/ui/styles/tokens.css` es una copia literal de `docs/design/tokens.css`. Ningún componente ni CSS lleva hex sueltos. Los tokens marcados `[chart]` van en hex o en `rgba()` con comas.
- Tema: oscuro por defecto, claro completo. Clave `localStorage` `fbt-theme`, valores `dark` y `light`. Un script en línea en `index.html` pone `data-theme` antes del primer pintado. La opción «Sistema» es una decisión abierta: no se implementa.
- Nombre «FBikeTrain» en el `<title>`, la marca y el logotipo del hito. La base IndexedDB sigue llamándose `ciclismo` y el fichero de copia no cambia de nombre.
- Sin fotos. El paisaje es SVG procedimental y su cresta cercana es el perfil de la última salida. Las rutas muestran su forma y su perfil, nunca una imagen.
- En oscuro solo brillan los datos: trazado del mapa, línea de la progresión, cresta y arco del objetivo. El menú activo no lleva halo. En claro, `--glow` y `--thread` valen 0.
- Las cifras van en `--font-fig` con `tabular-nums`. La cursiva, solo en la cifra titular de cada pieza. Formato `es-ES` con las funciones de `src/ui/format.ts`, signo menos U+2212 y nada por debajo de 12 px.
- Deltas: subir en `--good` con flecha y signo; bajar en `--ink-2` con flecha y signo, nunca en rojo. `--critical` solo para errores.
- Textos en castellano, en voz activa y sin emojis. Accesibilidad WCAG 2.2 AA, objetivos de 44 px (48 en las pestañas) y foco visible en los dos temas.
- Movimiento: solo se animan `transform`, `opacity` y `stroke-dashoffset` (y color o fondo en hover). Con `prefers-reduced-motion: reduce` no hay trazos ni desplazamientos, también en ECharts y Leaflet.
- Nada inventado en producción. Lo que no existe hasta F2–F5 no aparece en Inicio. Los datos de ejemplo solo viven en `tests/` y `e2e/`, y son sintéticos (coordenadas en el mar, lat 41,0 y lng 2,5).
- Mapa: `https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`, atribución «CyclOSM | © OpenStreetMap». El filtro oscuro va solo sobre `.leaflet-tile-pane`.
- ECharts y Leaflet se cargan de forma diferida. El chunk de entrada no puede contener ni uno ni otro, e Inicio se sigue pintando en menos de 3 s con 5.000 salidas.
- `Importar` y `Ajustes` se montan sin router en sus pruebas: no usan `Link` ni hooks del router. Sus enlaces internos son `<a href="#/…">`.
- Contratos de las pruebas (`docs/design/viabilidad.md`, sección 4): se conservan. Solo cambian los de la tabla «Cambios en pruebas existentes», cada uno en su tarea y primero la prueba.
- Skills por tipo de trabajo:
  - toda tarea: `karpathy-guidelines` y `superpowers:test-driven-development`;
  - componentes: `vercel-react-best-practices`, `emil-design-eng` e `impeccable` (`craft`, `polish`);
  - gráficas y cifras: `dataviz`;
  - movimiento: `animate` y `choreograph`;
  - cierre: `web-design-guidelines`, `review-animations`, `break-ui` y `superpowers:verification-before-completion`.
- Sin commits ni push sin la confirmación explícita del usuario. Los agentes nunca hacen commit.

## Review Focus

1. **Navegador que bloquea `localStorage`** (ventana privada, almacenamiento bloqueado): la app arranca en oscuro, sin destello y sin errores, y el conmutador sigue funcionando en la sesión. Lo cubre la tarea 3: `boot script falls back to dark when storage throws` y `setTheme survives storage that throws`.
2. **Última salida sin GPS o con puntos sin altitud**: el hero usa la cresta de decorado sin rótulo de cima, la tarjeta dice que no hay mapa y no aparece el perfil. Lo cubren la tarea 5 (`hero without track has no summit label`, `drops points without ele`) y la tarea 8 (`last ride without track shows no map`).
3. **Usuario nuevo que solo tiene salidas del mes en curso**: la progresión no dibuja una línea vacía, sino «Con 2 meses de salidas verás tu tendencia.». Lo cubre la tarea 6: `fewer than 2 complete periods with rides is sparse`.
4. **Cambio de tema con la gráfica y el mapa montados**: ECharts vuelve a aplicar la opción con los colores nuevos sin reinicializarse, y el mapa cambia solo por CSS. Lo cubre la tarea 6: `theme change re-applies the chart option`.
5. **Movimiento reducido**: sin trazo del horizonte, sin animación de ECharts y sin animaciones de Leaflet. Lo cubren la tarea 6 (`no animation with reduced motion`), la tarea 8 (`mapOptions turns animations off with reduced motion`) y la tarea 11 (`no draw class with reduced motion`).

---

## Peticiones de datos que entran en este plan

El sistema de diseño (sección 12) las pide. Tocan la lógica, así que **el lote A necesita el visto bueno explícito del usuario** antes de lanzarse.

| Id | Qué | Tarea |
|---|---|---|
| D1 | `currentWeekVsAverage`: `deltaPct.speed` y `deltaPct.rides` | 1 |
| D2 | `Period` admite `'day'` (la serie anterior se pide con `aggregate` sobre el rango desplazado; no hace falta otra función) | 1 |
| D3 | `performanceSummary(acts, now)` para «Tu rendimiento» | 1 |
| D8 | `ImportReport.noGps` y `ImportReport.withCadence`; fase en el progreso; cancelar | 2 |
| D9 (nueva) | `meta.lastBackupAt`, que escribe `exportBackup`, para que la fecha de la copia sea la misma en Inicio y Ajustes | 2 |
| D10 (nueva) | `clearAllData()` para «Borrar todo» en Ajustes | 2 |

Quedan fuera: D4 (pendiente de las salidas propias, F2), D5 (dificultad de una salida, F4), D6 (rutas guardadas, F4) y D7 (racha, opcional).

## Cambios en pruebas existentes

| Prueba | Cambio | Tarea |
|---|---|---|
| `tests/aggregate.test.ts` · `delta null when no history` (línea 162) y `delta null with no activities at all` (línea 168) | El objeto esperado pasa de `{ distance: null, elev: null, time: null }` a `{ distance: null, elev: null, time: null, speed: null, rides: null }`. `toEqual` cuenta como presente una clave que vale `null`, así que sin este cambio fallan | 1 |
| `tests/importService.test.ts` · cada `toEqual` exacto del informe (líneas 69, 106, 121, 130, 135, 154, 160, 169 y 176) | El informe esperado gana `noGps: []` y `withCadence: N`. N es 1 en las líneas 69, 106, 121, 130 y 169 (añaden `ride.gpx`, que trae `<cad>`) y 0 en las líneas 135, 154, 160 y 176 (no añaden nada, o añaden un FIT sin cadencia) | 2 |
| `tests/importService.test.ts` · `reports progress per file and per archive activity` (línea 211) | Guarda también la fase y espera la secuencia exacta de la tarea 2: `[[1, 2, 'activities'], [1, 2, 'open'], [2, 3, 'activities'], [3, 3, 'activities'], [3, 3, 'finish']]` | 2 |
| `tests/importService.test.ts` · `posts progress and done` (líneas 235-247, Worker) | Los mensajes esperados pasan a ser `{ type: 'progress', done: 1, total: 1, phase: 'activities' }`, `{ type: 'progress', done: 1, total: 1, phase: 'finish' }` y `{ type: 'done', report: { added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 1 } }` | 2 |
| `tests/importar.test.tsx` · `const report: ImportReport = {…}` (línea 59) y los importadores simulados de las líneas 80, 88, 94, 114 y 127 | Cada informe gana `noGps: []` y `withCadence: 0`. Sin esto, `npx tsc --noEmit` (que también revisa `tests/`) falla en cuanto `ImportReport` tiene los campos nuevos | 2 |
| `tests/inicio.test.tsx` · `week kpis` | Las cifras se separan en cifra y unidad: `getByText(fullText('88 km'))`, igual con `1.240 m`, `3 h 42 min` y `23,8 km/h`. `Tu media: 24,6 km/h` pasa a `−3 % vs tu media` | 5 |
| `tests/inicio.test.tsx` · `range switch` | Pasa a llamarse `range switch uses complete periods`, con las etiquetas nuevas | 6 |
| `tests/inicio.test.tsx` · simulaciones de ECharts | Se añaden `LineChart`, `MarkPointComponent` y `MarkLineComponent` | 6 |
| `tests/inicio.test.tsx` · `last ride…` y `heart rate and power…` | `48,0 km` y `142 ppm` con `fullText` | 8 |
| `e2e/break-ui.spec.ts` | `/Distancia y desnivel por mes, 12 periodos/` pasa a `/Distancia por mes, 12 meses completos/`; `/Distancia y desnivel por semana/` pasa a `/Distancia acumulada por día/`; «Ver los datos de la gráfica» pasa a «Ver como tabla»; la prueba de ejes pulsa antes la tarjeta KPI «Desnivel» (`getByRole('button', { name: /^Desnivel/ })`), porque ya no hay pastillas de métrica | 6 |
| `tests/ajustes.test.tsx` y `e2e/break-ui.spec.ts` | Botón «Guardar» pasa a «Guardar cambios»; «Ajustes guardados.» pasa a «Cambios guardados.» | 10 |
| `tests/importar.test.tsx` | Las cifras del informe con `fullText` si se separan; los textos no cambian. Los campos `noGps` y `withCadence` de los informes simulados ya los añadió la tarea 2 | 10 |

`fullText(text)` (tarea 5) encuentra el elemento más profundo cuyo `textContent` completo es `text`. Playwright ya busca así, así que sus `getByText` no cambian.

---

## Estructura de ficheros

```
index.html                                título, color-scheme, theme-color, viewport-fit, script del tema
src/main.tsx                              fuentes y hojas de estilo, en orden
src/styles.css                            se borra: pasa a src/ui/styles/
src/ui/styles/tokens.css                  copia literal de docs/design/tokens.css
src/ui/styles/base.css  shell.css  inicio.css  map.css  routes.css  forms.css  motion.css
src/ui/theme/theme.ts                     getTheme, setTheme, subscribe, useTheme
src/ui/theme/motion.ts                    useReducedMotion
src/ui/icons.ts                           iconos de lucide, uno a uno
src/ui/format.ts                          + daysAgoLabel, rideDayLabel
src/ui/profile.ts                         ProfilePoint, profileFromTrack, profileExtent
src/ui/accent.ts                          Accent y su token
src/ui/hooks/useElementWidth.ts  useMeta.ts
src/ui/shell/AppShell.tsx  Sidebar.tsx  MoreSheet.tsx  ThemeToggle.tsx
src/ui/components/Panel.tsx  SegmentedControl.tsx  EmptyState.tsx  ValueText.tsx  StravaHowTo.tsx
src/ui/scene/scene.ts  SceneSvg.tsx       paisaje procedimental
src/ui/inicio/Hero.tsx  heroCopy.ts  KpiCard.tsx  Sparkline.tsx  sparkline.ts  Notices.tsx
src/ui/inicio/progressWindows.ts  progressSeries.ts  chartTheme.ts  progressOption.ts
src/ui/inicio/PerformanceCard.tsx  RangeBar.tsx  WeekBar.tsx  GoalRing.tsx  weekGoal.ts  YourDataCard.tsx
src/ui/components/ProgressChart.tsx  echarts.ts          (se modifican)
src/ui/components/RideMapCard.tsx  RideMap.tsx  mapOptions.ts  ProfileChart.tsx  grade.ts
src/ui/components/UpcomingList.tsx  KmMarkerDate.tsx    sin montar hasta F3
src/ui/routes/RouteCard.tsx  RouteShape.tsx  DifficultyChip.tsx  shape.ts   sin montar hasta F4
src/ui/components/Dropzone.tsx  ImportProgress.tsx  ImportReportView.tsx
src/ui/pages/Inicio.tsx  Importar.tsx  Ajustes.tsx   src/App.tsx
src/ui/components/KpiTile.tsx  LastRide.tsx          se borran (tareas 5 y 8)
src/metrics/aggregate.ts  src/metrics/performance.ts                        tarea 1
src/import/importService.ts  import.worker.ts  src/ui/importer.ts            tarea 2
src/db/repo.ts  src/backup/backup.ts                                         tarea 2
tests/helpers/text.ts                     fullText
e2e/helpers/checks.ts  e2e/fixtures/demo.ts  e2e/visual.spec.ts             tarea 12
```

---

### Task 1: Métricas para el rediseño (D1, D2 y D3)

Agente: `cycling-metrics-analyst`.

**Files:**
- Modify: `src/metrics/aggregate.ts`, `src/ui/components/ProgressChart.tsx` (solo `PERIOD_NOUN`: con `Record<Period, string>` y sin la clave `day`, `tsc` falla; se añade `day: 'día'`. La tarea 6 reescribe el fichero)
- Create: `src/metrics/performance.ts`
- Test: `tests/aggregate.test.ts`, `tests/performance.test.ts`

**Interfaces:**
- Consumes: `StoredActivity`, `isTooShort` de `src/import/summary.ts`, `TZ`
- Produces:
  - `type Period = 'day' | 'week' | 'month'`. La etiqueta de `'day'` es `'d MMM'` («7 oct»).
  - `currentWeekVsAverage(...).deltaPct` añade `speed: number | null` (`null` si esta semana no hay salidas o la media es 0) y `rides: number | null`.
  - `type RangeStat = { value: number | null; mean: number | null; min: number | null; max: number | null; deltaPct: number | null }`
  - `type PerformanceSummary = { rides30: number; speed: RangeStat; elevPerRide: RangeStat; cadence: (RangeStat & { ridesWith30: number }) | null; longest: RangeStat & { startTime: number | null } }`
  - `performanceSummary(acts: StoredActivity[], now: number): PerformanceSummary`. Ventanas: 30 días = `(now − 30 d, now]` y 12 meses = `(now − 365 d, now]`. `value` sale de los 30 días; `mean`, de los 12 meses; `min` y `max`, de las salidas sueltas de los 12 meses. Velocidad = Σ distancia / Σ tiempo en movimiento. Cadencia ponderada por tiempo en movimiento, solo con las salidas que la tienen; `cadence` es `null` si ninguna de los 12 meses la tiene. `longest.value` es la salida más larga de los 30 días, `longest.mean` la distancia media por salida de los 12 meses. `deltaPct = (value − mean) / mean × 100`, o `null`. Se ignoran las salidas que cumplen `isTooShort`.

- [ ] **Step 1: pruebas que fallan**, con `NOW = Date.parse('2026-11-06T12:00:00Z')`:
  - Primero se cambian las dos pruebas existentes de la tabla «Cambios en pruebas existentes»: en `delta null when no history` (línea 162) y en `delta null with no activities at all` (línea 168), `expect(r.deltaPct).toEqual({ distance: null, elev: null, time: null, speed: null, rides: null })`.
  - `speed delta compares average speeds`: cuatro semanas anteriores de 95.652 m y 13.998 s y esta semana con 88.000 m en 13.320 s dan `deltaPct.speed` ≈ −3,32 (`toBeCloseTo(-3.32, 1)`) y `deltaPct.rides` = 100.
  - `speed delta null without rides this week`.
  - `day periods are local days`: `aggregate(acts, 'day', Date.parse('2026-10-24T22:00:00Z'), Date.parse('2026-10-26T22:59:59Z'))`, con salidas a las `2026-10-24T22:30:00Z` y `2026-10-25T23:30:00Z`, da `['25 oct', '26 oct']` con `rides` 1 y 1.
  - `speed is total distance over total time`: 60 km en 2 h y 20 km en 1 h dan `speed.value` ≈ 7,407 m/s, no la media de las dos velocidades.
  - `range comes from single rides of 12 months`: `speed.min` y `speed.max` son las velocidades de la salida más lenta y de la más rápida.
  - `cadence weighted by moving time and ignores rides without sensor`: 90 rpm en 2 h, 60 rpm en 1 h y una salida sin cadencia dan `cadence.value` = 80 y `ridesWith30` = 2, con `rides30` = 3.
  - `cadence null when no ride has cadence`.
  - `longest ride of 30 days with its date`: `longest.value` y `longest.startTime` de la salida más larga.
  - `no rides in 30 days gives null values and keeps 12-month mean`.
  - `too short rides are ignored`.
- [ ] **Step 2:** `npx vitest run tests/aggregate.test.ts tests/performance.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. `'day'` usa `startOfDay` y `addDays` de date-fns sobre `TZDate`. De las pruebas de `aggregate` que ya existen, solo cambian las dos aserciones de `deltaPct` del paso 1; el resto queda igual. En `ProgressChart.tsx`, `PERIOD_NOUN` pasa a `{ day: 'día', week: 'semana', month: 'mes' }`.
- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit`. Esperado: PASS, todas, y sin errores de tipos.
- [ ] **Step 5:** commit, previa confirmación.

### Task 2: Datos de importación y de la copia (D8, D9 y D10)

Agente: `cycling-data-engineer`.

**Files:**
- Modify: `src/import/importService.ts`, `src/import/stravaArchive.ts`, `src/import/import.worker.ts`, `src/ui/importer.ts`, `src/db/repo.ts`, `src/backup/backup.ts`, `tests/importar.test.tsx` (solo los informes simulados: ver la tabla de cambios)
- Create: `tests/importer.test.ts`
- Test: `tests/importService.test.ts`, `tests/stravaArchive.test.ts`, `tests/backup.test.ts`, `tests/repo.test.ts`, `tests/importer.test.ts`

**Interfaces:**
- Produces:
  - `type ImportPhase = 'open' | 'activities' | 'finish'`. `'open'`: abrir el ZIP o la carpeta y leer `activities.csv`. `'activities'`: leer y guardar cada salida (las dos cosas van intercaladas, por eso no hay fases separadas). `'finish'`: escribir `lastImportAt`.
  - `ArchiveItem` (en `stravaArchive.ts`): la variante `ok` pasa a `{ ok: true; activity: ParsedActivity; file: string }`, con `file = row.filename` (la ruta dentro del archivo, por ejemplo `activities/7.fit`). Las variantes de error no cambian, así que las aserciones exactas de `stravaArchive.test.ts` (líneas 68 y 145, ambas de `notCycling`) siguen igual; las de `ok` usan `toMatchObject`.
  - `ImportReport` añade `noGps: { file: string; startTime: number }[]` (salidas añadidas sin posiciones) y `withCadence: number` (salidas añadidas con `avgCadence`). `store(activity, file)` recibe el nombre: el del fichero suelto, la ruta relativa de la carpeta o `item.file` del archivo.
  - `importFiles(files, onProgress?: (done: number, total: number, phase: ImportPhase) => void): Promise<ImportReport>`. **Secuencia exacta de llamadas:**
    - cada fichero suelto, al terminarlo: `(done, total, 'activities')`, como ahora;
    - cada ZIP o carpeta de archivo, antes de leer `activities.csv`: una llamada `(done, total, 'open')` con `done` y `total` sin cambiar;
    - cada fila de ciclismo del archivo: `(done, total, 'activities')`, como ahora (y la llamada de cierre si el archivo no tenía filas);
    - una sola vez al final, justo antes de `setLastImportAt`: `(done, total, 'finish')` con los mismos `done` y `total` de la última llamada.
    Con un fichero suelto y un ZIP de dos filas, como en `reports progress per file and per archive activity`: `[1, 2, 'activities']`, `[1, 2, 'open']`, `[2, 3, 'activities']`, `[3, 3, 'activities']` y `[3, 3, 'finish']`.
  - Mensaje del Worker: `{ type: 'progress'; done: number; total: number; phase: ImportPhase }`, uno por llamada de `onProgress`.
  - `type Importer = (files: (File | FolderFile)[], onProgress: (done: number, total: number, phase?: ImportPhase) => void, signal?: AbortSignal) => Promise<ImportReport>`. La fase es opcional para que los importadores simulados de las pruebas sigan valiendo. Con `signal` abortado, `workerImporter` termina el Worker y rechaza con `new DOMException('Importación cancelada', 'AbortError')`. Lo ya guardado se queda: la deduplicación evita duplicados al repetir.
  - `getMeta(): Promise<{ lastImportAt?: number; lastBackupAt?: number }>` y `setLastBackupAt(t: number): Promise<void>`.
  - `exportBackup` llama a `setLastBackupAt(Date.now())` después de construir el `Blob`. `restoreBackup` no lo toca, en el sentido de que no lo borra ni lo hace retroceder. Choque con el plan F3 (`2026-11-06-f3-calendario.md`, línea 236): allí `restoreBackup` llama a `setLastBackupAt(Date.now())` al final, y de eso depende la prueba `restore clears the reminder`. La llamada se mantiene, y `restore keeps lastBackupAt` solo comprueba que, tras restaurar, el valor sigue definido y es mayor o igual que el anotado al exportar.
  - `clearAllData(): Promise<void>` vacía `activities`, `tracks`, `meta` y `settings` en una sola transacción.

- [ ] **Step 1: pruebas que fallan.** Primero se cambian las pruebas existentes de la tabla «Cambios en pruebas existentes» que corresponden a esta tarea:
  - en `tests/importService.test.ts`, los nueve `toEqual` exactos del informe (líneas 69, 106, 121, 130, 135, 154, 160, 169 y 176) ganan `noGps: []` y `withCadence` (1 o 0, según la tabla);
  - `reports progress per file and per archive activity` guarda `[done, total, phase]` y espera `[[1, 2, 'activities'], [1, 2, 'open'], [2, 3, 'activities'], [3, 3, 'activities'], [3, 3, 'finish']]`;
  - `posts progress and done` (Worker) espera los tres mensajes de la tabla, con `phase` y el informe nuevo;
  - en `tests/importar.test.tsx`, el `const report: ImportReport` de la línea 59 y los importadores simulados de las líneas 80, 88, 94, 114 y 127 ganan `noGps: []` y `withCadence: 0`, para que `tsc` siga en verde.

  Pruebas nuevas:
  - `report lists rides without gps`: un TCX sintético con `Trackpoint` sin `Position`, llamado `indoor.tcx`, da `noGps[0].file === 'indoor.tcx'` y cuenta en `added`.
  - `archive ride without gps is listed with its path` (`importService.test.ts`): `stravaZip({ 'activities/7.fit': encodeFit({ totalDistance: 20_000, gps: false }) })` da `noGps` igual a `[{ file: 'activities/7.fit', startTime: START }]` y `added` 1. Es el caso principal: el usuario importa el ZIP de Strava.
  - `ok items carry their file path` (`stravaArchive.test.ts`): en `reads an unzipped folder by relative path`, `ok(items)[0]` sale con `file: 'activities/12.gpx'` (se comprueba con `items[0]` y `toMatchObject({ ok: true, file: 'activities/12.gpx' })`).
  - `withCadence counts added rides with cadence`: `ride.gpx` da `withCadence` = 1 y un FIT sin cadencia, 0.
  - `progress reports phases in order`: con un ZIP construido en la prueba, la primera fase es `'open'`, después `'activities'` y la última `'finish'`, que aparece una sola vez. Con ficheros sueltos no aparece `'open'`.
  - `workerImporter forwards phase`, con un `Worker` falso (`vi.stubGlobal('Worker', FakeWorker)`).
  - `abort terminates the worker and rejects with AbortError`.
  - `getMeta returns lastBackupAt` y `clearAllData empties every table`.
  - `export records lastBackupAt` y `restore keeps lastBackupAt`.
- [ ] **Step 2:** `npx vitest run tests/importService.test.ts tests/stravaArchive.test.ts tests/backup.test.ts tests/repo.test.ts tests/importer.test.ts`. Esperado: FAIL en las nuevas y en las cambiadas.
- [ ] **Step 3:** implementar. El Worker sigue sin lógica propia.
- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit && npx playwright test e2e/import.spec.ts`. Esperado: PASS y sin errores de tipos (también en `tests/importar.test.tsx`).
- [ ] **Step 5:** commit, previa confirmación.

### Task 3: Dependencias, fuentes, tokens y tema sin parpadeo

Agente: `cycling-ui-designer`.

**Files:**
- Modify: `package.json`, `package-lock.json` (con `npm install`), `index.html`, `src/main.tsx`, `tests/setup.ts`
- Create: `src/ui/styles/tokens.css`, `src/ui/styles/base.css`, `src/ui/theme/theme.ts`, `src/ui/theme/motion.ts`, `src/ui/icons.ts`
- Delete: `src/styles.css` (sus reglas útiles pasan a `base.css` con los tokens nuevos)
- Test: `tests/themeBoot.test.ts`, `tests/theme.test.tsx`, `tests/tokens.test.ts`

**Interfaces:**
- Produces:
  - `type Theme = 'dark' | 'light'`, `THEME_KEY = 'fbt-theme'`
  - `getTheme(): Theme` (lee `data-theme` de `<html>`; sin atributo, `'dark'`)
  - `setTheme(t: Theme): void`: pone `data-theme`, guarda en `localStorage` dentro de `try/catch`, actualiza `<meta name="theme-color">` con `--bg` y avisa a los suscriptores.
  - `subscribe(cb: () => void): () => void` y `useTheme(): Theme` (`useSyncExternalStore`).
  - `useReducedMotion(): boolean`. Sin `window.matchMedia`, devuelve `false`.
  - `src/ui/icons.ts`: `export { default as House } from 'lucide-react/icons/house'` y así con cada icono de la tabla de la sección 4 del sistema de diseño que use este plan. Si `tsc` rechaza las rutas por icono, se usan importaciones con nombre del barril en este mismo fichero.
  - Clases de `base.css`: `.sr-only`, `.btn`, `.btn-primary`, `.btn-ghost`, `.chip`, `.press`, `.fig` (cifra de dorsal), `.unit`.

- [ ] **Step 1:** `npm install --save-exact lucide-react@1.60.0 @fontsource/barlow@5.3.0 @fontsource/barlow-semi-condensed@5.3.0`. Comprobar que existen `node_modules/@fontsource/barlow/latin-400.css` y `node_modules/@fontsource/barlow-semi-condensed/latin-700-italic.css`.
- [ ] **Step 2: pruebas que fallan**
  - `themeBoot.test.ts` lee `index.html`, extrae el `<script>` en línea que no es `type="module"` y lo ejecuta con un `localStorage` simulado:
    - `boot script defaults to dark`: sin valor, `data-theme="dark"`;
    - `boot script applies a stored light theme`;
    - `boot script ignores unknown values`: con `'sepia'`, `dark`;
    - `boot script falls back to dark when storage throws`;
    - `index.html declares FBikeTrain, color-scheme and viewport-fit`: `<title>FBikeTrain</title>`, `<meta name="color-scheme" content="dark light">` y `viewport-fit=cover`.
  - `theme.test.tsx`: `setTheme persists and notifies`, `setTheme survives storage that throws` y `useTheme rerenders on change`.
  - `tokens.test.ts` lee `src/ui/styles/tokens.css`:
    - `tokens.css is a literal copy of the design tokens`: es igual a `docs/design/tokens.css`;
    - `chart tokens are hex or comma rgba`: cada línea con `[chart]` cumple `/^#[0-9a-f]{6}([0-9a-f]{2})?$/i` o `/^rgba\(\d+, \d+, \d+, [\d.]+\)$/`;
    - `ink is AA on surface in both themes`: `--ink`, `--ink-2` y `--ink-3` sobre `--surface` dan ≥ 4,5:1 en oscuro y en claro;
    - `light theme turns glow and thread off`: `--glow: 0` y `--thread: 0`;
    - `every dark token exists in light`.
- [ ] **Step 3:** `npx vitest run tests/themeBoot.test.ts tests/theme.test.tsx tests/tokens.test.ts`. Esperado: FAIL.
- [ ] **Step 4:** implementar.
  - `index.html`: `lang="es"`, título, `color-scheme`, `<meta name="theme-color" content="#0A1122">`, `viewport-fit=cover`, el script de `docs/design/viabilidad.md` 1.5 con la clave `fbt-theme` y sin la rama `system`, y `<style>html{background:#0A1122}html[data-theme='light']{background:#EEF2F8}</style>`.
  - `src/main.tsx` importa, en este orden: las seis hojas `latin-*` de `@fontsource`, `tokens.css`, `base.css`, `shell.css`, `inicio.css`, `map.css`, `routes.css`, `forms.css` y `motion.css`. Las que todavía no existan se crean vacías aquí.
  - `tests/setup.ts` añade sustitutos de `window.matchMedia` (`matches: false`), `ResizeObserver` (no hace nada) y `HTMLDialogElement.prototype.showModal` y `close` (ponen o quitan `open`), solo si faltan.
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit && npm run build`. Esperado: PASS. En `dist/assets` solo hay woff2 `latin` de Barlow.
- [ ] **Step 6:** commit, previa confirmación.

### Task 4: Armazón: AppShell, Sidebar, barra inferior, hoja «Más» y ThemeToggle

Agente: `cycling-ui-designer`. Referencia: `shell.js`, `app.css` y la sección 5 del sistema de diseño (AppShell, Sidebar, BottomTabBar, ThemeToggle, Panel, SegmentedControl y EmptyState).

**Files:**
- Create: `src/ui/shell/AppShell.tsx`, `Sidebar.tsx`, `MoreSheet.tsx`, `ThemeToggle.tsx`, `src/ui/components/Panel.tsx`, `SegmentedControl.tsx`, `EmptyState.tsx`, `src/ui/hooks/useMeta.ts`, `src/ui/styles/shell.css`
- Modify: `src/App.tsx`, `src/ui/format.ts`, `src/ui/styles/base.css`
- Test: `tests/shell.test.tsx`, `tests/format.test.ts`. `tests/app.test.tsx` no cambia.

**Interfaces:**
- Consumes: `useTheme`, `setTheme`, `getMeta`, iconos
- Produces:
  - `AppShell({ children }: { children: ReactNode })`: enlace «Saltar al contenido», `Sidebar`, `<main id="contenido" tabIndex={-1}>`. El enlace hace `preventDefault` y da el foco a `main`, porque con `HashRouter` un `#contenido` cambiaría de ruta.
  - **Un solo** `<nav aria-label="Menú principal">` en el DOM. Dentro, solo `NavLink` Inicio (`House`), un separador, Importar (`Upload`) y Ajustes (`SlidersHorizontal`), y un `<button aria-haspopup="dialog">Más</button>` (`Ellipsis`). El CSS lo convierte en barra inferior por debajo de 900 px: allí el enlace Ajustes se oculta y aparece «Más»; por encima, al revés. La marca, la tarjeta de importación y el tema quedan fuera del `<nav>`.
  - Sidebar: 232 px; carril de 84 px entre 900 y 1279 px, con las etiquetas ocultas a la vista pero presentes en el `textContent`. Entrada actual en `--action` con `aria-current="page"` y sin halo.
  - Tarjeta de importación: «Importaste {daysAgoLabel(n)}», «N salidas nuevas desde Strava» si el último informe las tiene, y un enlace «Importar». Sin `lastImportAt` dice «Aún no has importado salidas» y «Sube el archivo que te envía Strava.», con el enlace «Importar salidas». No aparece en `/importar`. No usa el texto «Última importación», que es del aviso de Inicio.
  - `MoreSheet({ open, onClose })`: `<dialog>` modal con el título «Más», un enlace a Ajustes y `ThemeToggle`. Su contenido solo se pinta abierto. Esc y el fondo lo cierran.
  - `ThemeToggle()`: `SegmentedControl` con el nombre «Tema» y las opciones Oscuro (`Moon`) y Claro (`Sun`).
  - `SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (v: T) => void })`: `div[role=group]` con `aria-label`, botones con `aria-pressed` y un indicador `.ind` que se mueve con `transform`.
  - `Panel({ titleId, title, icon, action?, sub?, className?, children })`: `<section aria-labelledby={titleId}>` con `card-h` (icono, `h2`, acción) y `card-sub`.
  - `EmptyState({ icon, title, text, action? })`
  - `useMeta(): { lastImportAt?: number; lastBackupAt?: number } | null`
  - `daysAgoLabel(days: number): string`: `'hoy'`, `'ayer'` o `'hace N días'`, con `formatCount`.
  - El armazón no usa `role="status"`: Inicio tiene el suyo mientras carga.

- [ ] **Step 1: pruebas que fallan**
  - `one navigation named Menú principal`: `getAllByRole('navigation', { name: 'Menú principal' })` tiene longitud 1.
  - `current page link has aria-current page`.
  - `skip link focuses main`.
  - `más opens a sheet with Ajustes and theme, Escape closes`.
  - `import card says Importaste hace 9 días and hides on /importar`.
  - `import card without imports says Aún no has importado salidas`: sin `lastImportAt`, el texto y el enlace «Importar salidas».
  - `theme toggle sets data-theme and aria-pressed`.
  - `daysAgoLabel`: 0 da `'hoy'`, 1 `'ayer'`, 9 `'hace 9 días'` y 1.000 `'hace 1.000 días'`.
  - `segmented control exposes aria-pressed and calls onChange`.
- [ ] **Step 2:** `npx vitest run tests/shell.test.tsx tests/format.test.ts tests/app.test.tsx`. Esperado: FAIL en las nuevas.
- [ ] **Step 3:** implementar. Barra inferior con vidrio fuerte, pestañas de 48 px y `env(safe-area-inset-bottom)`; `.content` con relleno inferior de `--tabbar-h`. Hoja «Más» desde abajo.
- [ ] **Step 4:** `npx vitest run && npx playwright test`. Esperado: PASS. La prueba de 320 px sin desplazamiento horizontal sigue en verde.
- [ ] **Step 5:** commit, previa confirmación.

### Task 5: Hero con SceneSvg y KpiCard con Sparkline

Agente: `cycling-ui-designer`. Referencia: `inicio.js` (`buildHero`, `renderSpark`), `assets/hero-*.svg` y la sección 5 del sistema de diseño (Hero, KpiCard).

**Files:**
- Create: `src/ui/scene/scene.ts`, `SceneSvg.tsx`, `src/ui/profile.ts`, `src/ui/accent.ts`, `src/ui/hooks/useElementWidth.ts`, `src/ui/components/ValueText.tsx`, `StravaHowTo.tsx`, `src/ui/inicio/Hero.tsx`, `heroCopy.ts`, `KpiCard.tsx`, `Sparkline.tsx`, `sparkline.ts`, `Notices.tsx`, `notices.ts`, `src/ui/styles/inicio.css`, `tests/helpers/text.ts`
- Modify: `src/ui/pages/Inicio.tsx`, `src/ui/components/LastRide.tsx` (recibe `track` por prop; se borra en la tarea 8)
- Delete: `src/ui/components/KpiTile.tsx`
- Test: `tests/scene.test.ts`, `tests/profile.test.ts`, `tests/valueText.test.tsx`, `tests/heroCopy.test.ts`, `tests/sparkline.test.ts`, `tests/notices.test.ts`, `tests/notices.test.tsx`, `tests/inicio.test.tsx`

**Interfaces:**
- Consumes: `currentWeekVsAverage` con D1, `aggregate`, `getTrack`, `haversineM`, `formatKm`, `formatMeters`, `formatDeltaPct`
- Produces:
  - `type ProfilePoint = { dM: number; ele: number }` (la misma forma que `profile` en el plan de F4)
  - `profileFromTrack(points: TrackPoint[], max = 240): ProfilePoint[]`: usa `dist` si existe y, si no, haversine acumulado; descarta los puntos sin `ele`; reduce a `max` puntos; con menos de 2 puntos con altitud devuelve `[]`.
  - `profileExtent(p: ProfilePoint[]): { min: number; max: number; summit: ProfilePoint } | null`
  - `mulberry32(seed: number): () => number`
  - `ridgeLayers(width: number, height: number, horizon: number, seed: number): { d: string; mistTop: number }[]`: cuatro crestas de fondo, de la más lejana a la más cercana, con perspectiva atmosférica: cada capa más oscura y más baja (`--ridge-1` … `--ridge-4`) y una bruma en degradado (`--mist`) que se come su base.
  - `climbs(profile: ProfilePoint[], minGainM = 80): { from: number; to: number; gainM: number }[]`: tramos de subida continua con al menos `minGainM` de desnivel.
  - `roadPoints(profile: ProfilePoint[], box: { width: number; baseY: number; summit: { x: number; y: number }; maxAmp: number }): { x: number; y: number; w: number }[]`: la carretera en primer plano, de abajo a la cima. Hace **una curva de herradura por subida** de `climbs` (el zigzag sale de la última salida, no es decorado), con la amplitud suavizada con coseno y el ancho `w` que se estrecha hacia la cima. El último punto es la cima.
  - `nearRidge(profile: ProfilePoint[], box: { width: number; height: number; top: number; bottom: number }): { fill: string; line: string; contours: string[]; summit: { x: number; y: number; ele: number; dM: number } }`, con 10 curvas de nivel.
  - `placeSummitLabel(summit: { x: number; y: number }, label: { w: number; h: number }, avoid: { x: number; y: number; w: number; h: number }[], width: number): { x: number; y: number; side: 'left' | 'right' }`
  - `DECOR_PROFILE: ProfilePoint[]`: perfil fijo de decorado para el estado vacío y las salidas sin GPS.
  - `SceneSvg({ profile, width, height, textBox }: { profile: ProfilePoint[]; width: number; height: number; textBox: { right: number; bottom: number } })`: `aria-hidden`, **a sangre detrás de todo el hero** (saludo, buscador y KPI incluidos). De atrás adelante:
    - cielo en degradado hasta el horizonte (`--sky-0` … `--sky-4`) y bruma cálida (`--haze`);
    - estrellas dentro de `<g style="opacity: var(--stars)">` (1 en oscuro, 0 en claro);
    - luna o sol (`--orb`) con su halo (`--orb-glow`) **detrás de la cima**;
    - las cuatro capas de `ridgeLayers`, con su bruma;
    - la cresta cercana del perfil, con curvas de nivel;
    - la carretera de `roadPoints` (borde `--road-edge`, firme `--road`, línea discontinua `--road-dash`);
    - la línea de luz en tres capas (`--ridge-line` × `--glow`, núcleo e hilo × `--thread`);
    - un velo radial (`--hero-scrim`) detrás del texto para el contraste AA.
    En claro es un amanecer saturado melocotón y oro, no una versión lavada del oscuro. Colores por CSS con los tokens del paisaje. Identificadores de degradado con `useId().replace(/:/g, '')`.
  - `useElementWidth(ref: RefObject<Element>, debounceMs = 60): number`, con `ResizeObserver`.
  - `ValueText({ value }: { value: string })`: envuelve cada grupo numérico (`/[−+]?\d[\d.,]*/`) en `<span class="fig">` y el resto en `<span class="unit">`, sin cambiar el `textContent`.
  - `fullText(text: string)`: comparador de Testing Library que acepta el elemento más profundo cuyo `textContent` es `text`.
  - `heroDate(now: number): string`, por ejemplo «Viernes, 6 de noviembre».
  - `heroSentence(current: PeriodTotals, deltaDistance: number | null): { lead: string; figure: string; tail: string }`
  - `type Accent = 'dist' | 'elev' | 'time' | 'speed'` y `accentVar(a: Accent): string`, que da `var(--acc-dist)` y los demás.
  - `sparkPath(values: number[], w: number, h: number): { line: string; area: string; last: { x: number; y: number } }`
  - `KpiCard({ label, icon, accent, value, delta, note, spark, sparkMean, selected, onSelect })`, con `delta: number | null`. Es un `<button type="button">` con `aria-pressed={selected}` y `aria-controls` hacia «Tu progresión»: **las KPI eligen la métrica de la gráfica** (no hay pastillas de métrica). La seleccionada lleva el borde y un halo interior de su acento y un icono de tendencia. Clases `.kpi`, `.kpi-label`, `.kpi-value` (con `ValueText` dentro) y `.kpi-note`. La nota de variación lleva una flecha, `<span aria-hidden="true" class="delta-short">−8 %</span>` y `<span class="delta-full">−8 % vs tu media</span>`: por debajo de 1280 px la versión completa queda oculta a la vista con `.sr-only`, y a partir de 1280 px se ve la completa y se oculta la corta.
  - `Hero({ greeting, date, sentence, profile, summitLabel, notices, avatarInitial, children })`
  - `type Notice = { id: 'import' | 'backup'; text: string; action: string; href: string }`
  - `inicioNotices({ now, rides, lastImportAt, lastBackupAt }: { now: number; rides: number; lastImportAt?: number; lastBackupAt?: number }): Notice[]`, en `src/ui/inicio/notices.ts`. Los avisos de F1 son solo estos dos, locales y calculados; nada se inventa:
    - `import`, si han pasado **más de 7 días** desde `lastImportAt` (el mismo umbral, `IMPORT_REMINDER_DAYS`, que el `.notice`): texto «Última importación hace N días.» con `formatCount`, acción «Importar salidas nuevas» y `href` `#/importar`. Es el mismo texto que el `.notice`.
    - `backup`, si hay salidas y no hay copia (`lastBackupAt` vacío): «Aún no has hecho ninguna copia de seguridad.»; si la última importación es posterior a la última copia: «Tienes salidas importadas después de tu última copia, de {daysAgoLabel}.». Acción «Hacer copia» y `href` `#/ajustes`.
    - El orden es `import` y después `backup`. Sin salidas (`rides` 0) no hay ningún aviso: el estado vacío ya invita a importar.
  - `Notices({ notices }: { notices: Notice[] })`: con 0 avisos **no pinta nada** (ni campana ni hueco). Con avisos, un botón campana (`Bell`) con `aria-expanded`, un contador visible `aria-hidden` y el nombre accesible «Avisos, N avisos» («1 aviso» en singular). El panel es un `popover` o una lista que **solo se pinta abierto**; cada aviso lleva su texto y un enlace con su acción. Esc y pulsar fuera lo cierran.
  - `StravaHowTo()`: tarjeta «Cómo conseguir tu archivo de Strava» con los 3 pasos del prototipo, sin enlaces.

- [ ] **Step 1: pruebas que fallan**
  - `scene.test.ts`:
    - `same seed gives same far ridge`;
    - `near ridge summit is the highest point`: con un pico de 992 m en `dM` 52.000, la cima tiene `ele` 992 y `dM` 52.000;
    - `flat profile has no NaN` y `single point profile has no NaN`;
    - `long track is reduced to at most 240 vertices`: 26.700 puntos de entrada;
    - `ten contour lines`;
    - `summit label flips to the left when it would clash`;
    - `four ridge layers, each lower than the one behind`;
    - `one switchback per climb`: un perfil con dos subidas de más de 80 m da una carretera que cambia de sentido dos veces;
    - `road ends at the summit`: el último punto de `roadPoints` coincide con la cima;
    - `road narrows towards the summit`: `w` decrece.
  - `profile.test.ts`: `uses dist when present`, `falls back to haversine`, `drops points without ele` y `returns [] with fewer than 2 points with ele`.
  - `valueText.test.tsx`: `keeps text content`; `marks digit groups as figures`: `'1.240 m'` da las cifras `['1.240']`, `'3 h 42 min'` da `['3', '42']`, `'24,6 km/h'` da `['24,6']` y `'−8 %'` da `['−8']`.
  - `heroCopy.test.ts`, con los datos de `inicio.test`:
    - `heroDate(NOW)` es `'Viernes, 6 de noviembre'`;
    - con un delta de −8 da `lead 'Llevas '`, `figure '88 km'` y `tail ' esta semana, un 8 % menos que tu media.'`;
    - con +5, `' esta semana, un 5 % más que tu media.'`;
    - con 0, `' esta semana, lo mismo que tu media.'`;
    - con `null`, `' esta semana.'`;
    - con 0 salidas, `lead 'Esta semana aún no has salido.'` y `figure ''`.
  - `sparkline.test.ts`: `all zero weeks draw a flat line at the bottom` y `last point is the last value`.
  - `notices.test.ts`, con `NOW`:
    - `import reminder after more than 7 days`: con `lastImportAt` de hace 9 días, un aviso `import` con el texto «Última importación hace 9 días.» y la acción «Importar salidas nuevas»; con 7 días justos, ninguno;
    - `backup reminder when imports are newer than the last backup`: importación hace 3 días y copia hace 12 da «Tienes salidas importadas después de tu última copia, de hace 12 días.»;
    - `no backup yet`: con salidas y sin `lastBackupAt`, «Aún no has hecho ninguna copia de seguridad.»;
    - `no notices without rides` y `no notices when up to date` (importación hace 3 días y copia hace 1).
  - `notices.test.tsx` (componente):
    - `bell announces 2 avisos`: con los dos avisos, un botón con nombre «Avisos, 2 avisos»; con uno, «Avisos, 1 aviso»;
    - `panel renders only when open`: antes de pulsar no hay ningún enlace «Hacer copia» en el DOM; después, sí, y Esc lo quita;
    - `no bell without notices`: con `[]`, `queryByRole('button', { name: /Avisos/ })` es `null`.
  - `inicio.test.tsx`: se cambia `week kpis` (ver la tabla) y se añaden:
    - `hero greets and summarises the week`: `Hola, Ana.` y `fullText('Llevas 88 km esta semana, un 8 % menos que tu media.')`;
    - `hero shows the summit of the last ride`: con el track de la prueba del mapa, `fullText('410 m')` y el texto `/cima de tu última salida, en el km 1/`;
    - `hero without track has no summit label`;
    - `empty state shows how to get the archive`: encabezado «Cómo conseguir tu archivo de Strava» y un único enlace «Importar salidas» en el contenido (el de la tarjeta lateral está fuera de `main`);
    - `kpi cards select the chart metric`: la de Distancia empieza con `aria-pressed="true"`; al pulsar Desnivel, pasa a `true` y la otra a `false`.
- [ ] **Step 2:** `npx vitest run`. Esperado: FAIL en las nuevas y en `week kpis`.
- [ ] **Step 3:** implementar.
  - **Inicio.** El `h1` «Inicio» pasa a `.sr-only`. El hero lleva fecha, «Hola, {nombre}.» (sin nombre, «Hola.»), la frase con la cifra en negrita y el aviso `.notice` «Última importación hace N días. Importar salidas nuevas», que sigue visible. La sección «Esta semana» tiene su `h2` en `.sr-only` y cuatro `KpiCard`: Distancia (`Bike`), Desnivel (`Mountain`), Tiempo en bici (`Timer`) y Velocidad media (`Gauge`).
  - **Velocidad sin salidas.** Si esta semana no hay salidas, la velocidad dice «Sin salidas» con la nota «Tu media: X km/h».
  - **Chispas.** `aggregate(acts, 'week', …)` de las últimas 8 semanas; la media en discontinua es `avg` de `currentWeekVsAverage`.
  - **Track y rótulo.** El track de la última salida se carga una sola vez en `Dashboard` y va al hero y a `LastRide`. El rótulo de la cima es HTML superpuesto y legible, no texto del SVG.
  - **Estado vacío.** Hero con «Aún no hay salidas.», el enlace «Importar salidas», `DECOR_PROFILE` y sin KPI. La ilustración se mantiene entera, también en el móvil: allí el hero vacío mide al menos 560 px para que la cresta y la carretera quepan bajo el botón. Sin campana. Debajo, `StravaHowTo`.
  - **Barra superior.** En F1 lleva `Notices` con `inicioNotices(...)` (de `useMeta` y el número de salidas) y el avatar, que es un enlace a `/ajustes` con `aria-label="Tu perfil"`. Sin avisos, solo el avatar. Sin buscador.
  - **Móvil.** El hero sangra hasta los bordes, la escena sigue detrás de todo y las KPI forman una cuadrícula de 2 × 2.
- [ ] **Step 4:** `npx vitest run && npx playwright test e2e/break-ui.spec.ts`. Esperado: PASS (los `.kpi-value` siguen cumpliendo sus regex).
- [ ] **Step 5:** comparar a mano con `capturas/inicio-fase1-oscuro.png` e `inicio-movil-claro.png` en `npm run dev`, y aplicar `impeccable polish`.
- [ ] **Step 6:** commit, previa confirmación.

### Task 6: ProgressChart con el tema

Agente: `cycling-frontend-dev`. Referencia: `inicio.js` (`seriesFor`, `progOption`) y la sección 7 del sistema de diseño.

**Files:**
- Create: `src/ui/inicio/progressWindows.ts`, `progressSeries.ts`, `chartTheme.ts`, `progressOption.ts`
- Modify: `src/ui/components/ProgressChart.tsx`, `src/ui/components/echarts.ts`, `src/ui/pages/Inicio.tsx`, `e2e/break-ui.spec.ts`
- Test: `tests/progressSeries.test.ts`, `tests/progressOption.test.ts`, `tests/inicio.test.tsx`

**Interfaces:**
- Consumes: `aggregate` con `'day'` (D2), `SegmentedControl`, `Panel`, `useTheme`, `useReducedMotion`, `accentVar`
- Produces:
  - `type RangeKey = '12m' | '6m' | '3m' | '30d'` y `type Metric = 'dist' | 'elev' | 'time' | 'speed'`
  - `progressWindow(range: RangeKey, now: number): { period: Period; from: number; to: number; prevFrom: number; prevTo: number; cumulative: boolean }`. Solo periodos completos: `'12m'` son 12 meses; `'6m'` y `'3m'`, 26 y 13 semanas ISO; `'30d'`, 30 días acumulados. Todos terminan justo antes del periodo en curso.
  - `type ProgressSeries = { rows: { label: string; current: number | null; previous: number | null }[]; total: number; previousTotal: number; summary: string; ariaLabel: string; sparse: boolean; hint: string | null; note: string }`
  - `progressSeries(acts: StoredActivity[], range: RangeKey, metric: Metric, now: number): ProgressSeries`
    - `previous` sale de `aggregate` sobre `[prevFrom, prevTo]`, alineado por posición.
    - La velocidad de un periodo sin salidas es `null`. En `'30d'`, la velocidad es la acumulada: Σ distancia / Σ tiempo.
    - `sparse` vale `true` con menos de 2 periodos con salidas.
  - `type ChartTheme = { font: string; fig: string; ink3: string; line: string; lineStrong: string; surface: string; surface2: string; accent: Record<Metric, string>; good: string; ink2: string; glow: number; areaTop: number }`
  - `chartTheme(read: (token: string) => string): ChartTheme`. `areaTop` es 0,34 si `glow` > 0 y 0,2 si no.
  - `buildProgressOption(series: ProgressSeries, metric: Metric, theme: ChartTheme, motion: { animate: boolean; firstLoad: boolean }): EChartsCoreOption`
  - `ProgressChart({ series, metric })`: mantiene `figure.chart`, `.chart-canvas` con `role="img"` y `aria-label={series.ariaLabel}`, y `<details>` con `<summary>Ver como tabla</summary>` y una tabla con las columnas Periodo (`th scope="row"`), Actual, Anterior y Diferencia («—» si no hay anterior). Encima, en una sola línea: la frase resumen y la leyenda en línea («12 meses» continua y «Los 12 anteriores» discontinua). La nota del periodo («Meses completos. Noviembre va en tus cifras de la semana.») va en el tooltip y en el `caption` de la tabla, no como texto suelto.
  - Inicio: solo el `SegmentedControl` «Periodo de la gráfica» (12 meses, 6 meses, 3 meses y 30 días), a la derecha del título; en el móvil es una sola fila con desplazamiento horizontal. **No hay control «Métrica de la gráfica»**: la métrica la eligen las `KpiCard` del hero (tarea 5) y la gráfica toma el color de su acento.

- [ ] **Step 1: pruebas que fallan**
  - `progressSeries.test.ts`, con `NOW`:
    - `12 meses uses the 12 complete months`: de `'nov 2025'` a `'oct 2026'`;
    - `6 meses uses 26 complete weeks`: 26 filas, de `'4 may'` a `'26 oct'`;
    - `3 meses uses 13 complete weeks`: de `'3 ago'` a `'26 oct'`;
    - `30 días is cumulative by day`: 30 filas, de `'7 oct'` a `'5 nov'`, sin bajar nunca;
    - `previous series is aligned by position`;
    - `summary compares with the previous 12 months`: 100 km en cada mes de nov 2024 a oct 2025 y 115 km en cada mes de nov 2025 a oct 2026 dan `'1.380 km en 12 meses, un 15 % más que en los 12 anteriores.'` y un `ariaLabel` que empieza por `'Distancia por mes, 12 meses completos. '`;
    - `30 días aria label`: empieza por `'Distancia acumulada por día, 30 días completos. '`;
    - `no rides gives Sin salidas en este periodo.`;
    - `fewer than 2 complete periods with rides is sparse`: `hint` = `'Con 2 meses de salidas verás tu tendencia.'` (con semanas, `'Con 2 semanas…'`);
    - `speed of an empty period is null`.
  - `progressOption.test.ts`:
    - `current line is smooth and monotone with a gradient area`: `smooth` 0,35, `smoothMonotone 'x'` y `areaStyle.color.type 'linear'`;
    - `previous line is dashed ink-3 and silent`: `lineStyle.type` `[5, 4]` y `silent: true`;
    - `bubble on the last point formats es-ES`: `markPoint.data[0].coord[0]` es el último índice y el `formatter` da `'115 km'`;
    - `glow only when the theme glows`: `shadowBlur` 14 con `glow` 0,55 y 0 con `glow` 0;
    - `y axis starts at 0 with es-ES labels`: `min: 0` y `axisLabel.formatter(2000)` = `'2.000'`;
    - `y axis name per metric`: `'Desnivel (m)'` con `elev`;
    - `no animation with reduced motion`;
    - `first load 900 ms, updates 280 ms`;
    - `tooltip carries the period note`: el `formatter` del tooltip termina con la nota.
  - `inicio.test.tsx`:
    - simulaciones ampliadas;
    - `range switch uses complete periods`: los botones conservan `aria-pressed` y las filas son las de arriba;
    - `kpi cards switch the table to Desnivel`: al pulsar la `KpiCard` «Desnivel» (`aria-pressed` pasa a `true`), la fila `'oct 2026'` muestra Actual `'4.724 m'`;
    - `no metric segmented control`: `queryByRole('group', { name: 'Métrica de la gráfica' })` es `null`;
    - `theme change re-applies the chart option`: `setTheme('light')` vuelve a llamar a `setOption` del `init` simulado (con `vi.hoisted`).
- [ ] **Step 2:** `npx vitest run tests/progressSeries.test.ts tests/progressOption.test.ts tests/inicio.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
  - `echarts.ts` registra `LineChart`, `GridComponent`, `TooltipComponent`, `MarkPointComponent`, `MarkLineComponent` y `SVGRenderer`, y deja de registrar `BarChart`.
  - El efecto de `setOption` depende de `[chart, series, metric, theme, reduced]`, sin reinicializar.
  - `textStyle.fontFamily` es la familia real, y se llama a `chart.resize()` tras `document.fonts.ready`.
  - El redimensionado usa `ResizeObserver` sobre el contenedor.
  - Con `sparse`, la gráfica va en gris y el `hint` se ve encima.
  - Se aplica la skill `dataviz`.
- [ ] **Step 4:** actualizar `e2e/break-ui.spec.ts` según la tabla de cambios. Si la prueba «tabla de la gráfica de 30 días cabe en 320 px» sigue marcada con `test.fail`, quitar la marca cuando pase (`.chart details` con `overflow-x: auto`).
- [ ] **Step 5:** `npx vitest run && npx playwright test`. Esperado: PASS.
- [ ] **Step 6:** commit, previa confirmación.

### Task 7: Rendimiento, objetivo de la semana, Tus datos y Próximas salidas

Agente: `cycling-ui-designer`. Referencia: `inicio.js` (`renderStats`, `renderRing`, `renderWeek`), `inicio.html?fase=1` y la sección 5 del sistema de diseño (PerformanceCard, GoalRing, UpcomingList).

**Files:**
- Create: `src/ui/inicio/PerformanceCard.tsx`, `RangeBar.tsx`, `WeekBar.tsx`, `GoalRing.tsx`, `weekGoal.ts`, `YourDataCard.tsx`, `src/ui/components/UpcomingList.tsx`, `KmMarkerDate.tsx`
- Modify: `src/ui/pages/Inicio.tsx`, `src/ui/styles/inicio.css`, `src/ui/styles/routes.css`
- Test: `tests/weekGoal.test.ts`, `tests/performanceCard.test.tsx`, `tests/yourData.test.tsx`, `tests/upcoming.test.tsx`, `tests/inicio.test.tsx`

**Interfaces:**
- Consumes: `performanceSummary` (D3), `currentWeekVsAverage`, `useMeta` (D9), `daysAgoLabel`, `Panel`, `EmptyState`, `ValueText`
- Produces:
  - `weekGoal(current: PeriodTotals, avg: PeriodTotals, now: number): { status: 'ahead' | 'behind' | 'done' | 'noref'; pct: number; pacePct: number; diffPoints: number; doneM: number; targetM: number; expectedM: number; daysLeft: number }`. `pacePct` es la fracción de la semana ISO transcurrida en Madrid; `daysLeft = 7 − díaISO(now)`; `'noref'` si `avg.distanceM` es 0; `'done'` si `pct` ≥ 100.
  - `WeekBar({ goal })`, **la tarjeta de F1**: `Panel` «Tu semana» (`Bike`, acento `--acc-dist`, **sin lápiz**: en F1 no hay objetivos que editar) con el subtítulo «Distancia de esta semana frente a tu semana media». Cifra grande en cursiva («214 km»), «de una semana media de 191 km» y una barra de 8 px: carril `--track`, relleno `--acc-dist` hasta lo hecho, marca de 3 × 22 px en `--ink` en la media y marca más corta en `--ink-3` en el ritmo esperado. La escala llega a `max(hecho, media) × 1,12`, así que pasar del 100 % se ve como barra que rebasa la marca, nunca como un anillo lleno. Etiquetas en línea bajo las marcas: «media 191» y «a estas alturas, 136». Líneas: «Un 12 % por encima de tu semana media» (`--good`) o «Un N % por debajo de tu semana media», y «Quedan 2 días de semana» u «Hoy acaba la semana». La barra lleva `role="img"` con todo en su `aria-label`.
  - `GoalRing({ goal, title })`, **desde F3** (objetivo propio): anillo de 192 px con carril `--track` (3:1 sobre la tarjeta), curvas de nivel concéntricas, arco `--good` con halo × `--glow` y muesca en `pacePct`. Las cifras del centro («27 %» a 40 px y «214 de 800 km» a 13 px) son **HTML en px superpuesto al SVG**, no texto del SVG, para que no encojan con el anillo. Debajo, tres líneas:
    - estado: «Vas 27 puntos por delante del ritmo» o «Vas N puntos por detrás del ritmo» (en `--ink-2`), «Ya has superado tu media de la semana», o en `noref` «Sin referencia aún. Con salidas en las 4 semanas anteriores verás tu ritmo.»;
    - ritmo: «A estas alturas, tu media va por 62 km»;
    - días: «Quedan 2 días», o «Hoy acaba la semana».
    En móvil la tarjeta va a todo el ancho, con el anillo de 168 px junto al texto y **las tres líneas visibles**.
  - `RangeBar({ min, max, mean, value, accent, unit, srText })` y `rangePositions(min, max, mean, value): { meanPct: number; valuePct: number }` (limitadas a 0–100; con `min === max`, 50). La barra es tu rango de 12 meses: 4 px en el acento **al 100 %**; la media, una marca de 3 × 14 px en `--ink` con un anillo de `--surface`; los últimos 30 días, un punto de 12 px en `--ink` con anillo del acento. Las tres marcas pasan 3:1 (WCAG 1.4.11). Debajo, etiquetas en línea a 12 px: el mínimo, «media 820 m» anclada a su marca y el máximo; el mínimo se oculta si la media está por debajo del 22 % y el máximo si está por encima del 78 %, para que no choquen.
  - `PerformanceCard({ perf }: { perf: PerformanceSummary })`: `Panel` «Tu rendimiento» (`Activity`) con el subtítulo «Últimos 30 días frente a tu media de 12 meses». Cuatro filas: Velocidad media, Desnivel por salida, Cadencia media («en N de M salidas»; la fila no aparece con `cadence === null`) y Salida más larga («el 18 de octubre»). Cada delta lleva flecha y «+3 %» sin «vs tu media», para no chocar con la prueba `no delta without history`. Sin leyenda aparte: las etiquetas en línea de cada `RangeBar` la sustituyen, y el subtítulo pasa a «Últimos 30 días. La barra es tu rango de 12 meses.». Sin salidas en 30 días: «Sin salidas en los últimos 30 días.».
  - `YourDataCard({ rides, totalM, firstStart, lastImportAt, lastBackupAt, now })`: `Panel` «Tus datos». Filas:
    - «Importaste {daysAgoLabel}», con el chip «Al día» (≤ 7 días) o «Toca importar»;
    - «{N} salidas de bici», con «Desde {mes de año}» y el total en km;
    - «Copia de seguridad», con «La última, {daysAgoLabel}» o «Aún no has hecho ninguna», y el enlace «Hacer copia» a `/ajustes`.
  - `KmMarkerDate({ date }: { date: string /* YYYY-MM-DD */ })`: hito kilométrico con banda (día de la semana), número en dorsal y mes.
  - `type UpcomingItem = { id: string; date: string; title: string; distanceM?: number; elevGainM?: number; difficulty?: 'Suave' | 'Media' | 'Dura' | null; shape?: LatLng[] }`
  - `UpcomingList({ items, weekAvgDistanceM, now, planHref })`: `Panel` «Próximas salidas» (`Calendar`) con el pie «Próximos 7 días: 3 salidas, 206 km. Un 8 % más que tu semana media.». Sin elementos: `EmptyState` «Nada planificado para los próximos 7 días.» con el enlace «Planificar una salida». **Inicio no lo monta en F1**: lo montará F3.
  - Composición de Inicio en F1: fila 2 con Progresión (ancha), Rendimiento y «Tu semana» (`WeekBar`); fila 3 con Tu última salida y Tus datos. En el móvil, «Tu semana» (y en F3 «Tu objetivo») va a todo el ancho.

- [ ] **Step 1: pruebas que fallan**
  - `weekGoal.test.ts`, con los datos de `inicio.test`: `pct` 92, `pacePct` 65, `diffPoints` 27, `status 'ahead'`, `expectedM` ≈ 62.060, `daysLeft` 2. Además, `sunday has no days left`, `noref without history` y `done at 100 % or more`.
  - `goalRing.test.tsx` (se monta en F3, pero se prueba ya): `center figures are HTML, not svg text` (ningún `<text>` en el SVG) y `track uses the --track token`.
  - `performanceCard.test.tsx`, con un `PerformanceSummary` a mano:
    - `shows the four rows with es-ES figures`;
    - `cadence row hidden without sensor data`;
    - `cadence context says en 2 de 3 salidas`;
    - `longest ride shows its date`;
    - `range bar has a text alternative`;
    - `range bar labels the mean inline`: la fila de desnivel muestra «media 820 m»;
    - `range bar hides the min label when the mean is close to it`;
    - `deltas never say vs tu media`.
  - `yourData.test.tsx`:
    - `import and backup use the same relative days`: «Importaste hace 3 días» y «La última, hace 12 días»;
    - `no backup yet`;
    - `ride count and first month`.
  - `upcoming.test.tsx`: `km marker shows weekday, day and month`, `footer compares with the weekly average`, `empty state invites planning`.
  - `inicio.test.tsx`:
    - `F1 third row shows Tu última salida and Tus datos, not Próximas salidas`;
    - `week bar says Un 12 % por encima de tu semana media`: con 214 km hechos y una media de 191, la cifra «214 km», la línea y una barra `role="img"` cuyo nombre contiene «tu semana media es de 191 km»;
    - `F1 has no goal ring and no edit button`: ni `GoalRing` ni un botón «Editar objetivo»;
    - `performance card is a region named Tu rendimiento`.
- [ ] **Step 2:** `npx vitest run`. Esperado: FAIL en las nuevas.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run && npx playwright test`. Esperado: PASS; con 5.000 salidas, Inicio sigue por debajo de 3 s.
- [ ] **Step 5:** commit, previa confirmación.

### Task 8: Última salida: mapa oscuro con resplandor y perfil

Agente: `cycling-frontend-dev`. Referencia: `inicio.js` (`initMap`, `drawUnder`), `shell.js` (`renderProfile`, `renderLegend`) y las secciones 6 y 7 del sistema de diseño.

**Files:**
- Create: `src/ui/components/RideMapCard.tsx`, `RideMap.tsx`, `mapOptions.ts`, `ProfileChart.tsx`, `grade.ts`, `src/ui/styles/map.css`
- Modify: `src/ui/pages/Inicio.tsx`, `src/ui/format.ts`
- Delete: `src/ui/components/LastRide.tsx`
- Test: `tests/rideMap.test.tsx`, `tests/profileChart.test.tsx`, `tests/format.test.ts`, `tests/inicio.test.tsx`

**Interfaces:**
- Consumes: `ProfilePoint`, `profileFromTrack`, `profileExtent`, `useReducedMotion`, `ValueText`, `Panel`
- Produces:
  - `rideDayLabel(startTime: number, now: number): string`: «Hoy, viernes 6 de noviembre», «Ayer, jueves 5 de noviembre», «Jueves 29 de octubre» y, si el año no es el actual, «Jueves 29 de octubre de 2025».
  - `mapOptions(reduced: boolean, mobile: boolean): L.MapOptions`: `scrollWheelZoom: false`, `zoomControl: false`, `dragging: !mobile` y, con `reduced`, `zoomAnimation`, `fadeAnimation` y `markerZoomAnimation` a `false`.
  - `RideMap({ track }: { track: TrackPoint[] })`, cargado con `React.lazy`:
    - `div.ride-map` con `role="region"` y `aria-label="Mapa de la última salida"`;
    - teselas CyclOSM con su atribución;
    - tres polilíneas `interactive: false` con `className` `trace-halo` (9 px), `trace-core` (3 px) y `trace-thread` (1 px), cuyos colores pone el CSS;
    - un `circleMarker` `trace-start`;
    - botones de 44 px «Acercar» (`Plus`), «Alejar» (`Minus`) y «Pantalla completa» (`Maximize`), este último con la Fullscreen API y `invalidateSize()`;
    - `fitBounds` con `paddingTopLeft [150, 24]` en escritorio y 24 en móvil.
  - `type SteepSegment = { fromM: number; toM: number; cls: number }`: la misma forma que en el plan de F4; la clase va de −5 a 5 y las negativas cuentan como 0.
  - `GRADE_LABELS: Record<0 | 1 | 2 | 3 | 4 | 5, string>`: «Llano o bajada», «1–4 %», «4–7 %», «7–10 %», «10–16 %» y «16 % o más».
  - `gradeClass(pct: number): 0 | 1 | 2 | 3 | 4 | 5`, con cortes en < 1, < 4, < 7, < 10 y < 16.
  - `gradeStops(steep: SteepSegment[], totalM: number): { offset: number; cls: number }[]`: paradas duras.
  - `ProfileChart({ profile, steep, label, height })`, con `steep` opcional:
    - un solo `path` de área con `role="img"` y `aria-label={label}`;
    - sin `steep`, relleno del acento de desnivel; con `steep`, degradado horizontal de paradas duras `--g0`…`--g5`;
    - ejes en km, la cota máxima en cursiva y un tooltip al pasar el puntero («km 52,0, 992 m, 8,4 %»; sin `steep`, sin el porcentaje);
    - leyenda solo con las clases presentes.
  - `RideMapCard({ activity, track, now })`:
    - `Panel` «Tu última salida» (`MapPin`) con la fecha de `rideDayLabel`;
    - `.ride-name` solo si hay nombre;
    - placa de vidrio con Distancia (`formatKm(…, 1)`), Desnivel, Tiempo en movimiento y Velocidad media, más pulso y potencia solo si hay datos, cada cifra en `.stat-value` con `ValueText` y el icono de su acento. En móvil, la placa va bajo el mapa;
    - el mapa;
    - el perfil, con la etiqueta `Perfil de altitud: mínima X m, máxima Y m`.
    - Sin GPS: «Esta salida no tiene GPS, así que no tiene mapa.», las cifras y sin perfil.
  - CSS:
    - `.ride-map .leaflet-tile-pane { filter: var(--map-filter) }`, con `--map-filter: invert(1) hue-rotate(200deg) brightness(.7) contrast(1.1) saturate(.25)` en oscuro y `none` en claro;
    - una capa de tinte encima de las teselas: `map.createPane('tint')` con `zIndex` 250 (entre teselas, 200, y trazados, 400), `mix-blend-mode: multiply` y `pointer-events: none`, y dentro un `div.map-tint` de 10.000 px centrado con `background: var(--map-tint)` (azul noche `#A9BEF2` en oscuro, blanco en claro, que no cambia nada). El tinte va claro a propósito: con uno más oscuro los rótulos de las poblaciones dejan de leerse;
    - fondo `--map-under` con una textura de carreteras SVG;
    - `.trace-halo { stroke: var(--trace); stroke-opacity: calc(.55 * var(--glow)) }`;
    - `.trace-thread { stroke-opacity: calc(.85 * var(--thread)) }`;
    - atribución y controles legibles en oscuro, con contraste AA;
    - en `forced-colors`, el trazado en `Highlight`.

- [ ] **Step 1: pruebas que fallan**
  - `format.test.ts`: `rideDayLabel` con hoy, ayer, otro día y otro año.
  - `rideMap.test.tsx`:
    - `draws halo, core and thread polylines and a start marker`;
    - `zoom buttons have Spanish names`;
    - `mapOptions disables wheel zoom`;
    - `mapOptions turns animations off with reduced motion`;
    - `mapOptions disables dragging on mobile`;
    - `tint pane sits between tiles and tracks`: existe el pane `tint` con `zIndex` 250 y un `.map-tint` dentro.
  - `profileChart.test.tsx`:
    - `aria label is kept`;
    - `single accent fill without steep`;
    - `legend lists only present classes`;
    - `negative classes count as flat`;
    - `gradeClass thresholds`: 0,9 da 0; 1 da 1; 6,9 da 2; 7 da 3; 15,9 da 4; 16 da 5.
  - `inicio.test.tsx`: los cambios de la tabla y `last ride date says Ayer, jueves 5 de noviembre`.
- [ ] **Step 2:** `npx vitest run`. Esperado: FAIL en las nuevas.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run && npx playwright test`. Esperado: PASS, también la salida de 400 km con unos 26.700 puntos.
- [ ] **Step 5:** comprobar en `npm run dev`, con teselas reales y en los dos temas, que el filtro no invierte el trazado ni la atribución y que **los rótulos de las poblaciones se leen** en oscuro (en la captura del prototipo, «Terrassa» y «Castellar del Vallès»). Compararlo con `capturas/inicio-escritorio-oscuro.png` y `-claro.png`.
- [ ] **Step 6:** commit, previa confirmación.

### Task 9: Formas y perfiles de ruta: RouteShape, DifficultyChip y RouteCard

Agente: `cycling-ui-designer`. Referencia: `shell.js` (`SHAPES`, `shapeDense`, `simplify`, `shapePoints`, `renderShape`, `topo`), `inicio.html` (tarjeta de rutas IA), `rutas.html` y la sección 5 del sistema de diseño (RouteCard). Inicio no lo monta hasta F4.

**Files:**
- Create: `src/ui/routes/shape.ts`, `RouteShape.tsx`, `DifficultyChip.tsx`, `RouteCard.tsx`, `tests/fixtures/routes.ts` (sintético, en el mar)
- Modify: `src/ui/styles/routes.css`
- Test: `tests/shape.test.ts`, `tests/routeCard.test.tsx`

**Interfaces:**
- Consumes: `ProfileChart`, `SteepSegment`, `GRADE_LABELS`, `ProfilePoint`, `formatKm`, `formatMeters`, `formatDuration`
- Produces:
  - `shapePath(points: LatLng[], w: number, h: number, pad: number): { d: string; start: { x: number; y: number } }`: proyección equirectangular (x = lng · cos(latMedia), y = −lat), ajustada a la caja conservando la proporción y **simplificada con Douglas-Peucker** en píxeles de la caja (tolerancia `max(0,45, min(w, h) / 150)`). Es la **misma geometría que el mapa**: la miniatura de una salida en Historial tiene la forma de su trazado en «Tu última salida». Cada ruta se distingue por su forma (lazo con cola, ida y vuelta, ocho, costa alargada...), nunca un lazo genérico.
  - `RouteShape({ points, size }: { points: LatLng[]; size: number | 'fill' })`: `aria-hidden`, con curvas de nivel (`--contour`), `.shape-halo`, `.shape-core`, `.shape-thread` y un punto de salida.
  - `type DifficultyLevel = 'Suave' | 'Media' | 'Dura'`: los mismos valores que `Difficulty` en el plan de F4.
  - `DifficultyChip({ level }: { level: DifficultyLevel })`: «Suave para ti», «Media para ti» o «Dura para ti», con 1, 2 o 3 barras llenas y los tokens `--easy-*`, `--mid-*` y `--hard-*`.
  - `type RouteCardData = { id: string; name: string; distanceM: number; elevGainM: number; estTimeS: number | null; difficulty: DifficultyLevel | null; newPct: number | null; shape: LatLng[]; profile: ProfilePoint[]; steep: SteepSegment[]; why?: string }`. F4 lo construirá a partir de `GeneratedRoute`.
  - `RouteCard({ route, variant, onDownload, mapHref })`, con `variant: 'best' | 'normal' | 'compact'` y `onDownload` y `mapHref` opcionales:
    - `best`: borde `--action` al 50 %, chip «La que mejor encaja», cifra en cursiva y «Descargar GPX» como botón principal;
    - `compact`: forma de 36 px, nombre, km, m y la dificultad como texto con sus barras (`.dif`), **sin chip** (el chip ya está en la ruta principal), y un chevrón;
    - `feature` (Inicio): franja visual de 176 px con la forma grande sobre curvas de nivel en la mitad derecha y, encima a la izquierda con un velo, el chip de dificultad, el nombre, las cifras y una línea de por qué; el perfil a todo el ancho (leyenda solo para lectores de pantalla); **una sola acción principal**, «Ver ruta», a todo el ancho; y «Descargar GPX» como botón de icono de 40 px en la esquina de la franja, con `aria-label="Descargar GPX de {nombre}"`. Sin párrafo largo ni chip de carretera nueva;
    - `why`, en una nota violeta (`--acc-elev`);
    - sin `onDownload` ni `mapHref`, las acciones no aparecen;
    - el perfil es un `ProfileChart` con `steep` y la etiqueta «Perfil: 42,0 km y 640 m de desnivel. Tramo más duro: 7–10 %».
- [ ] **Step 1: pruebas que fallan**
  - `shape.test.ts`: `path stays inside the box`, `douglas-peucker keeps the corners of an L`, `a 26.700-point track becomes fewer than 200 vertices`, `single point does not produce NaN` y `keeps aspect ratio`.
  - `routeCard.test.tsx`:
    - `best variant shows La que mejor encaja`;
    - `difficulty chip has text and bars`;
    - `new road chip says 74 % carretera nueva`;
    - `why note only when provided`;
    - `actions only when handlers are given`;
    - `feature variant has one primary action and a GPX icon button`: un solo `.btn-primary` («Ver ruta») y un botón «Descargar GPX de …»;
    - `compact rows have no chip`: ningún `.chip` dentro de una fila `compact`, y la dificultad sigue como texto;
    - `no raster images`: ningún `<img>` dentro de la tarjeta;
    - `profile label names the hardest grade`.
- [ ] **Step 2:** `npx vitest run tests/shape.test.ts tests/routeCard.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Sin fotos de stock, nunca.
- [ ] **Step 4:** `npx vitest run`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 10: Importar y Ajustes

Agente: `cycling-frontend-dev`. Referencia: `importar.html`, `ajustes.html` y la sección 5 del sistema de diseño (Dropzone, ImportReport y Formulario de Ajustes).

**Files:**
- Create: `src/ui/components/ImportProgress.tsx`, `src/ui/styles/forms.css`
- Modify: `src/ui/components/Dropzone.tsx`, `ImportReportView.tsx`, `src/ui/pages/Importar.tsx`, `src/ui/pages/Ajustes.tsx`, `e2e/break-ui.spec.ts`
- Test: `tests/importar.test.tsx`, `tests/ajustes.test.tsx`

**Interfaces:**
- Consumes: `Importer` con fase y `signal` (D8), `ImportReport` con `noGps` y `withCadence`, `getMeta` con `lastBackupAt` (D9), `clearAllData` (D10), `ThemeToggle`, `Panel`, `StravaHowTo`, `daysAgoLabel`, `ValueText`
- Produces:
  - **Dropzone.**
    - Se conservan la región «Ficheros para importar», las etiquetas «Elegir el ZIP o ficheros» y «Elegir carpeta», el `accept` y los textos de ayuda que comprueban las pruebas.
    - Se añaden el título «Suelta aquí tu archivo de Strava», el icono `Upload` de 64 px, los chips `.zip`, `.fit`, `.gpx`, `.tcx` y `.gz`, y el fondo de curvas de nivel.
    - Al arrastrar, `data-over="true"`.
    - El `label` de elegir ficheros tiene aspecto de botón y es la alternativa de un toque (WCAG 2.5.7).
  - `ImportProgress({ fileLabel, done, total, phase, onCancel })`:
    - el `<progress>` nativo, que mantiene el rol y el atributo `value`, y una barra visual `aria-hidden` con `transform: scaleX`;
    - el porcentaje en dorsal y el texto «3 de 10» en su propio nodo;
    - los pasos «Abrir el archivo», «Leer y guardar las actividades» y «Terminar», con `aria-current="step"` en el actual;
    - el botón «Cancelar».
  - `ImportReportView`:
    - resumen en 4 cifras con los textos actuales («5 salidas nuevas», «2 ya estaban», «36 no son de bici, descartadas», «3 demasiado cortas, descartadas» y «1 con error»), las nuevas en `--good` y cursiva;
    - incidencias con icono, causa y acción: ficheros sin leer con `CircleAlert` en `--critical` y `.file-name`; salidas sin GPS con `TriangleAlert` en `--warning` («Una salida sin GPS: 12 de septiembre» o «N salidas sin GPS»; cuentan en los totales, sin mapa); cadencia con `Info` («Cadencia en 5 de las 13 salidas nuevas»);
    - la acción «Ir a Inicio» (`<a href="#/">`).
  - Importar: a la derecha, o debajo en móvil, `StravaHowTo` y el enlace «Pasos para pedir el archivo en Strava». Al cancelar, `role="status"` dice «Importación cancelada. Las salidas ya guardadas se quedan.».
  - Ajustes:
    - índice de secciones fijo `<nav aria-label="Secciones de Ajustes">`, oculto por debajo de 1024 px, con `aria-current` en la sección visible;
    - secciones Perfil (Nombre), Apariencia (`ThemeToggle`), Rutas e IA (los cuatro campos y las dos pruebas de conexión), Copia de seguridad (`id="copia"`) y Borrar datos;
    - las dos claves con un botón de mostrar u ocultar con `aria-pressed` y el `aria-label` «Mostrar la clave de OpenRouteService» o «Mostrar la clave de la IA»;
    - el resultado de una prueba de conexión fallida va bajo su campo, con `aria-invalid` y `aria-describedby`, sin cambiar sus textos;
    - en Copia de seguridad, «Última copia: {daysAgoLabel}» o «Aún no has hecho ninguna copia». «Incluir claves» sigue siendo una casilla (`role` implícito `checkbox`), aunque tenga aspecto de interruptor;
    - Borrar datos (`.danger-zone`): «Borrar todo» abre un `<dialog>` «Borrar todos los datos», con «Cancelar» y «Borrar»; al confirmar llama a `clearAllData()` y dice «Datos borrados.»;
    - barra de guardar fija con vidrio: «Sin cambios», «1 cambio sin guardar» o «N cambios sin guardar»; «Descartar», desactivado sin cambios; y «Guardar cambios», siempre activo. Al guardar dice «Cambios guardados.».
- [ ] **Step 1: pruebas que fallan**
  - `importar.test.tsx`:
    - `progress shows steps with the current one`: con la fase `'activities'`, `aria-current="step"` va en «Leer y guardar las actividades»;
    - `cancel aborts the import`: el importador recibe un `signal` que queda abortado y se ve el mensaje de cancelación;
    - `report lists rides without GPS`;
    - `report says cadence in N of M`.
    Las pruebas que ya existen siguen pasando, con `fullText` donde la cifra se separe.
  - `ajustes.test.tsx`:
    - los cambios de la tabla;
    - `key can be shown and hidden`;
    - `probe error is linked to the field`;
    - `save bar counts changes and discards`;
    - `delete all asks for confirmation`;
    - `last backup date is shown`: con `lastBackupAt` de hace 12 días, «Última copia: hace 12 días»;
    - `theme toggle lives in Apariencia`.
- [ ] **Step 2:** `npx vitest run tests/importar.test.tsx tests/ajustes.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Sin `Link` ni hooks del router.
- [ ] **Step 4:** actualizar `e2e/break-ui.spec.ts` («Guardar cambios» y «Cambios guardados.»). `npx vitest run && npx playwright test`. Esperado: PASS, también los 300 ficheros ilegibles a 320 px.
- [ ] **Step 5:** commit, previa confirmación.

### Task 11: Movimiento

Agente: `cycling-ui-designer`. Skills: `animate`, `choreograph` y `review-animations`. Referencia: la sección 8 del sistema de diseño.

**Files:**
- Create: `src/ui/styles/motion.css`
- Modify: `src/ui/scene/SceneSvg.tsx`, `src/ui/inicio/Hero.tsx`, `src/ui/components/ProgressChart.tsx`, `src/ui/components/SegmentedControl.tsx`, `src/ui/shell/MoreSheet.tsx`
- Test: `tests/motion.test.tsx`, `tests/motionCss.test.ts`

**Interfaces:**
- Consumes: `useReducedMotion`, `buildProgressOption` (`motion.firstLoad`)
- Produces:
  - `hasPlayedIntro(): boolean` y `markIntroPlayed(): void`, en `src/ui/theme/motion.ts`: una bandera de módulo, así que la intro solo se ve en la primera carga de Inicio de la sesión.
  - Carga de Inicio, el único momento orquestado:
    - la línea de luz y la línea de la progresión se dibujan con `stroke-dashoffset` (`pathLength="1"`) en `--dur-draw` (900 ms) y `--ease-out`;
    - después, la burbuja (`--dur-bubble`, 260 ms) y el rótulo de la cima con un fundido;
    - el resto no se anima al entrar.
  - Pulsar: `scale(.97)` en 160 ms en `.press`. Hover: color o fondo en 200 ms, solo con `(hover: hover) and (pointer: fine)`.
  - Segmentado: el indicador se mueve en 240 ms. Hoja «Más»: `translateY(100%)` a 0 en 320 ms con `--ease-drawer`, y el fondo con un fundido. Interruptor: 240 ms. Cargando: `LoaderCircle` gira en 1,1 s lineal. Barra de importación: `scaleX`.
  - Con movimiento reducido: sin trazo ni desplazamientos, solo un fundido de 200 ms en la intro; el pulsado se mantiene.
- [ ] **Step 1: pruebas que fallan**
  - `motion.test.tsx`:
    - `hero ridge gets the draw class only on first mount`;
    - `no draw class with reduced motion`;
    - `chart first load uses 900 ms and later updates 280 ms`.
  - `motionCss.test.ts` lee `src/ui/styles/*.css`:
    - `transitions only touch allowed properties`: `transform`, `opacity`, `stroke-dashoffset`, `color`, `background-color` y `border-color`;
    - `keyframes only animate transform, opacity or stroke-dashoffset`;
    - `motion.css has a prefers-reduced-motion block`.
- [ ] **Step 2:** `npx vitest run tests/motion.test.tsx tests/motionCss.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar. Sin entradas escalonadas por tarjeta y sin animar acciones de teclado.
- [ ] **Step 4:** `npx vitest run`. Esperado: PASS. Pasar `review-animations` sobre los ficheros tocados y corregir lo que señale.
- [ ] **Step 5:** commit, previa confirmación.

### Task 12: QA visual y cierre

Agente: `cycling-qa`. Skills: `web-design-guidelines`, `break-ui`, `review-animations` y `superpowers:verification-before-completion`.

**Files:**
- Create:
  - `e2e/helpers/checks.ts`: `expectNoHorizontalScroll`, `expectNoTextUnder(page, px)` y `trackConsoleErrors(page)`, que pasan aquí desde `break-ui.spec.ts`;
  - `e2e/fixtures/demo.ts`: datos sintéticos que siguen la historia del prototipo, descrita en la sección 10 del sistema de diseño (hoy es viernes 6 de noviembre de 2026; la última salida, el jueves 5, con 87,6 km, 1.542 m y 3 h 12 min; la más larga, de 112 km, el 18 de octubre; salidas desde marzo de 2024; importación hace 3 días y copia hace 12; nombre «Fran»; lazo en el mar);
  - `e2e/visual.spec.ts`.
- Modify: `e2e/break-ui.spec.ts` (usa los helpers), `docs/verificaciones.md` (sección «Rediseño visual»)

- [ ] **Step 1:** `e2e/visual.spec.ts`. Siembra `demo.ts` con el mismo `seed` de IndexedDB, fija la fecha con `page.clock`, bloquea `tile-cyclosm` y fuerza el tema con `addInitScript` (`localStorage.setItem('fbt-theme', …)`). Hace una captura por caso en `test-results/visual/`:
  - Inicio, Importar y Ajustes, en 1440 × 900 y 390 × 844, en oscuro y en claro (12 capturas);
  - Inicio en tableta (1100 × 900), sin salidas (escritorio oscuro y móvil claro), con movimiento reducido (`reducedMotion: 'reduce'`) y con la hoja «Más» abierta en móvil;
  - Importar en curso, con un importador detenido en `3 de 10`.
  En cada captura se exige: sin desplazamiento horizontal, sin errores de consola y ningún texto por debajo de 12 px.
- [ ] **Step 2:** `npx playwright test e2e/visual.spec.ts`. Esperado: PASS.
- [ ] **Step 3:** comparar cada captura con su pareja de `docs/design/prototipo-final/capturas/`. Para Inicio, con `inicio-fase1-oscuro.png`; para lo demás, sin tener en cuenta lo que llega después de F1. En `docs/verificaciones.md`, anotar por pantalla lo que coincide y lo que diverge (composición, tipografía, color, brillo solo en los datos, tema claro, móvil). Las divergencias que rompen la dirección visual vuelven a la tarea que las originó como corrección.
- [ ] **Step 4:** cuando el usuario apruebe el aspecto, convertir las capturas de escritorio y móvil de Inicio, Importar y Ajustes en referencias con `toHaveScreenshot({ maxDiffPixelRatio: 0.01 })` y generarlas con `--update-snapshots`.
- [ ] **Step 5:** pasar `web-design-guidelines` sobre `src/ui/`, `break-ui` sobre Inicio, Importar y Ajustes (nombres larguísimos, otros alfabetos, 0 y 5.000 salidas, 400 km, texto al 200 %, 320 px) y `review-animations`. Corregir lo que rompa el uso y anotar el resto.
- [ ] **Step 6:** verificación final: `npx vitest run && npx tsc --noEmit && npm run build && npx playwright test`. Esperado: todo PASS. Además:
  - en `dist/assets`, el chunk de entrada no contiene `echarts` ni `leaflet` (`grep`);
  - Inicio se pinta en menos de 3 s con 5.000 salidas;
  - la URL de las teselas contiene `tile-cyclosm`;
  - la base sigue llamándose `ciclismo`.
- [ ] **Step 7:** `code-simplifier` sobre los ficheros tocados, repetir el paso 6 y proponer el mensaje de commit. Commit solo con confirmación.

---

## Lotes

**Lote A: datos.** Toca `src/metrics`, `src/import`, `src/db` y `src/backup`. Necesita que el usuario apruebe D1–D3 y D8–D10.

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-rediseno-visual.md', ui: false, tasks: [
  { n: 1, agent: 'cycling-metrics-analyst' }, { n: 2, agent: 'cycling-data-engineer' } ] } })
```

**Lote B: base visual.** Tokens, armazón, hero y gráfica. Necesita el lote A (D1 y D2).

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-rediseno-visual.md', ui: true, tasks: [
  { n: 3, agent: 'cycling-ui-designer' }, { n: 4, agent: 'cycling-ui-designer' },
  { n: 5, agent: 'cycling-ui-designer' }, { n: 6, agent: 'cycling-frontend-dev' } ] } })
```

**Lote C: tarjetas y pantallas.** Necesita el lote B y, del lote A, D3, D8, D9 y D10.

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-rediseno-visual.md', ui: true, tasks: [
  { n: 7, agent: 'cycling-ui-designer' }, { n: 8, agent: 'cycling-frontend-dev' },
  { n: 9, agent: 'cycling-ui-designer' }, { n: 10, agent: 'cycling-frontend-dev' } ] } })
```

**Lote D: movimiento y cierre.**

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-rediseno-visual.md', ui: true, tasks: [
  { n: 11, agent: 'cycling-ui-designer' }, { n: 12, agent: 'cycling-qa' } ] } })
```

## Relación con los planes siguientes

- **F2:** Historial e Inicio usan `ProfileChart` con `steep` en cuanto exista D4 (`gradeSegments`, que devuelve `SteepSegment[]`). El buscador local entra en la barra del hero, y Historial se añade al menú y a la barra inferior (se actualiza `app.test`). En el móvil, Historial (ver `historial.html`) quita el subtítulo y deja **una sola fila de herramientas**: una lupa de 44 px que despliega el buscador en esa misma fila (con «Cerrar la búsqueda» y Esc para plegarlo), el periodo como `SegmentedControl` y el orden como botón de icono con el `select` nativo encima; las cifras del mes van en **una tira horizontal compacta** dentro de una sola tarjeta («Tiempo» en lugar de «En movimiento», «3,2 de media»), de modo que la lista de salidas se ve en la primera pantalla.
- **F3:** Inicio monta `UpcomingList` y `GoalRing` sustituye a `WeekBar` para medir el objetivo propio, con el lápiz «Editar objetivo». Calendario va al menú y a la hoja «Más».
- **F4:** su plan usa `RouteCard`, `RouteShape`, `ProfileChart` y `DifficultyChip` de este plan, en lugar de los suyos, y su `SlopeProfile` pasa a ser `ProfileChart` en SVG, no ECharts. Hace falta D6 para la tarjeta de rutas en Inicio. En el móvil, cuando ya hay rutas, el formulario se pliega en una barra resumen «90 km · 1.500 m · Circular · Editar» (botón con `aria-expanded`) y las rutas van primero; al generar de nuevo, el formulario se pliega y el foco pasa al título de los resultados (ver `rutas.html`).
- **F5:** `RouteCard` recibe `why` y Rutas muestra la nota de qué ha visto la IA.
- **Decisión abierta:** el tema «Sistema». Si se aprueba, el script de `index.html` añade la rama de `prefers-color-scheme` y `ThemeToggle` pasa a tener tres opciones.
