# Rutas de Wikiloc cerca y adaptación al usuario

Fecha: 2026-11-11. Aprobado en el chat con el usuario. Base: rama `codex/integracion-rutas` (worktree `C:\testTrain-integracion`). Sin commit sin OK del usuario.

## Objetivo

Recomendar rutas de Wikiloc de la zona del usuario y, cuando elige una, adaptarla a lo que pide: su punto de partida y la distancia y el desnivel que escriba.

## Decisiones del usuario (2026-11-11)

- **La ruta no tiene que empezar en su inicio.** Basta con que pase cerca. Ejemplo: una ruta que sale de Santa Eulàlia y pasa por Caldes (Casa) se adapta para empezar y acabar en Caldes. La búsqueda cubre la zona alrededor del inicio, no solo las rutas que empiezan allí.
- **Manda lo que pide el usuario, no su nivel.** Si escribe 75 km (y, si quiere, un desnivel), la lista se filtra y ordena por lo cerca que queda cada ruta adaptada de esas cifras. El nivel solo sirve para la etiqueta Suave, Media o Dura y para desempatar; nunca descarta una ruta que encaja con lo pedido.

## Límites (no negociables)

- No se elude Cloudflare, no se reutilizan cookies (`cf_clearance`), no hay navegador sin cabeza ni proxy, y nada lee wikiloc.com desde el servidor.
- El track nunca se extrae de la página: la geometría llega solo por la descarga oficial del GPX que hace el usuario.
- El marcador lo pulsa el usuario en su pestaña de Wikiloc y lee solo nombre, km, desnivel y enlace de los resultados visibles. Las condiciones de Wikiloc (1.2) piden autorización para herramientas: se envía en paralelo la petición académica (tarea 5).
- La IA recibe nombre, fuente, km y desnivel. Nunca coordenadas, enlaces ni «Casa».

## Operativa (revisada 2026-11-11: sin descargar ni subir ficheros a mano)

El usuario ya ve en Wikiloc la búsqueda por zona de paso («rutas que empiecen o pasen por ese lugar») con actividad 29, ciclismo de carretera. Se aprovecha esa vista.

1. **App, «¿Qué quieres hacer hoy?»:** 75 km (y desnivel opcional) y **«Buscar en Wikiloc»**. Se abre `es.wikiloc.com/wikiloc/map.do?sw=…&ne=…&act=29` con el rectángulo alrededor del inicio (Caldes). Nada sale de nuestro servidor.
2. **Wikiloc, 1 toque en el marcador «→ FBikeTrain»:** en la pestaña que el usuario ya tiene abierta (Cloudflare superado por él como persona), el marcador lee los resultados de la vista actual: nombre, km, desnivel, dificultad, autor, enlace e id. Puede hacer una sola petición del mismo origen a la consulta que usa el propio mapa (`find.do?event=map`) para esa vista, nunca en bucle ni para otras zonas. Abre la app y le pasa los datos con `postMessage` (con confirmación de origen) o por fragmento si caben.
3. **App, recomendación:** se filtra por lo pedido (75 km, con margen para recortar o alargar) y la IA elige de 3 a 5 con su motivo. El nivel solo pone la etiqueta y desempata.
4. **App, «Adaptar esta ruta»:** abre la ficha de esa ruta en Wikiloc.
5. **Wikiloc, 1 toque en el marcador:** en la ficha, el marcador hace la misma descarga de GPX que el botón «Descargar» de Wikiloc con la cuenta del usuario, una sola ruta, y entrega el fichero a la app por `postMessage`. Sin guardar ni subir ficheros a mano.
6. **App, adaptación automática:** empieza y acaba en Caldes (rota el circuito si pasa cerca o añade conectores ORS), recorta o alarga hasta 75 km, valida (autopista, pistas, retroceso) y enseña mapa y cifras.
7. **«Enviar al iGPSPORT»:** en Android, compartir el GPX con la app de iGPSPORT; en el ordenador, una descarga. Es el único fichero, porque el dispositivo lo necesita.

Total: 2 toques del marcador y ningún fichero manejado a mano hasta el envío final.

### Límites de esta operativa

- Todo ocurre en el navegador del usuario, con su sesión y por una acción suya cada vez. Nada de servidor contra Wikiloc, nada de bucles, cookies reutilizadas ni rotación de IP.
- Sigue siendo una herramienta sobre Wikiloc, en zona gris respecto a sus condiciones (1.2 y 1.6). Es para uso personal del TFG y se envía la petición académica de autorización (tarea 5). Si Wikiloc la deniega, se quita el paso 5 y se vuelve a la descarga manual.
- Si la descarga de GPX exige Premium o confirmación en la cuenta del usuario, el marcador no la salta: avisa y deja el botón oficial.
- En el móvil, el marcador se lanza escribiendo su nombre en la barra de direcciones de Chrome para Android. Se valida en el teléfono real.

### Antes de programar el marcador

Con el usuario, en su navegador: ver la estructura de las tarjetas de resultados, la respuesta de `find.do?event=map` y la petición que hace «Descargar» (formato GPX, original o reducido). No se guarda HTML ni respuestas reales en el repositorio; los fixtures de los tests son sintéticos.

## Tareas

Trabajo SOLO en la worktree `C:\testTrain-integracion` (rama `codex/integracion-rutas`). TDD con vitest. Fixtures sintéticos: ni HTML ni respuestas reales de Wikiloc, ni tracks reales, ni claves. Mobile-first (360-430 px, los dos temas). Sin cambios en Supabase.

### Task 1. Modelo de datos de «Wikiloc cerca» (`src/routes/wikilocNearby.ts`)

- `wikilocSearchUrl(start: LatLng, radiusKm = 8): string`: `https://es.wikiloc.com/wikiloc/map.do?sw=<lat>,<lng>&ne=<lat>,<lng>&act=29&page=1`, con un rectángulo alrededor del inicio, 5 decimales y codificado.
- Esquemas zod versionados del mensaje del marcador:
  - `{ v: 1, kind: 'list', rutas: WikilocCard[] }`, como mucho 50 rutas. `WikilocCard = { id: solo dígitos, nombre: 1-120, km: 0-1000, desnivelM: 0-20000 | null, dificultad: 'facil'|'moderado'|'dificil'|'muy-dificil'|'experto'|null, autor: ≤80 | null, url: https con host wikiloc.com o subdominio }`.
  - `{ v: 1, kind: 'track', id, url, nombre, autor, gpx: string ≤ 5 MB }`.
  - Rechaza campos extra, URL con credenciales, `javascript:` y hosts parecidos (`wikiloc.com.evil.io`).
- Almacenamiento por cuenta en la base Dexie de la cuenta: tabla nueva con subida de versión y migración probada. Guarda la lista con fecha y caduca a los 7 días. `saveNearby`, `loadNearby` (descarta lo caducado) y `clearNearby`.
- `rankForTarget(cards, { distanceKm, elevGainM? }, ref: UserReference | null)`: manda lo pedido. Se admiten rutas de 0,5× a 1,6× la distancia pedida, porque se pueden recortar o alargar. Orden por cercanía relativa a la distancia y, si se pide, al desnivel. El nivel solo da la etiqueta Suave, Media o Dura (`difficulty` existente) y desempata; nunca descarta. Devuelve el motivo de descarte de cada ruta.

### Task 2. Adaptación de una ruta (`src/routes/adapt.ts`)

`adaptRoute(points: RoutePoint[], opts: { start: LatLng; mode: 'mi-inicio' | 'inicio-ruta'; targetKm: number; targetGainM?: number }, deps: { ors: OrsAccess; signal?: AbortSignal; road?: typeof fetchRoadPath })` devuelve `{ coords, distanceM, elevGainM, connectorM, passesNearM, rotated, warnings: string[], rejected?: string }`.
- `inicio-ruta`: la ruta tal cual, solo con recorte o alargado.
- `mi-inicio`: calcula la distancia mínima de la ruta al inicio (`passesNearM`).
  - Circuito (inicio y final a menos de 300 m) que pasa a menos de 300 m del inicio: rotarlo para que empiece y acabe en el punto más próximo. Reutiliza o extrae `orient` de `src/routes/intent.ts`. Es el caso «sale de Santa Eulàlia y pasa por Caldes».
  - Si pasa más lejos o es lineal: conector ORS `cycling-road` del inicio al punto de entrada más próximo, y del punto de salida de vuelta al inicio. En una ruta lineal se entra por el extremo más próximo. Reutiliza `fetchRoadPath` y los conectores de `splice.ts`.
- Distancia:
  - Si el total supera lo pedido en más de un 8 %, se recorta la ruta y se cierra con ORS desde el punto de corte, sin ida y vuelta (lo comprueba `geometryQuality`).
  - Si se queda corto en más de un 20 %, se alarga con un `round_trip` de ORS desde el inicio de la longitud que falta; si no cabe, se avisa.
- Validación del resultado: sin autopista (`usesMotorway`), pistas dentro del límite (`rejectReason`), retroceso ≤ `MAX_INTENT_BACKTRACK` y ningún salto de más de 5 km. Si no cumple, `rejected` lleva el motivo en castellano; nunca se presenta como buena.
- Como mucho 4 consultas a ORS por adaptación. Respeta `signal`.
- Tests con geometrías sintéticas: rotación, conectores, ruta lineal, recorte, alargado, rechazo por retroceso y por autopista, y presupuesto de consultas.

### Task 3. Marcador «→ FBikeTrain» (`src/bookmarklet/`)

- `wikilocReader.ts`: funciones puras probadas con HTML sintético.
  - `readListFromDocument(doc)` lee las tarjetas de la lista: nombre, km («106,44 km»), desnivel («2405 m»), dificultad («Difícil»), autor, enlace e id.
  - `readFindResponse(json)` lee la respuesta de `find.do?event=map`, cuyo formato está por confirmar.
  - Todos los selectores y nombres de campo van en un único objeto `WIKILOC_FORMAT`, para ajustarlos al formato real sin tocar la lógica.
- `trackDownload.ts`: en la ficha de una ruta, localiza el enlace de descarga oficial que ofrece la página, pide el GPX del mismo origen con `credentials: 'include'` y comprueba que es GPX. Si la página pide Premium, inicio de sesión o confirmación, devuelve `{ kind: 'manual', motivo }` y no intenta nada más. Una sola petición por toque: nunca bucles, reintentos automáticos ni otras zonas.
- `bookmarklet.ts`:
  - Decide por la URL si está en la lista, en el mapa o en una ficha, y lee.
  - Abre la app con `window.open`: `https://fraannr4.github.io/FBikeTrain/#/rutas/wikiloc/recibir`, o `http://localhost:5173/...` en desarrollo.
  - Cuando la app responde `fbt-ready`, le entrega el mensaje por `postMessage` con `targetOrigin` exacto. Timeout de 15 s con mensaje visible.
- Build: script npm `build:bookmarklet` que genera `public/wikiloc-marcador.html`. Incluye el `javascript:` minificado y una página de instalación: en el ordenador se arrastra a favoritos; en Chrome para Android se crea el favorito y se lanza escribiendo su nombre en la barra. La página explica qué lee y qué no.
- `pendingUser`: validar `WIKILOC_FORMAT` y la descarga contra la página real en el navegador del usuario.

### Task 4. Pantallas `#/rutas/wikiloc` y `#/rutas/wikiloc/recibir`

- Entrada en Rutas: «Rutas de Wikiloc cerca».
- `#/rutas/wikiloc`:
  - «¿Qué quieres hacer hoy?»: distancia (obligatoria) y desnivel (opcional). El inicio se elige como en Rutas.
  - Botón «Buscar en Wikiloc» (`wikilocSearchUrl`, pestaña nueva con `noopener`) y enlace para instalar el marcador.
  - Lista recibida, ordenada con `rankForTarget`, con su etiqueta de dificultad y el porqué.
  - Recomendación de la IA (de 3 a 5, cada una con un motivo) con la operación `plan` existente: `referencias` de fuente `wikiloc` (solo nombre, fuente, km y desnivel) y `referenciaId` para elegir. Sin IA o con la cuota agotada, basta el orden local y se dice.
  - Estados vacío, caducado y error.
- Por ruta: «Adaptar esta ruta» abre su ficha en Wikiloc. Al recibir el `track`, se abre la pantalla de adaptación:
  - selector de salida: «Desde mi inicio» o «Desde el inicio de la ruta»;
  - mapa CyclOSM y cifras: km, desnivel, conectores y a qué distancia pasa del inicio;
  - avisos, o el rechazo si no cumple;
  - «Guardar en la biblioteca», con autor y enlace;
  - «Enviar al iGPSPORT»: Web Share con el fichero en Android si está disponible; si no, descarga GPX 1.1 con el exportador actual.
- `#/rutas/wikiloc/recibir`: envía `fbt-ready` a `window.opener` y acepta solo mensajes cuyo `event.origin` sea `https://*.wikiloc.com`. Valida con los esquemas de la Task 1, guarda y redirige. Nunca `innerHTML` con datos recibidos.
- e2e con Playwright simulando el marcador con mensajes sintéticos, a 360 y 430 px, en claro y oscuro: lista, recomendación, adaptación y envío. Comprueba que ninguna coordenada ni enlace llega a la IA.

### Task 5. Documentación y correo

- `docs/wikiloc-cerca.md`: operativa, límites, qué lee el marcador, cómo instalarlo y cómo actualizar `WIKILOC_FORMAT`.
- `docs/wikiloc-solicitud-acceso.md`: añadir la versión TFG (uso académico y no comercial, sin redistribuir; metadatos y descarga personal de GPX con el marcador), lista para que el usuario la envíe.
- Actualizar `docs/ESTADO.md` y `docs/verificaciones.md`.

## Abierto

- Fallo previo en `e2e/biblioteca-calidad.spec.ts` (scroll horizontal a 360/430): investigar aparte.
