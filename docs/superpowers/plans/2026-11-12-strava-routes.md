# Rutas de Strava (`routes/`) en la biblioteca: plan de implementación

> **Para agentes:** sub-skill obligatoria: superpowers:executing-plans (o subagent-driven-development). Pasos con casillas (`- [ ]`). Cada tarea con TDD: prueba que falla, código mínimo, prueba que pasa. **Sin commits**: el usuario confirma cada uno.

**Objetivo:** al importar la exportación «Descargar tu cuenta» de Strava (ZIP o carpeta), leer también `routes/` y guardar cada ruta planificada en la biblioteca (`ReferenceRoute`) como ruta propia con `origin: { kind: 'strava' }`, para que la fase A («Rutas cerca») las proponga primero.

**Arquitectura:** un lector nuevo (`src/import/stravaRoutes.ts`) recorre las entradas `routes/*` del mismo `ArchiveEntries` que ya se usa para las actividades y reutiliza `parseReferenceRoute`. El servicio de importación (`importService.ts`, que corre en el Worker) guarda cada ruta una a una con `saveStravaRoute`, descartando las ya importadas por una huella de la geometría. El informe gana `routesAdded` y la pantalla Importar lo muestra.

**Tecnología:** TypeScript, JSZip, @xmldom/xmldom, Dexie (sin cambio de esquema), Vitest, Playwright.

**Decisión de origen:** `docs/ESTADO.md`, «Retomar aquí (2026-11-12, noche)», decisión 5 (y 2: las rutas de Strava del usuario van antes que el motor propio).

## Supuestos sobre el formato (comprobar con el archivo real)

`docs/verificaciones.md` (paso 2) confirma que existen `routes/` y `routes.csv`, sin detalle. Lo demás sale de documentación pública y queda como supuesto:

1. `routes/` trae un GPX por ruta y los nombres son números correlativos (`routes/1.gpx`, `routes/2.gpx`…), no el id de Strava. **No sirven para detectar duplicados entre dos exportaciones.**
2. Strava exporta las rutas solo en GPX, con un único `<trk>` y `<trkseg>`, coordenadas y altura, sin horas. El nombre va en `<trk><name>` (y en `<metadata><name>`). Puede traer `<link href="https://www.strava.com/routes/…">`, que `parseReferenceRoute` ya guarda como `sourceUrl`, y `<author>`.
3. `<trk><type>` puede faltar o traer el deporte en texto (`Ride`, `cycling`, `Run`…) o en número. Solo se descartan las rutas cuyo tipo dice claramente que no son de bici (`/run|walk|hik|foot|trail|swim|ski/i`); un tipo ausente o numérico cuenta como bici, para no perder rutas.
4. Se aceptan también TCX (`parseReferenceRoute` ya los lee). FIT u otro formato en `routes/` se anota como «formato de ruta no soportado».
5. `routes.csv` no se lee: el GPX ya trae el nombre. Si el archivo real demuestra que el nombre solo está en el CSV, se añade en una tarea aparte.

## Restricciones globales

- Unidades SI. Todo en el navegador (Worker de importación). Sin cambio de esquema Dexie (la versión la puede subir la rama principal en paralelo).
- Fixtures sintéticos en el mar (lat 41.0, lng 2.5); nunca tracks ni archivos reales de Strava.
- Un fichero corrupto o desconocido se anota en `report.skipped` con su ruta y la importación sigue.
- Textos de la interfaz en castellano. Mobile-first: validar a 360 y 430 px.
- No tocar `src/routes/nearby.ts`, `waypointEngine.ts`, `diversity.ts`, `src/ai/*`, `RutasCerca.tsx`, `Catalogo.tsx`.

## Review Focus

1. **Reimportar la misma exportación** (o una nueva con las rutas renumeradas): ninguna ruta se duplica. Lo cubre la huella de geometría (Tarea 2) y la prueba de la Tarea 4.
2. **Una ruta vacía, con un solo punto, corrupta o en FIT**: va a `skipped` con `routes/N.gpx` y su causa; las demás rutas y todas las actividades se importan (Tareas 2 y 4).
3. **Cientos de rutas** (300 en la prueba): se guardan una a una, sin acumularlas en memoria, y la huella se carga una sola vez por importación (Tareas 1 y 4).
4. **Nombre de más de 120 caracteres o con emojis**: se recorta a ≤ 120 unidades UTF-16 sin partir un par sustituto, para que luego `saveReferenceRoute` (que exige ≤ 120) acepte editarla (Tarea 1).
5. **Exportación sin `routes/`**: el informe es idéntico al de antes con `routesAdded: 0` y la biblioteca no cambia (Tarea 4).

---

### Tarea 1: biblioteca — origen Strava, guardado y recorte del nombre

**Ficheros:**
- Modificar: `src/routes/library.ts`
- Prueba: `tests/stravaRoutesLibrary.test.ts` (nuevo)

**Interfaces:**
- Produce:
  - `ReferenceRoute.origin?: { kind: 'strava'; ref: string }`
  - `clipRouteName(value: string, max = 120): string` — recorta a `max` unidades UTF-16 sin dejar un sustituto alto suelto al final.
  - `stravaRouteRefs(): Promise<Set<string>>` — `ref` de las rutas guardadas con `origin.kind === 'strava'` (recorre la tabla con `each`).
  - `saveStravaRoute(parsed: ParsedReferenceRoute, ref: string): Promise<ReferenceRoute>` — `add` con id nuevo, `origin: { kind: 'strava', ref }`, `createdAt = updatedAt = now`.

- [ ] Prueba que falla: `clipRouteName('a'.repeat(119) + '😀')` tiene longitud 119 y no acaba en sustituto; un nombre de 200 letras queda en 120; `parseReferenceRoute` de un GPX con nombre de 130 emojis da `name.length <= 120` y es UTF-16 bien formado (`encodeURIComponent` no lanza).
- [ ] Prueba que falla: `saveStravaRoute(parsed, 'ref-1')` guarda `origin { kind: 'strava', ref: 'ref-1' }`; `stravaRouteRefs()` devuelve `{'ref-1'}` e ignora una ruta sin `origin`.
- [ ] Ejecutar `npx vitest run tests/stravaRoutesLibrary.test.ts`: falla por funciones inexistentes.
- [ ] Implementar; `parseReferenceRoute` usa `clipRouteName` en vez de `.slice(0, 120)` para el nombre.
- [ ] La prueba pasa, y también `tests/routeLibrary.test.ts`.

### Tarea 2: lector de `routes/`

**Ficheros:**
- Crear: `src/import/stravaRoutes.ts`
- Prueba: `tests/stravaRoutes.test.ts`

**Interfaces:**
- Consume: `ArchiveEntries`, `findActivitiesCsv` (`stravaArchive.ts`); `parseReferenceRoute`, `ParsedReferenceRoute` (`library.ts`).
- Produce:
  - `type ArchiveRouteItem = { ok: true; route: ParsedReferenceRoute; ref: string; file: string } | { ok: false; file: string; reason: string } | { ok: false; notCycling: true; file: string }`
  - `stravaRouteRef(route: Pick<ParsedReferenceRoute, 'points' | 'summary'>): string` — `${pointCount}|${lat0},${lng0}|${latN},${lngN}|${round(distanceM)}` con coordenadas a 5 decimales.
  - `readArchiveRoutes(entries: ArchiveEntries): AsyncGenerator<ArchiveRouteItem>` — carpeta base = la de `activities.csv` (o la raíz); entradas `base + 'routes/…'`, ignorando las ocultas (nombre que empieza por `.`) y `__MACOSX/`.

- [ ] Pruebas que fallan (GPX sintéticos en lat 41.0, lng 2.5 generados en la prueba):
  - lee `routes/1.gpx` y `routes/2.tcx` con nombre, `ref` y `file`;
  - con `export_1/activities.csv`, lee `export_1/routes/1.gpx`;
  - `routes/3.gpx` vacío, `routes/4.gpx` con un punto y `routes/5.fit` dan `ok:false` con causa (`'formato de ruta no soportado'` para el FIT) y no cortan la lectura;
  - `<type>Run</type>` da `notCycling`; `<type>cycling</type>`, `<type>1</type>` y sin tipo dan `ok`;
  - sin `routes/` no emite nada;
  - el mismo GPX con otro nombre de fichero da el mismo `ref`; otra geometría, otro.
- [ ] Ejecutar `npx vitest run tests/stravaRoutes.test.ts`: falla (módulo inexistente).
- [ ] Implementar. El tipo se lee con una expresión regular sobre el primer `<type>` tras `<trk`, para no analizar el XML dos veces. Los errores que no son `RouteLibraryError`/`ParseError` se anotan como `'El fichero no se ha podido leer.'`.
- [ ] La prueba pasa.

### Tarea 3: entradas del ZIP reutilizables

**Ficheros:**
- Modificar: `src/import/stravaArchive.ts`
- Prueba: `tests/stravaArchive.test.ts`

**Interfaces:**
- Produce: `zipEntries(zip: Blob): Promise<ArchiveEntries>` — las entradas del ZIP (sin carpetas), cada una se descomprime al pedirla. `readStravaArchive` la usa.

- [ ] Prueba que falla: `zipEntries` de un ZIP con `activities.csv` y `routes/1.gpx` devuelve esas dos claves y la lectura perezosa da el contenido.
- [ ] Implementar extrayendo el bucle de `readStravaArchive`. Las pruebas del fichero siguen en verde.

### Tarea 4: importación — guardar las rutas y contarlas

**Ficheros:**
- Modificar: `src/import/importService.ts`, `src/connections/intervalsSync.ts` (`emptyReport`)
- Prueba: `tests/importService.test.ts` (y añadir `routesAdded: 0` a los `toEqual` existentes y a los informes de `tests/importar.test.tsx`, `tests/importer.test.ts`)

**Interfaces:**
- Consume: `zipEntries`, `readArchiveEntries` (T3), `readArchiveRoutes` (T2), `stravaRouteRefs`, `saveStravaRoute` (T1).
- Produce: `ImportReport.routesAdded: number`.

- [ ] Pruebas que fallan:
  - ZIP con 1 salida y `routes/1.gpx`, `routes/2.gpx`: `routesAdded: 2`, la biblioteca tiene 2 rutas con `origin.kind === 'strava'`;
  - reimportar el mismo ZIP y otro con las rutas renumeradas: `routesAdded: 0` y siguen 2 rutas;
  - carpeta (`FolderFile`) con `routes/`: también se importan;
  - una ruta corrupta: `skipped` contiene `{ file: 'routes/3.gpx', reason }` y la salida y las otras rutas se guardan;
  - 300 rutas distintas: `routesAdded: 300`;
  - exportación sin `routes/`: el informe de siempre con `routesAdded: 0`.
- [ ] Ejecutar `npx vitest run tests/importService.test.ts`: falla.
- [ ] Implementar: `importArchive` recibe `() => Promise<ArchiveEntries>`; dentro del mismo `try`, tras las actividades, carga `stravaRouteRefs()` una vez y por cada ruta `ok` no conocida llama a `saveStravaRoute` y añade su `ref` al conjunto; `notCycling` se ignora (no son salidas); los errores van a `skipped`. Las rutas no cuentan en el progreso.
- [ ] Pasan `tests/importService.test.ts`, `tests/importar.test.tsx`, `tests/importer.test.ts`.

### Tarea 5: pantalla Importar — cuántas rutas se han añadido

**Ficheros:**
- Modificar: `src/ui/components/ImportReportView.tsx`
- Prueba: `tests/importar.test.tsx`, `e2e/import.spec.ts`

- [ ] Prueba que falla (vitest): con `routesAdded: 3` aparece «3 rutas de Strava añadidas a tu biblioteca»; con 1, «1 ruta de Strava añadida a tu biblioteca»; con 0 no aparece. Con `added: 0, routesAdded: 2` el título es «Importación terminada», no «Ya lo tenías todo».
- [ ] Implementar: una `Line` más en «Qué traía el archivo», solo si `routesAdded > 0`, con meta «Están en Rutas › Biblioteca».
- [ ] e2e a 360 y 430 px: ZIP sintético con una salida y dos rutas → se ve «2 rutas de Strava añadidas a tu biblioteca», sin desbordamiento horizontal; `#/rutas/biblioteca` lista las dos. Ejecutar con `PLAYWRIGHT_PORT=4517 npx playwright test e2e/import.spec.ts`.

### Verificación final

- [ ] `npx tsc --noEmit` limpio.
- [ ] `npx vitest run` completo (repetir solo un test de jsdom que caiga por timeout).
- [ ] `npm run build`.
- [ ] Anotar en `docs/verificaciones.md` qué hay que comprobar con el archivo real (supuestos 1-5).
