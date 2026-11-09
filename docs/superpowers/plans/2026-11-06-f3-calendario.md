# F3: calendario. Plan de implementación

> **Prioridad móvil (2026-11-07).** Rige `docs/requisito-mobile-first.md`. Las pantallas de este plan se implementan siguiendo el prototipo móvil `docs/design/prototipo-movil/` (README, kit `movil.css`/`movil.js` y la página correspondiente), que prevalece sobre las descripciones de interfaz de este plan si chocan. La lógica, las interfaces y las pruebas del plan siguen vigentes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** planificar entrenos y objetivos, ver cómo cada salida importada marca su día como hecho y seguir el progreso hacia cada objetivo. Hay dos clases de objetivo: de evento, con fecha («Marcha 120 km / 2.000 m · 14 dic»), y de volumen por semana o por mes («400 km este mes», «5.000 m de desnivel en noviembre»).

**Architecture:**
- Los entrenos y los objetivos viven en dos tablas nuevas de Dexie (versión 3), `calendar` y `goals`. Solo existen en la app, así que van en la copia de seguridad.
- `Goal` es una unión discriminada por `kind`: `'event'` o `'volume'`. Las dos clases comparten tabla y una sola función de validación, `isValidGoal`, que usan el repositorio y la copia.
- Al terminar una importación, `syncCalendar` marca como hechos los entrenos pendientes que tienen una salida ese día. El progreso de un objetivo es una función pura sobre las salidas: `goalProgress` para eventos y `volumeProgress` para volumen, que reutiliza `aggregate` de F1.
- Las fechas del calendario son días locales de Madrid, guardados como texto `yyyy-MM-dd`. Diseño provisional.

**Tech Stack:** el de F1, sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md` (decisión 3: el calendario y los objetivos se protegen con «Exportar copia» y «Restaurar»), `docs/propuesta-ciclismo.html` (tarjetas «Tu objetivo» y «Próximas salidas»).

**Requisito previo:** F2 completa: Dexie en versión 2 y ruta `#/historial/:id`. También `src/backup/backup.ts` de la tarea 11 de F1.

## Global Constraints

- Las restricciones globales de F1 siguen vigentes: repositorio público sin claves, `HashRouter`, zona `Europe/Madrid`, unidades en SI con formato `es-ES`, textos en castellano sin emojis, fixtures sintéticos.
- `LocalDate` es un texto `yyyy-MM-dd` con el día local de Madrid. Una salida pertenece al día local de su `startTime`.
- Las semanas del calendario empiezan en lunes.
- Los formularios piden km y m; se guarda en metros.
- Hecho: un entreno pendiente pasa a hecho si hay cualquier salida ese día, y se enlaza la primera. Si el usuario lo marca o lo desmarca a mano (`manual: true`), la sincronización no lo vuelve a tocar.
- Progreso del objetivo de evento: mejor salida de las últimas 8 semanas, sin pasar de la fecha del objetivo.
- Objetivo de volumen: suma de las salidas del periodo (semana ISO de lunes a domingo, o mes natural) en Madrid. Su `start` es el lunes o el día 1 del periodo, y tiene al menos una meta: `distanceM`, `elevGainM` o `movingTimeS`.
- Ritmo esperado de un objetivo de volumen: lineal sobre el tiempo real del periodo, en ms, de 00:00 de Madrid del primer día a 00:00 del siguiente periodo. Un mes con cambio de hora dura 743 o 745 h. «Por delante» o «por detrás» es `pct − expectedPct`, en puntos.
- Los objetivos no tienen datos antiguos: la tabla `goals` nace en esta fase y `kind` es obligatorio.
- `BackupFile` sigue en `version: 1`; `calendar` y `goals` dejan de ser `unknown[]`.
- Fuera de F3: las etiquetas «Media para ti» y «Dura para ti», que van en F4.
- Skills: las de F1. Al cerrar: `code-simplifier`, `web-design-guidelines` y `break-ui`.

## Review Focus

1. **Salida a las 00:30 de Madrid** (23:30 UTC del día anterior): marca el día local. Lo cubre la tarea 2, prueba `ride at 00:30 madrid marks that day`.
2. **El usuario desmarca un entreno marcado automáticamente y vuelve a importar:** sigue desmarcado. Lo cubre la tarea 3, prueba `manual unmark survives sync`.
3. **Restaurar la copia en un navegador sin salidas:** los entrenos hechos siguen hechos y no hay enlaces rotos. Lo cubren la tarea 4 (`round trip restores calendar and goals`) y la tarea 5 (`done workout with missing activity shows done without link`).
4. **Copia con un entreno mal formado:** se rechaza y el calendario no cambia. Lo cubre la tarea 4, prueba `invalid workout rejects and leaves calendar untouched`.
5. **Entreno creado para un día pasado que ya tenía salida:** se marca como hecho. Lo cubren la tarea 3 (`past workout with ride is marked on sync`) y la tarea 5 (`saving a past workout with a ride marks it done`).
6. **Límites del periodo de volumen:** una semana ISO que cruza de mes cuenta los dos lados, la salida a las 00:30 del día 1 cuenta en el mes nuevo y el ritmo esperado de octubre usa 745 h. Lo cubre la tarea 2, pruebas `iso week crossing month counts both sides`, `volume month sums rides in madrid month` y `month with dst change uses real hours`.
7. **Copia con un objetivo de volumen mal formado** (sin meta, o con `start` que no es lunes ni día 1): se rechaza y los objetivos no cambian. Lo cubren la tarea 1 (`isValidGoal rejects bad volume goals`) y la tarea 4 (`invalid volume goal rejects and leaves goals untouched`).

## Lotes para develop-phase

Lote A, datos y métricas:

    Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f3-calendario.md', tasks: [
      { n: 1, agent: 'cycling-data-engineer' }, { n: 2, agent: 'cycling-metrics-analyst' },
      { n: 3, agent: 'cycling-data-engineer' }, { n: 4, agent: 'cycling-data-engineer' } ] } })

Lote B, pantallas y cierre:

    Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f3-calendario.md', ui: true, tasks: [
      { n: 5, agent: 'cycling-frontend-dev' }, { n: 6, agent: 'cycling-frontend-dev' },
      { n: 7, agent: 'cycling-qa' } ] } })

---

## Estructura de ficheros

    src/domain/types.ts               LocalDate, PlannedWorkout, EventGoal, VolumeGoal, Goal
    src/db/db.ts                      Dexie versión 3
    src/calendar/calendarRepo.ts      entrenos, objetivos e isValidGoal
    src/calendar/sync.ts              marcar hecho a partir de las salidas
    src/metrics/calendar.ts           día local, emparejado, progreso de evento y de volumen
    src/backup/backup.ts              copia con calendario y objetivos
    src/ui/calendarGrid.ts            rejilla del mes
    src/ui/pages/Calendario.tsx       calendario y sección Objetivos
    src/ui/components/WorkoutForm.tsx  GoalForm.tsx  GoalCard.tsx  UpcomingWorkouts.tsx
    e2e/calendario.spec.ts

---

### Task 1: Tipos, Dexie versión 3 y repositorio del calendario

**Agente:** `cycling-data-engineer`

**Files:**
- Create: `src/calendar/calendarRepo.ts`
- Modify: `src/domain/types.ts`, `src/db/db.ts`
- Test: `tests/calendarRepo.test.ts`

**Interfaces:**
- Produces:
  - `type LocalDate = string /* yyyy-MM-dd, Europe/Madrid */`
  - `type PlannedWorkout = { id: string; date: LocalDate; title: string; distanceM?: number; elevGainM?: number; notes?: string; done: boolean; activityId?: string; manual: boolean; createdAt: number }`
  - `type EventGoal = { kind: 'event'; id: string; title: string; date: LocalDate; distanceM?: number; elevGainM?: number; createdAt: number }`
  - `type VolumeGoal = { kind: 'volume'; id: string; title: string; period: 'week' | 'month'; start: LocalDate /* lunes o día 1 */; distanceM?: number; elevGainM?: number; movingTimeS?: number; createdAt: number }`. `period` coincide con `Period` de `src/metrics/aggregate.ts`, pero se escribe literal para que `domain` no dependa de `metrics`.
  - `type Goal = EventGoal | VolumeGoal`
  - Dexie `version(3)`: añade `calendar: 'id, date'` y `goals: 'id, kind'`. Las demás tablas no cambian.
    - Decisión: no hay campo `sortDate` común ni índice de fecha en `goals`. Un campo copiado de `date` o `start` podría desincronizarse y la copia tendría que validarlo. Como los objetivos son pocos, `listGoals` los lee todos y los ordena en memoria con `goalSortDate`.
  - `goalSortDate(g: Goal): LocalDate`: `date` en un evento, `start` en un objetivo de volumen.
  - `isValidGoal(x: unknown): x is Goal`: `id` y `title` de texto no vacíos y `createdAt` numérico.
    - Evento: `date` con `/^\d{4}-\d{2}-\d{2}$/` y al menos un `distanceM` o `elevGainM` numérico mayor que 0.
    - Volumen: `period` es `'week'` o `'month'`; `start` tiene el formato anterior y es lunes en `week` o día 1 en `month`; al menos un `distanceM`, `elevGainM` o `movingTimeS` numérico mayor que 0.
    - Cualquier otro `kind`, o ninguno, da `false`.
  - `newId(): string`, con `crypto.randomUUID()`
  - `saveWorkout(w: PlannedWorkout): Promise<void>`, `deleteWorkout(id: string): Promise<void>`
  - `listWorkouts(range?: { from: LocalDate; to: LocalDate }): Promise<PlannedWorkout[]>`, por fecha
  - `setWorkoutDone(id: string, done: boolean): Promise<void>`: pone `manual: true`; con `done: false` borra `activityId`.
  - `saveGoal(g: Goal): Promise<void>`: lanza `Error('invalid goal')` si `!isValidGoal(g)`.
  - `deleteGoal(id: string): Promise<void>`
  - `listGoals(): Promise<Goal[]>`, ordenados por `goalSortDate` y, si empatan, por `createdAt`.
  - Cada escritura guarda `calendarChangedAt = Date.now()` en `meta`.

- [ ] **Step 1: pruebas que fallan**, con fake-indexeddb:
  - `migrates v2 database keeping activities and analysis`: se crea `ciclismo` con el esquema de la versión 2 de F2, una actividad y una fila de `routeSigs`, y se cierra. Al abrir `CyclingDb` las dos siguen y `calendar` está vacía.
  - `lists workouts of a month ordered by date`: el rango `2026-11-01`..`2026-11-30` excluye un entreno del `2026-12-01`.
  - `setWorkoutDone false clears activity and marks manual`.
  - `goals ordered by date or period start`: un evento del `2026-12-14` y un objetivo mensual con `start` `2026-11-01` vuelven con el mensual primero.
  - `isValidGoal accepts event and volume goals`: un evento con solo `elevGainM`, un semanal con `start` `2026-11-30` (lunes) y solo `movingTimeS`, y un mensual con `start` `2026-11-01`.
  - `isValidGoal rejects bad volume goals`: da `false` en cada caso:
    - semanal con `start` `2026-11-04` (miércoles);
    - mensual con `start` `2026-11-02`;
    - volumen sin ninguna meta;
    - `period: 'year'`;
    - sin `kind`.
  - `saveGoal rejects invalid goal`: no se guarda nada.
  - `writes update calendarChangedAt`.
- [ ] **Step 2:** `npx vitest run tests/calendarRepo.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run tests/calendarRepo.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 2: Día local, emparejado y progreso de los objetivos

**Agente:** `cycling-metrics-analyst`

**Files:**
- Create: `src/metrics/calendar.ts`
- Test: `tests/calendarMetrics.test.ts`

**Interfaces:**
- Consumes: `StoredActivity`, `PlannedWorkout`, `EventGoal`, `VolumeGoal`, `LocalDate`, `TZ`, `aggregate` y `Period` de `src/metrics/aggregate.ts`
- Produces:
  - `localDay(t: number): LocalDate`
  - `dayRange(d: LocalDate): { from: number; to: number }`, de 00:00:00.000 a 23:59:59.999 en Madrid
  - `daysUntil(d: LocalDate, now: number): number`, en días de calendario de Madrid; es negativo si la fecha ya pasó.
  - `matchWorkouts(workouts: PlannedWorkout[], acts: StoredActivity[]): { id: string; activityId: string }[]`: solo los entrenos con `!done && !manual`, emparejados con la primera salida (por `startTime`) de su día local.
  - `GOAL_WINDOW_WEEKS = 8`
  - `type GoalProgress = { daysLeft: number; longest?: { activityId: string; distanceM: number; pct: number }; mostClimb?: { activityId: string; elevGainM: number; pct: number }; pct: number }`
  - `goalProgress(goal: EventGoal, acts: StoredActivity[], now: number): GoalProgress`. Ventana: `[fin − 8 semanas, fin]`, con `fin = min(now, dayRange(goal.date).to)`. `longest` solo existe si hay `distanceM` y `mostClimb` solo si hay `elevGainM`. Cada `pct` es el valor dividido por el objetivo, × 100, sin tope. El `pct` total es el menor de los definidos, o 0 si no hay salidas.
  - `periodStartOf(period: Period, d: LocalDate): LocalDate`: el lunes de su semana ISO o el día 1 de su mes.
  - `periodRange(period: Period, start: LocalDate): { from: number; to: number; days: number }`: `from` es 00:00 de Madrid de `start`; `to` es 00:00 de Madrid del siguiente periodo − 1 ms; `days` son los días de calendario (7, o 28 a 31).
  - `type VolumeKey = 'distanceM' | 'elevGainM' | 'movingTimeS'`
  - `type VolumeTarget = { key: VolumeKey; target: number; value: number; pct: number; expected: number; aheadPct: number }`
  - `type VolumeProgress = { status: 'future' | 'current' | 'past'; daysTotal: number; daysLeft: number; rides: number; targets: VolumeTarget[]; pct: number; expectedPct: number; aheadPct: number }`
  - `volumeProgress(goal: VolumeGoal, acts: StoredActivity[], now: number): VolumeProgress`
    - Suma con `aggregate(acts, goal.period, from, from)[0]`, con `from` y `to` de `periodRange(goal.period, goal.start)`. No hace falta otro corte por día.
    - `targets`: una entrada por cada meta definida, en el orden `distanceM`, `elevGainM`, `movingTimeS`. Cada una lleva:
      - `value`: lo sumado;
      - `pct = value / target × 100`, sin tope;
      - `expected = target × expectedPct / 100`;
      - `aheadPct = pct − expectedPct`.
    - `pct` total: el menor de `targets`. `aheadPct` total: `pct − expectedPct`.
    - `expectedPct`: `(clamp(now, from, to + 1) − from) / (to + 1 − from) × 100`. Da 0 antes del periodo y 100 después.
    - `status`: `future` si `now < from`, `past` si `now > to`, y `current` en otro caso.
    - `daysLeft`: días de calendario de Madrid desde hoy hasta el último día del periodo, los dos incluidos. Es `daysTotal` si el periodo es futuro y 0 si ya pasó.

- [ ] **Step 1: pruebas que fallan**
  - `localDay uses madrid`: 2026-11-14T23:30:00Z da `2026-11-15`, y 2026-07-14T22:30:00Z da `2026-07-15`.
  - `dayRange across dst`: `dayRange('2026-10-25')` dura 25 h − 1 ms.
  - `matches first ride of the day`: con dos salidas el mismo día se enlaza la más temprana.
  - `ride at 00:30 madrid marks that day`: una salida a las 2026-11-14T23:30:00Z empareja con el entreno del `2026-11-15` y no con el del `2026-11-14`.
  - `skips manual and done workouts`.
  - `longest ride in the last 8 weeks vs distance`: objetivo de 120 km; salidas de 96 km (hace 5 semanas) y 130 km (hace 10). Da `longest.distanceM` 96.000 y `pct` 80.
  - `pct is the lower of distance and elevation`: 96 km y 1.440 m frente a 120 km y 2.000 m dan `pct` 72.
  - `only distance target ignores elevation`: `mostClimb` es `undefined`.
  - `no rides gives 0`.
  - `days left in madrid days`: con `now` 2026-11-06T23:30:00Z y el objetivo el `2026-12-14`, `daysLeft` = 37.
  - `past goal uses rides up to its date`: no cuenta una salida posterior a la fecha, y `daysLeft` < 0.
  - `periodStartOf aligns to monday and day 1`:
    - `periodStartOf('week', '2026-12-03')` da `2026-11-30`;
    - `periodStartOf('week', '2026-11-30')` da `2026-11-30`;
    - `periodStartOf('month', '2026-11-17')` da `2026-11-01`.
  - `volume month sums rides in madrid month`: objetivo de noviembre de 2026 con 400 km.
    - Cuenta una salida a las 2026-10-31T23:30:00Z, que es el 1 de noviembre a las 00:30 en Madrid.
    - No cuenta una salida a las 2026-11-30T23:30:00Z, que es el 1 de diciembre en Madrid.
    - `rides` y `targets[0].value` solo suman las salidas de noviembre.
  - `iso week crossing month counts both sides`: objetivo semanal con `start` `2026-11-30`. Cuentan las salidas del `2026-11-30` y del `2026-12-03`; no cuentan las del `2026-11-29` ni las del `2026-12-07`. `daysTotal` = 7.
  - `month with dst change uses real hours`: objetivo de octubre de 2026 con `now` 2026-10-16T22:00:00Z (17 de octubre, 00:00 en Madrid). `expectedPct` ≈ 384 / 745 × 100 = 51,54, comprobado con `toBeCloseTo(51.54, 2)`. Una salida a las 2026-09-30T22:30:00Z (1 de octubre, 00:30) cuenta.
  - `volume pct per target and total is the lower`: 312 km de 400, 3.000 m de 5.000 y 10 h de 20 dan `pct` 78, 60 y 50, y `pct` total 50.
  - `expected pace says ahead or behind`: objetivo de noviembre con 400 km y `now` 2026-11-22T23:00:00Z (23 de noviembre, 00:00 en Madrid; han pasado 22 de 30 días).
    - `expectedPct` ≈ 73,33 y `targets[0].expected` ≈ 293.333.
    - Con 312 km, `aheadPct` ≈ 4,67, por delante.
    - Con 200 km, `aheadPct` ≈ −23,33, por detrás.
  - `volume days left counts today`: con `now` 2026-11-06T10:00:00Z, noviembre da `daysTotal` 30 y `daysLeft` 25.
  - `future and past periods`: con `now` 2026-11-06T10:00:00Z:
    - diciembre da `status` `future`, `expectedPct` 0 y `daysLeft` 31;
    - octubre da `status` `past`, `expectedPct` 100 y `daysLeft` 0.
  - `volume without rides gives 0`.
- [ ] **Step 2:** `npx vitest run tests/calendarMetrics.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar con `TZDate`, `startOfDay`, `endOfDay`, `startOfISOWeek`, `startOfMonth`, `addWeeks`, `addMonths` y `differenceInCalendarDays`, y `aggregate` para sumar.
- [ ] **Step 4:** `npx vitest run tests/calendarMetrics.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 3: Marcar hecho al importar

**Agente:** `cycling-data-engineer`

**Files:**
- Create: `src/calendar/sync.ts`
- Modify: `src/import/importService.ts`
- Test: `tests/calendarSync.test.ts`

**Interfaces:**
- Consumes: `listWorkouts`, `saveWorkout`, `listActivities`, `matchWorkouts`, `localDay`, `dayRange`
- Produces:
  - `syncCalendar(): Promise<number>`: toma los entrenos pendientes con fecha ≤ hoy, lee las salidas desde el primer día de esos entrenos hasta ahora y aplica `matchWorkouts`. A cada emparejado le pone `done: true`, `activityId` y `manual: false`. Devuelve cuántos marcó.
  - `importFiles` llama a `syncCalendar()` al final, después de `setLastImportAt`.

- [ ] **Step 1: pruebas que fallan**, con fake-indexeddb:
  - `import marks workout of that day`: con un entreno del `2026-01-04` (el día de `tests/fixtures/ride.gpx`), tras `importFiles([ride.gpx])` el entreno queda con `done: true` y la `activityId` de la salida guardada.
  - `past workout with ride is marked on sync`: con una salida ya guardada, se crea después el entreno de ese día y `syncCalendar()` devuelve 1.
  - `manual unmark survives sync`: tras `setWorkoutDone(id, false)`, `syncCalendar()` lo deja sin hacer.
  - `workout without ride stays pending`.
- [ ] **Step 2:** `npx vitest run tests/calendarSync.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run tests/calendarSync.test.ts tests/importService.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 4: Copia de seguridad con calendario y objetivos

**Agente:** `cycling-data-engineer`

**Files:**
- Modify: `src/backup/backup.ts`
- Test: `tests/backup.test.ts`, ampliado

**Interfaces:**
- Consumes: `BackupFile`, `exportBackup` y `restoreBackup` de la tarea 11 de F1, más `syncCalendar`
- Produces:
  - `BackupFile`: `calendar: PlannedWorkout[]; goals: Goal[]`, con `version: 1`.
  - `exportBackup` incluye las dos tablas y guarda `lastBackupAt = Date.now()` en `meta`.
  - `restoreBackup` valida cada entreno (`id` y `title` de texto, `date` con `/^\d{4}-\d{2}-\d{2}$/`, `done` y `manual` booleanos) y cada objetivo, de los dos tipos, con `isValidGoal` de la tarea 1. Si algo falla, lanza `BackupError('format')`. Si todo es válido, en una transacción guarda los ajustes y vacía y rellena `calendar` y `goals`. Después pone `lastBackupAt = Date.now()` y llama a `syncCalendar()`.
  - `getBackupMeta(): Promise<{ lastBackupAt?: number; calendarChangedAt?: number }>`
  - `needsBackup(m: { lastBackupAt?: number; calendarChangedAt?: number }): boolean`

- [ ] **Step 1: pruebas que fallan**
  - `round trip restores calendar and goals`: un entreno hecho con `activityId`, un objetivo de evento y uno de volumen semanal vuelven iguales en una base vacía.
  - `restore replaces existing calendar`: un entreno que no está en la copia desaparece.
  - `invalid workout rejects and leaves calendar untouched`: un entreno sin `date` da `BackupError('format')` y el calendario anterior sigue igual.
  - `invalid volume goal rejects and leaves goals untouched`: un objetivo de volumen sin meta da `BackupError('format')`, y otro mensual con `start` `2026-11-02` también. Los objetivos anteriores siguen igual.
  - `f1 backup with empty arrays restores`.
  - `export records lastBackupAt`.
  - `needsBackup when calendar changed after last export`: `{calendarChangedAt: 2, lastBackupAt: 1}` da `true`; `{calendarChangedAt: 1, lastBackupAt: 2}` da `false`; `{}` da `false`; `{calendarChangedAt: 1}` da `true`.
  - `restore clears the reminder`.
- [ ] **Step 2:** `npx vitest run tests/backup.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run tests/backup.test.ts`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 5: Calendario

**Agente:** `cycling-frontend-dev`

**Files:**
- Create: `src/ui/calendarGrid.ts`, `src/ui/pages/Calendario.tsx`, `src/ui/components/WorkoutForm.tsx`
- Modify: `src/App.tsx`
- Test: `tests/calendarGrid.test.ts`, `tests/calendario.test.tsx`

**Interfaces:**
- Consumes: el repositorio de la tarea 1, `syncCalendar`, `listActivities`, `localDay`, `getBackupMeta`, `needsBackup`
- Produces:
  - `monthGrid(month: string /* yyyy-MM */): LocalDate[][]`: las semanas, de lunes a domingo, que cubren el mes.
  - ruta `#/calendario`, con `?mes=yyyy-MM` opcional (por defecto, el mes actual en Madrid), y el enlace «Calendario» en el menú, después de «Historial».

- [ ] **Step 1: pruebas que fallan**
  - `calendarGrid.test.ts`:
    - `november 2026 starts on monday 26 oct`: la primera celda es `2026-10-26`, la última `2026-12-06` y hay 6 semanas.
    - `october 2026 has 25 oct once`: aparece una sola vez y todas las semanas tienen 7 días.
    - `february 2027 is exactly 4 weeks`.
  - `calendario.test.tsx`, con `vi.useFakeTimers({ toFake: ['Date'] })` en 2026-11-06T10:00:00Z:
    - `shows current month`: «noviembre de 2026».
    - `navigates months`: «Mes siguiente» lleva a «diciembre de 2026».
    - `adds workout from a day`: clic en el día 15; el formulario trae la fecha `2026-11-15`. Con «Título» «Coll d’Estenalles», «Distancia (km)» 72 y «Desnivel (m)» 1320, al pulsar «Guardar» se guarda con `distanceM` 72.000 y `elevGainM` 1.320.
    - `title is required`: «Pon un título», y no se guarda nada.
    - `shows ride and done workout on its day`: el día muestra «48 km» de la salida y «Hecho», con enlace a `#/historial/<activityId>`.
    - `done workout with missing activity shows done without link`.
    - `toggle done marks manual`: al desmarcar la casilla «Hecho», el entreno queda con `done: false` y `manual: true`.
    - `edits and deletes workout`: «Guardar» y «Borrar».
    - `saving a past workout with a ride marks it done`.
    - `backup reminder`: con `needsBackup` verdadero se ve «Tu calendario tiene cambios sin copia.», con el enlace «Exportar copia» a `#/ajustes`.
- [ ] **Step 2:** `npx vitest run tests/calendarGrid.test.ts tests/calendario.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
  - Título «Calendario».
  - Botones «Mes anterior», «Mes siguiente» y «Hoy».
  - Cada día es un botón con `aria-label` «Añadir entreno el 15 de noviembre».
  - Formulario con «Título», «Fecha», «Distancia (km)», «Desnivel (m)», «Notas», «Hecho», «Guardar», «Borrar» y «Cancelar».
  - Después de guardar se llama a `syncCalendar()`.
- [ ] **Step 4:** `npx vitest run tests/calendarGrid.test.ts tests/calendario.test.tsx tests/app.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 6: Objetivos y tarjetas de Inicio

**Agente:** `cycling-frontend-dev`

**Files:**
- Create: `src/ui/components/GoalForm.tsx`, `src/ui/components/GoalCard.tsx`, `src/ui/components/UpcomingWorkouts.tsx`
- Modify: `src/ui/pages/Calendario.tsx` (sección «Objetivos»), `src/ui/pages/Inicio.tsx`
- Test: `tests/objetivos.test.tsx`, `tests/inicio.test.tsx` (ampliado)

**Interfaces:**
- Consumes: `saveGoal`, `deleteGoal`, `listGoals`, `listWorkouts`, `goalProgress`, `volumeProgress`, `periodStartOf`, `daysUntil`, `localDay`
- Produces:
  - `GoalForm`: un selector «Tipo» con «Evento» (marcado por defecto) y «Volumen».
    - Evento: «Nombre», «Fecha», «Distancia (km)» y «Desnivel (m)».
    - Volumen: «Nombre», «Periodo» («Semanal» o «Mensual»), «Mes» (`type="month"`) o «Semana del» (`type="date"`, que se guarda como `periodStartOf('week', fecha)`), «Distancia (km)», «Desnivel (m)» y «Tiempo (h)». Por defecto, el periodo actual de Madrid.
    - Se guarda en metros y segundos.
  - `GoalCard`: según `goal.kind`.
    - Evento: igual que antes.
    - Volumen: una línea por meta, con el formato «Noviembre: 312 de 400 km · 78 % · vas 5 % por delante». Los porcentajes se redondean a entero; con 0 se lee «vas al día».
      - Etiqueta del periodo: el mes en mayúscula inicial («Noviembre»), o «Semana del 30 nov».
      - Unidades: km para distancia, m para desnivel y «12 h 30 min» para tiempo.
      - Debajo: «Quedan 8 días» (`daysLeft`); en un periodo futuro, «Empieza en 24 días» (`daysUntil(goal.start, now)`) sin ritmo; en uno pasado, «Terminado» sin ritmo.
      - La barra `role="progressbar"` usa el `pct` total, con tope en 100.
  - Tarjeta «Tu objetivo» de Inicio: el evento más cercano que no ha pasado y, si hay, los objetivos de volumen cuyo periodo contiene hoy en Madrid (como mucho uno semanal y uno mensual; si hay varios, el de `createdAt` más reciente). Se oculta si no hay ninguno.

- [ ] **Step 1: pruebas que fallan**, con `now` en 2026-11-06T23:30:00Z salvo que se diga otra cosa:
  - `creates goal`: con «Evento» marcado por defecto, «Nuevo objetivo» con «Nombre» «Marcha», «Fecha» 2026-12-14, 120 km y 2.000 m se guarda con `kind: 'event'` y `distanceM` 120.000.
  - `goal requires name and distance or elevation`: «Pon un nombre» e «Indica la distancia o el desnivel».
  - `goal form switches to volume`: al marcar «Volumen» aparecen «Periodo» y «Tiempo (h)», y desaparece «Fecha».
  - `creates monthly volume goal`: «Volumen», «Periodo» «Mensual» y «Mes» 2026-11, con «Distancia (km)» 400 se guarda con `{ kind: 'volume', period: 'month', start: '2026-11-01', distanceM: 400000 }`.
  - `weekly volume goal starts on monday`: «Semanal», con «Semana del» 2026-12-03 y «Desnivel (m)» 5000 se guarda con `start` `2026-11-30` y `elevGainM` 5.000.
  - `volume goal requires a target`: «Indica la distancia, el desnivel o el tiempo», y no se guarda nada.
  - `shows goal progress`: con salidas de 96 km y de 1.440 m dentro de las 8 semanas se ve:
    - «Marcha 120 km / 2.000 m · 14 dic»;
    - «Salida más larga: 96 km» y «Más desnivel en una salida: 1.440 m»;
    - «72 %» y «Faltan 37 días».
    - La barra tiene `role="progressbar"` con `aria-valuenow` 72, con tope en 100.
  - `past goal shows days since`: «Fue hace 3 días».
  - `shows volume progress ahead`: con `now` 2026-11-22T23:00:00Z y 312 km en noviembre frente a 400 se ve «Noviembre: 312 de 400 km · 78 % · vas 5 % por delante» y «Quedan 8 días». La barra tiene `aria-valuenow` 78.
  - `shows volume progress behind`: con la misma fecha y 200 km se ve «Noviembre: 200 de 400 km · 50 % · vas 23 % por detrás».
  - `volume goal with two targets shows one line each`: 400 km y 5.000 m dan dos líneas, y la barra usa el menor.
  - `future volume goal shows start`: diciembre muestra «Empieza en 24 días» y ningún «vas».
  - Inicio:
    - `shows nearest goal`: la tarjeta «Tu objetivo» muestra el objetivo de evento de fecha más cercana que no ha pasado.
    - `goal card shows current volume goal`: con un evento y los objetivos de volumen de noviembre y de diciembre, la tarjeta muestra el evento y noviembre, pero no diciembre.
    - `only volume goal shows goal card`: sin eventos, la tarjeta aparece con el objetivo de volumen del mes actual.
    - `shows next two workouts`: la tarjeta «Próximas salidas» muestra los 2 próximos entrenos pendientes, por ejemplo «sáb 15 nov», el título y «72 km · 1.320 m», con el enlace «Ver calendario» a `#/calendario`.
    - `no planned workouts invites to calendar`: «No tienes salidas planificadas.», con el enlace «Ver calendario».
    - `no goal hides goal card`: sin eventos futuros ni objetivos de volumen del periodo actual. Un objetivo de volumen de octubre no cuenta.
- [ ] **Step 2:** `npx vitest run tests/objetivos.test.tsx tests/inicio.test.tsx`. Esperado: FAIL.
- [ ] **Step 3:** implementar. En la sección «Objetivos» de Calendario se listan los dos tipos en el orden de `listGoals`.
- [ ] **Step 4:** `npx vitest run tests/objetivos.test.tsx tests/inicio.test.tsx`. Esperado: PASS.
- [ ] **Step 5:** commit, previa confirmación.

### Task 7: Extremo a extremo y cierre de fase

**Agente:** `cycling-qa`

**Files:**
- Create: `e2e/calendario.spec.ts`
- Modify: `docs/verificaciones.md`

- [ ] **Step 1: pruebas**, con `page.clock` en 2026-01-10T10:00:00Z:
  - `import marks the day in calendar`: en `#/calendario?mes=2026-01` se crea el entreno «Rodaje» el día 4. Se sube `tests/fixtures/ride.gpx` en `#/importar`. Al volver al calendario, el día 4 muestra «Hecho».
  - `backup keeps calendar`: «Exportar copia» (descarga), `indexedDB.deleteDatabase('ciclismo')` y recarga; con «Restaurar» vuelve a verse «Rodaje».
- [ ] **Step 2:** `npx vitest run && npx tsc --noEmit && npm run build && npx playwright test`. Esperado: todo PASS.
- [ ] **Step 3:** pasar `code-simplifier` sobre los ficheros de F3 y repetir el paso 2.
- [ ] **Step 4:** pasar `web-design-guidelines` y `break-ui` sobre Calendario e Inicio, con 20 entrenos en un día, un título de 200 caracteres, un objetivo de 1.000 km, un objetivo de volumen con las tres metas y 1.000 % de avance, un mes de 6 semanas y una pantalla de 360 px. Se corrige lo que rompe el uso.
- [ ] **Step 5:** comprobación manual con datos reales: crear un entreno en el día de una salida real, importarla y ver que se marca. Anotarlo en `docs/verificaciones.md`.
- [ ] **Step 6:** revisión final con `feature-dev:code-reviewer` y commit de cierre de F3, previa confirmación.
