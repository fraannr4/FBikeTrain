# Pulido técnico sin dependencias externas: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los pendientes técnicos de `docs/ESTADO.md` que no necesitan decisiones del usuario, cuentas de terceros ni un dispositivo real.

**Architecture:** Cinco arreglos independientes y pequeños, cada uno con su prueba. Ninguno cambia datos guardados ni el esquema de producción. La tarea 6 limpia la documentación de pendientes que ya no existen.

**Tech Stack:** Vite, React 18, TypeScript, Vitest, Playwright, PGlite para las pruebas SQL.

**Spec:** `docs/ESTADO.md`, sección «Pendiente» y los apartados «Retomar aquí» del 2026-11-17. Comprobado contra el código el 2026-11-18.

## Qué entra y qué no

Entra:

1. Las pistas asfaltadas no cuentan como pista en las conexiones por carretera.
2. Dos enlaces externos avisan al lector de pantalla de que abren otra pestaña.
3. `useDesktopLayout` deja de resuscribirse en cada render y los umbrales viven en un solo sitio.
4. Icono maskable para la PWA.
5. Las migraciones `202611170004` y `202611170005` entran en las pruebas SQL.
6. Limpieza de `docs/ESTADO.md`.

No entra, porque depende del usuario o de terceros:

- Estadísticas sociales por semana, mes y año: necesita diseño y decisiones.
- Color de la miniatura de ruta frente al del mapa: decisión visual.
- Garmin, OAuth de Intervals.icu y mover los tracks a Supabase Storage.
- Pruebas en dispositivos reales (sincronización, push, compartir desde Android).

Descartados por obsoletos. «Rutas con IA» y «Empalmar» se retiraron en el commit `bb0d35b`:

- «Propuestas de la IA hacia lados distintos»: ya no existe `src/ai/routePlanner.ts`.
- «El motivo de la ruta con IA y Empalmar citan el objetivo»: ya no existen esas pantallas.
- «`splice.ts` cuenta como pista las pistas asfaltadas»: `src/routes/splice.ts` solo guarda constantes. El fallo sigue únicamente en `src/routes/roadPath.ts` (tarea 1).

## Global Constraints

- Repositorio público: ni claves, ni tracks reales. Los fixtures son sintéticos.
- Mobile-first: lo que se vea en pantalla se valida a 360-430 px.
- Marca y paleta no cambian. No se crean tokens nuevos.
- Textos de interfaz en español con tildes.
- Ninguna migración nueva en producción. La tarea 5 solo toca el runner de pruebas.
- Rendimiento del PC: un agente a la vez; nunca Vitest y Playwright a la vez; Playwright con `--workers=2`.
- Commit y push solo con la confirmación del usuario. Los agentes no hacen commit.
- Comandos: `npx vitest run <fichero>`, `npx tsc --noEmit`, `node scripts/test-account-sql.mjs`, `npm run build`.

## Review Focus

1. Respuesta de ORS sin tramos por índice (`values: []`): la conexión debe seguir rechazando la pista por el resumen, como hoy. Prueba en la tarea 1.
2. Pista con firme desconocido (`surface` 0): sigue contando como pista. Prueba en la tarea 1.
3. Cambio de `query` en `useDesktopLayout` entre renders: debe suscribirse a la consulta nueva y soltar la anterior. Prueba en la tarea 3.
4. Fallo de `net.http_post`: el aviso de la comunidad se crea igual. Prueba en la tarea 5.
5. Icono maskable recortado en círculo: la marca entera debe quedar dentro del círculo central del 80 %. Comprobación visual en la tarea 4.

---

### Task 1: Las pistas asfaltadas no bloquean una conexión por carretera

Hoy `fetchRoadPath` suma como pista todo `waytypes` con valor 5 y rechaza por encima de 100 m, aunque la pista esté asfaltada. El filtro principal (`analyze.ts`) ya descuenta esos tramos con `roughTrackM`.

**Files:**
- Modify: `src/routes/analyze.ts:60` y `:89` (exportar dos funciones, sin cambiar su cuerpo)
- Modify: `src/routes/roadPath.ts:27-33`
- Test: `tests/roadPath.test.ts`

**Interfaces:**
- Produces: `export function cumulativeM(coords: Coord3[]): number[]` y `export function roughTrackM(waytypes: OrsExtra, surface: OrsExtra, cum: number[]): number`, las dos en `src/routes/analyze.ts`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/roadPath.test.ts`, reutilizando el constructor de respuesta que ya usa el fichero (línea 8). Tres casos, con una línea de 5 puntos separados unos 100 m:

  - «acepta una pista asfaltada»: `waytypes.values = [[0, 4, 5]]`, `waytypes.summary = [{ value: 5, distance: 400, amount: 100 }]`, `surface.values = [[0, 4, 3]]`, `surface.summary = [{ value: 3, distance: 400, amount: 100 }]`. Espera que `fetchRoadPath` resuelva con 5 puntos.
  - «rechaza una pista con firme desconocido»: lo mismo con `surface.values = [[0, 4, 0]]` y `surface.summary = [{ value: 0, distance: 400, amount: 15 }]`. Espera el error «La conexión no cumple los filtros de carretera».
  - «sin tramos por índice cuenta la pista del resumen»: `waytypes.values = []` con el mismo resumen de 400 m de pista y firme 3. Espera el mismo error.

- [ ] **Step 2: Ejecutar y ver que falla el primer caso**

Run: `npx vitest run tests/roadPath.test.ts`
Expected: FAIL en «acepta una pista asfaltada» con el error de filtros de carretera.

- [ ] **Step 3: Exportar `cumulativeM` y `roughTrackM`** en `src/routes/analyze.ts` (añadir `export`, nada más).

- [ ] **Step 4: Usarlas en `fetchRoadPath`.** Sustituir el cálculo de `track` (línea 28) por `roughTrackM(extras.waytypes, extras.surface, cumulativeM(coordenadas))`. Para tener las coordenadas en ese punto, subir la validación de `feature.geometry.coordinates` (líneas 34-41) por encima del filtro. El orden de los mensajes de error para datos de firme ausentes y para autopista no cambia.

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npx vitest run tests/roadPath.test.ts tests/routes.test.ts tests/libraryGenerate.test.ts`
Expected: PASS.

### Task 2: Aviso de pestaña nueva en los dos enlaces que faltan

Seis enlaces externos ya llevan `<span className="sr-only"> (se abre en otra pestaña)</span>`. Faltan dos.

**Files:**
- Modify: `src/ui/ajustes/ActivityConnections.tsx:73` («Abrir ajustes de Intervals.icu»)
- Modify: `src/ui/pages/BibliotecaRutas.tsx:199` («Origen: …»)
- Test: `tests/enlacesExternos.test.ts` (nuevo)

- [ ] **Step 1: Escribir la prueba que falla.** `tests/enlacesExternos.test.ts` lee todos los `.tsx` de `src/` con `import.meta.glob('../src/**/*.tsx', { query: '?raw', import: 'default', eager: true })`. Para cada aparición de `target="_blank"`, toma el texto hasta el `</a>` siguiente y espera que contenga `se abre en otra pestaña`. El fallo debe nombrar fichero y enlace.

- [ ] **Step 2: Ejecutar y ver que falla** con los dos ficheros de arriba.

Run: `npx vitest run tests/enlacesExternos.test.ts`
Expected: FAIL, 2 enlaces.

- [ ] **Step 3: Añadir el `span` `sr-only`** dentro de los dos enlaces, con el mismo texto y el espacio inicial que usa `src/ui/library/CatalogCard.tsx:14`.

- [ ] **Step 4: Ejecutar**

Run: `npx vitest run tests/enlacesExternos.test.ts`
Expected: PASS.

### Task 3: `useDesktopLayout` estable y umbrales en un solo sitio

`subscribe` se crea en cada render, así que `useSyncExternalStore` se da de baja y de alta en `matchMedia` cada vez. Lo usan `Page`, `HistoryWorkspace`, `Hero`, `TrendCard`, `CommonLibrary`, `Calendario` e `Inicio`.

**Files:**
- Modify: `src/ui/hooks/useDesktopLayout.ts`
- Modify: `src/ui/components/Sheet.tsx:153` (cadena `'(min-width: 1024px)'` escrita a mano)
- Modify: `src/ui/historial/HistoryWorkspace.tsx:8` (umbral de 1280)
- Test: `tests/useDesktopLayout.test.tsx` (nuevo)

**Interfaces:**
- Produces, en `src/ui/hooks/useDesktopLayout.ts`:
  - `export const DESKTOP_QUERY = '(min-width: 1024px)'`
  - `export const WIDE_QUERY = '(min-width: 1280px)'`
  - `export function useDesktopLayout(query: string = DESKTOP_QUERY): boolean` (misma firma pública)

- [ ] **Step 1: Escribir las pruebas que fallan** con `renderHook` y un `matchMedia` falso que cuenta `addEventListener` y `removeEventListener` por consulta:

  - «no se resuscribe al volver a renderizar»: tras `rerender()` tres veces con la misma consulta, `addEventListener` se llamó 1 vez y `removeEventListener` 0.
  - «cambia de consulta»: al pasar de `DESKTOP_QUERY` a `WIDE_QUERY`, se da de baja de la primera (1) y de alta en la segunda (1).
  - «responde al cambio»: al disparar el `change` con `matches: true`, el hook devuelve `true`.

- [ ] **Step 2: Ejecutar y ver que falla la primera**

Run: `npx vitest run tests/useDesktopLayout.test.tsx`
Expected: FAIL, `addEventListener` llamado más de 1 vez.

- [ ] **Step 3: Estabilizar `subscribe`** con `useCallback` dependiente de `query`, y exportar las dos constantes.

- [ ] **Step 4: Usar las constantes** en `Sheet.tsx:153` y en `HistoryWorkspace.tsx:8`. Sin más cambios en esos ficheros.

- [ ] **Step 5: Ejecutar**

Run: `npx vitest run tests/useDesktopLayout.test.tsx` y `npx tsc --noEmit`
Expected: PASS y sin errores de tipos.

### Task 4: Icono maskable de la PWA

Los dos iconos del manifest son `purpose: "any"`. En Android el lanzador recorta el icono con su propia forma; sin variante maskable, lo encoge sobre un fondo blanco.

**Files:**
- Modify: `scripts/generate-pwa-icons.mjs`
- Create: `public/brand-mark-maskable-512.png` (lo genera el script)
- Modify: `public/manifest.webmanifest`
- Test: `tests/manifest.test.ts` (nuevo, o el fichero que ya compruebe el manifest si existe; buscar con Grep `manifest.webmanifest` en `tests/`)

- [ ] **Step 1: Escribir la prueba que falla.** Lee `public/manifest.webmanifest` y espera: una entrada con `purpose: 'maskable'`, `sizes: '512x512'` y `src: 'brand-mark-maskable-512.png'`; que las dos entradas `any` siguen ahí; y que cada `src` de `icons` existe en `public/`.

- [ ] **Step 2: Ejecutar y ver que falla.**

Run: `npx vitest run tests/manifest.test.ts`
Expected: FAIL, no hay entrada maskable.

- [ ] **Step 3: Ampliar el script.** Tras el bucle actual, generar `brand-mark-maskable-512.png`: lienzo de 512 px, mismo fondo `#F7F4EA` a sangre, y el SVG al 56 % (el actual va al 72 %). Con el 56 %, la diagonal del cuadro de la marca mide el 79 % del lienzo y cabe en el círculo seguro del 80 %.

- [ ] **Step 4: Generar el icono**

Run: `node scripts/generate-pwa-icons.mjs`
Expected: aparece `public/brand-mark-maskable-512.png`; los otros dos PNG no cambian (`git status` no los marca).

- [ ] **Step 5: Añadir la entrada al manifest**, después de las dos existentes: `{ "src": "brand-mark-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }`.

- [ ] **Step 6: Comprobar a ojo.** Abrir el PNG y confirmar que la marca entera queda dentro del círculo central del 80 %.

- [ ] **Step 7: Ejecutar**

Run: `npx vitest run tests/manifest.test.ts` y `npm run build`
Expected: PASS y `dist/brand-mark-maskable-512.png` presente.

### Task 5: El trigger de push entra en las pruebas SQL

`scripts/test-account-sql.mjs` salta `202611170004_push_trigger.sql` y `202611170005_push_actor_name.sql` porque PGlite no tiene la extensión `pg_net`. Las dos están aplicadas en producción sin prueba automática.

**Files:**
- Modify: `scripts/test-account-sql.mjs` (junto a la línea 87-88, después de `202611170003_push.sql` y su prueba)
- Create: `supabase/tests/push_trigger.sql`
- No se toca ninguna migración.

**Interfaces:**
- Produces, solo dentro del runner: esquema `net` con la tabla `net.calls(url text, body jsonb, headers jsonb)` y la función `net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) returns bigint`. La función inserta en `net.calls` y lanza una excepción si `url` es `https://falla.invalid/`.

- [ ] **Step 1: Escribir `supabase/tests/push_trigger.sql`** con el mismo estilo de aserciones que `supabase/tests/push.sql`. Casos:

  - Sin fila en `private.push_config`: insertar un aviso en `public.community_notifications` no añade filas a `net.calls`.
  - Con configuración (`url` `https://ejemplo.invalid/push`, secreto de 32 caracteres): insertar un aviso añade 1 fila; `body->'record'->>'kind'` coincide con el aviso; `body->'record'->>'actor_name'` es el `display_name` del perfil de `actor_id`; `headers->>'x-push-secret'` es el secreto.
  - Aviso sin `actor_id`: `actor_name` es nulo y la fila se encola igual.
  - Con `url` `https://falla.invalid/`: el `insert` del aviso no falla y el aviso queda guardado.
  - `anon` y `authenticated` no pueden leer `private.push_config` ni ejecutar `private.notify_push()`.

- [ ] **Step 2: Añadir al runner**, en este orden: crear el stub de `net`; ejecutar `202611170004` quitando del texto la línea `create extension if not exists pg_net;` (un `replace` sobre la cadena leída; si la línea no está, el runner debe fallar con un mensaje claro); ejecutar `202611170005` tal cual; ejecutar `supabase/tests/push_trigger.sql`.

- [ ] **Step 3: Ejecutar**

Run: `node scripts/test-account-sql.mjs`
Expected: todas las suites PASS, incluida la nueva.

- [ ] **Step 4: Comprobar que la prueba muerde.** Cambiar a mano en el stub el nombre del parámetro `timeout_milliseconds` y volver a ejecutar.
Expected: FAIL en el caso «con configuración» (0 filas en `net.calls`, porque el trigger traga el error). Deshacer el cambio.

### Task 6: Verificación final y limpieza de `docs/ESTADO.md`

**Files:**
- Modify: `docs/ESTADO.md`

- [ ] **Step 1: Verificación completa**, en este orden y nunca a la vez:

Run: `npx tsc --noEmit`, `npx vitest run`, `node scripts/test-account-sql.mjs`, `npm run build`.
Expected: todo en verde.

- [ ] **Step 2: Playwright de lo afectado** (historial y hojas por la tarea 3, biblioteca por la tarea 2), sobre el build, con el servidor de vista previa en el puerto 4533:

Run: `PLAYWRIGHT_PORT=4533 npx playwright test e2e/historial.spec.ts e2e/biblioteca-comun.spec.ts e2e/compartido.spec.ts --workers=2 --reporter=line`
Expected: PASS. Después, `git checkout -- docs/design`.

- [ ] **Step 3: Actualizar `docs/ESTADO.md`.** Añadir arriba una sección «Retomar aquí (2026-11-18)» con lo hecho. En «Pendiente», marcar como retirados los tres puntos obsoletos de este plan (lados distintos, objetivo citado, `splice.ts`) con la referencia al commit `bb0d35b`, y quitar la línea de `202611170004`/`0005` fuera del runner.

- [ ] **Step 4: Proponer el commit al usuario.** Un commit por tarea o uno solo, según prefiera. No hay despliegue de funciones ni migraciones.
