# Estado del proyecto FBikeTrain

## Retomar aquí (2026-11-13): «Rutas cerca», rutas de Strava y Explore publicados

- **Fase A, motor propio y pantalla «Rutas cerca»** (`#/rutas/cerca`; `#/rutas/catalogo` redirige). Plan: `docs/superpowers/plans/2026-11-12-rutas-cerca-motor.md`, tareas 1 a 6.
  - Puntos de paso: OSM (`kind: 'waypoints'` en `route-sources`: puertos, cimas con carretera asfaltada y pueblos, con `interes` de 0 a 3) e historial local (subidas habituales y tramos repetidos 3 o más veces).
  - Combinaciones: la IA compartida (operación `waypoints` de `ai-routes`, solo nombres y cifras); si falla, `codeCombos`.
  - Orquestador `src/routes/nearby.ts`: rutas reales de Ride with GPS primero, después el motor y, si faltan, `round_trip`. Filtros: ±10 % de km, ±25 % de desnivel, asfalto, rumbos separados ≥ 45° y solape < 70 %. Como mucho 14 consultas a ORS.
- **Fase B, carpeta `routes/` de la exportación de Strava:** las rutas van a la biblioteca con `origin: { kind: 'strava' }` y se descartan duplicados por geometría. Plan: `2026-11-12-strava-routes.md`.
- **Fase D, compartir desde Explore:**
  - `rwgpsExploreUrl` abre Explore con los filtros puestos (botón en «Rutas cerca»);
  - el `share_target` acepta también enlaces;
  - pantalla nueva `#/rutas/compartida`, que adapta una ruta o colección de Ride with GPS al inicio.

  Plan: `2026-11-12-explore-compartir.md`.
- **Verificación:** tsc limpio. vitest completo: 131/132 ficheros; el único fallo, `aiWeekSheet`, fue un timeout por carga y pasa solo. Build correcto. e2e `rutas-cerca`, `compartida`, `import` y `rutas`: 25/25.
- **Pendiente del usuario:**
  - prueba real desde Caldes (60 km, y 60 km con 800 m: 5 o más rutas cada una) y contraste con las 5 mejores rutas de Wikiloc;
  - `routes/` con el archivo real de Strava;
  - «Compartir → FBikeTrain» en Android.
- **Abierto:** ¿«Rutas cerca» debe respetar `VITE_SHARED_AI_ENABLED` y `VITE_ROUTE_SOURCES_ENABLED`? Hoy usa los servicios siempre que hay sesión.
- **En curso, sin publicar:** Zona, buscador y Amigos, y Retos, en el worktree `.claude/worktrees/agent-a3ec01869c0b3e2d7`, con las migraciones `202611130001` y `202611130002` sin aplicar.

## Anterior (2026-11-12, noche): decisiones para «Rutas cerca»

Sesión de investigación y decisiones, sin código. `main` = `463af22`.

**Investigación (con datos reales):** no hay ninguna fuente legal y gratuita que busque por zona rutas de carretera publicadas por otros ciclistas.
- Ride with GPS: la OpenAPI oficial (`/api/v1/openapi.yaml`, 34 rutas) no busca por zona ni por palabra. Solo lee rutas o colecciones públicas por id y lista lo propio de la cuenta (por nombre, km y desnivel, nunca por lugar). Explore (110.246 resultados cerca de Caldes) solo existe en la web, usa un servicio interno y contesta 418 a peticiones automáticas: automatizarlo sería scraping, descartado.
- Strava: desde el 2026-09-01, Explore Segments exige Extended Access; la API de rutas solo da las propias.
- Komoot (solo socios), Wikiloc (sin API, Cloudflare), Bikemap (GPX de pago), Garmin y Plotaroute (sin búsqueda): descartados.
- Generalitat, Diputació e ICGC: no publican rutas de carretera en GPX abierto.
- OSM a 30 km de Caldes: 342 relaciones ciclistas, casi todas tramos de red o vías verdes, casi sin vueltas de carretera. 10 subidas CIMA (El Farell desde Caldes, Collformic, Estenalles, Tagamanent, Turó de l'Home, Montserrat, Santa Fe…) y 118 collados con nombre a 35 km (muchos en pista). Trazas GPS públicas: unas 10 salidas de carretera reales en 20×13 km, insuficiente.

**Decisiones aprobadas (grilling 2026-11-12):**
1. Pantalla «Rutas cerca» en lugar de `#/rutas/catalogo`, con el mismo formulario: km, desnivel opcional, salida Casa / Aquí / Mapa.
2. Orden: primero las rutas reales que encajan (comunidad, rutas de Strava del usuario, índice de Ride with GPS), adaptadas al inicio. El motor propio completa hasta 5 o más en direcciones libres. Cada tarjeta dice de dónde sale.
3. Motor propio: ORS `directions` por puntos de paso, no `round_trip` aleatorio. Puntos de paso: subidas CIMA asfaltadas y collados OSM; los tramos y subidas más repetidos del historial (solo en local); pueblos en carreteras secundarias y terciarias. La IA combina los puntos por dirección solo con cifras y nombres, nunca coordenadas ni «Casa». Si la IA falla, los combina el código.
4. Explore de Ride with GPS a mano: un botón abre Explore con los filtros puestos. La ruta llega por «Compartir → FBikeTrain» (`share_target` de la PWA en `public/manifest.webmanifest`) o pegando enlaces, y se lee por id con la API. Propuesto, pendiente de confirmar: sembrar `rwgps_route_index` con colecciones PÚBLICAS de la zona (clubes, tiendas como «Great Rides Barcelona», embajadores); el usuario manda los enlaces una vez desde su navegador.
5. Exportación de Strava: leer también la carpeta `routes/` (hoy solo `activities.csv` y `activities/`).
6. Índice de comunidad con vueltas de carretera compartidas y recortadas: sin el primer y el último km ni nada a menos de 1 km de Casa; línea de 300 puntos como máximo, más km y desnivel; sin nombre, fecha ni usuario. Consentimiento RGPD: pregunta clara al importar, botones Sí y No, nada marcado; se cambia y se borra lo compartido en Ajustes (el usuario pidió primero «activado por defecto» y aceptó la pregunta explícita tras explicarle el riesgo).
7. Fases, cada una con su lote de develop-phase y su commit: **A** motor propio y pantalla «Rutas cerca»; **D** Explore por compartir y pegar, y siembra de colecciones; **B** `routes/` de Strava; **C** índice de comunidad.
8. Prueba de aceptación en el móvil real desde Caldes: 60 km, y 60 km con unos 800 m, dan cada una 5 o más rutas automáticas con rumbos separados ≥ 45°, solape < 70 %, todo asfalto, distancia ±10 % y desnivel ±25 % cuando se pide. Una ruta compartida desde Explore se adapta al inicio. Validado a 360 y 430 px.
9. Descartado: scraping de Explore, Komoot, Wikiloc automático, Bikemap, Strava Explore Segments y trazas GPS de OSM.

**Pendientes:** correo a developers@ridewithgps.com pidiendo un endpoint de búsqueda (redactado; lo envía el usuario desde la cuenta de FBikeTrain): comprobar si han contestado. Ramas fusionadas que se pueden borrar: `claude/catalogo-rutas`, `claude/rwgps`, `claude/rwgps-compartido`, `claude/rwgps-zona`.

**Siguiente:** plan de la fase A en `docs/superpowers/plans/2026-11-12-rutas-cerca-motor.md`.

## Anterior (2026-11-12, tarde): rutas de Ride with GPS por zona

- **Pantalla `#/rutas/catalogo`, ahora «Rutas de Ride with GPS»:** solo el generador (km, desnivel opcional, salida Casa/Aquí/Mapa, botón «Proponer rutas», nunca automático) y Wikiloc («Buscar en Wikiloc» + «Subir el GPX descargado»). Se retiraron la precarga OSM, los puertos, la importación GPX/ZIP y el pegado de enlaces (`catalog/load.ts` y `dem.ts` borrados).
- **Propuestas:** `src/routes/sources/rwgpsProposals.ts`. Pide `nearby` con radio 5 → 15 → 30 km hasta tener 10 candidatas, ordena por km y desnivel, y elige al menos 5 (hasta 6) con rumbos separados ≥ 45° (luego 25°) y solape < 0,7. Cada una se adapta para salir y volver al inicio (`adaptRoute`), con reservas si falla, 12 intentos como máximo.
- **Índice compartido** (migración `202611120002`, aplicada): `rwgps_route_index`, `rwgps_sync_state`, rpc `rwgps_routes_near`. Solo service_role.
  - Se alimenta solo de las colecciones y rutas propias de la cuenta común (fbiketrain), solo públicas. Leer una ruta por id no la añade (revisión de seguridad: evita que cualquiera llene el índice con filas que nadie vuelve a comprobar).
  - Sincronización (`src/routes/sources/rwgpsSync.ts`) en segundo plano al pedir `nearby`, como mucho cada 6 h y 80 rutas por pasada.
- **Función `rwgps`:** op `nearby` `{lat, lng, radiusKm, distanceKm?}` → hasta 60 rutas con línea simplificada (≤ 300 puntos) y `passM`. Lista cerrada de GET: routes/{id}, collections/{id}, collections.json, routes.json.
- **IA:** las rutas cercanas de Ride with GPS (radio 15 km) entran como rutas conocidas con `fuente: 'rwgps'`, `aInicioKm` y `direccion` (8 rumbos). Nunca coordenadas. `ai-routes` redesplegada.
- **Verificación:** tsc limpio; vitest 1.588/1.588 (un test de la Biblioteca es intermitente con carga); e2e `rwgps` y `catalogo` 6/6 a 360 y 430 px (capturas en `test-results/rwgps-zona/`). Prueba real: `nearby` en Caldes da 200 con 0 rutas; la primera sincronización ha corrido sin error.
- **Pendiente del usuario:** con la cuenta fbiketrain, guardar en colecciones rutas públicas de la zona. Se indexan en la siguiente sincronización (≤ 6 h tras una búsqueda).

## Anterior (2026-11-12, mañana)

**Ride with GPS compartido para todos los usuarios.** Ya no hay formulario de conexión por usuario: la Edge Function `rwgps` lee la API v1 con la cuenta común de FBikeTrain.
- Función `supabase/functions/rwgps` + handler portable `src/routes/sources/rwgpsService.ts`.
  - Entrada: `POST { kind: 'route' | 'collection', id, privacyCode? }` con el JWT de la app. El servidor construye la URL: solo `GET /api/v1/routes/{id}.json` y `/api/v1/collections/{id}.json`, sin redirecciones.
  - Devuelve solo nombre, autor y `track_points` (x, y, e), o el nombre e ids de una colección. Nunca la clave, el token ni otros datos de la cuenta.
  - Solo lo que tenga `visibility: public`; `privacy_code` se ignora (con el token común abriría lo privado de la cuenta común). Sesiones anónimas: 401.
  - Cuota `consume_shared_rwgps_quota` (migración `202611120001`): 300 lecturas al día por usuario y 3.000 en total.
- Secrets del proyecto: `RWGPS_API_KEY`, y `RWGPS_AUTH_TOKEN` o bien `RWGPS_EMAIL` + `RWGPS_PASSWORD` (el token se pide en memoria y se renueva tras un 401). Sin ellos la función responde 503.
- Cliente: `fetchRwgpsRoutes(links, { getToken })` llama a la función. Sesión, cuota, saturación o servicio caído paran el lote (`RwgpsError.fatal`); una ruta privada o inexistente, no.
- Catálogo: se mantienen «Buscar en Ride with GPS» y el pegado de enlaces o colecciones públicas. Se retiran la conexión, «Desconectar» y «Añadir mi colección fijada» (era de cada cuenta). Al abrir el catálogo se borran las credenciales antiguas de `meta` (`rwgps:credentials`).
- Pruebas: `tests/rwgpsService.test.ts`, `tests/rwgpsImport.test.ts`, e2e `e2e/rwgps.spec.ts` (360 y 430 px, comprueba que el navegador nunca llama a ridewithgps.com).

## Anterior (2026-11-11, noche)

**Publicado: catálogo de rutas, que sustituye a Wikiloc cerca y al marcador.** Plan: `docs/superpowers/plans/2026-11-11-catalogo-rutas.md`.

Pantalla `#/rutas/catalogo` («Rutas de tu catálogo»). Los enlaces `#/rutas/wikiloc*` redirigen allí.
- **Precarga desde la app:**
  - Overpass directo desde el navegador, con el centro redondeado a 0,01°.
  - Relaciones `route=bicycle` y `route=mtb` a menos de 15 km. Se encadenan los tramos (huecos ≤ 300 m), se descarta lo que mide menos de 5 km y se guardan 95 como máximo.
  - Altitud estimada con Open-Meteo (`elevation: 'dem'`, «Desnivel estimado ≈»).
  - Subidas a los 5 puertos más cercanos (15-30 km), en circuito ORS.
  - Volver a cargar sustituye por `catalog.ref`, sin duplicar.
  - Todo se guarda solo en la biblioteca de la cuenta (IndexedDB).
- **Importación por lotes:** varios GPX/TCX o un ZIP, hasta 200 por vez (`importReferenceRoutes`), también en la Biblioteca.
- **Recomendación:**
  - `rankForTarget`, ahora genérico en `src/routes/rank.ts`, ordena por los km y el desnivel pedidos, sin nivel, entre las rutas a menos de 15 km.
  - `adaptRoute` adapta las candidatas de una en una («mi-inicio»), 8 intentos como máximo, hasta 3 válidas y distintas (solape < 70 %).
  - Ante `rate_minute` del ORS compartido espera 60 s, como mucho 2 veces.
  - Cada propuesta se puede «Enviar al iGPSPORT» o «Guardar en la biblioteca».
- **Wikiloc:** «Buscar en Wikiloc» abre una pestaña del usuario y «Subir el GPX descargado» lo adapta al momento. La app no accede nunca a wikiloc.com.
- **Retirado:** el marcador (`src/bookmarklet`, `public/wikiloc-marcador.html`, `build:bookmarklet`), las pantallas recibir y adaptar, y `wikilocAdvisor`. Las filas antiguas `nearby` y `track` se borran al abrir el catálogo.
- No hay cambios en Edge Functions ni migraciones.
- **Verificación (con Ride with GPS):** `tsc` limpio, vitest 120 ficheros y 1490/1490, e2e `rwgps.spec.ts` 2/2; build correcto, e2e `catalogo.spec.ts` 4/4 (claro y oscuro, a 360 y 430 px, sin desborde; capturas en `test-results/catalogo/`).

**Pendiente del usuario:**
1. Pegar la URL de Wikiloc con sus filtros (km, bici de carretera). Ahora se usa el mapa `map.do`, con un rectángulo de 8 km y `act=29`.
2. Probar la precarga real desde su cuenta: Overpass, Open-Meteo y ORS. Contar cuántas rutas salen alrededor de Caldes de Montbui.
3. Subir de golpe sus GPX de Wikiloc (ZIP) y probar las 3 propuestas en el móvil y el envío al BSC200S.

**Ride with GPS (publicado, mismo día):** en el catálogo, sección «Rutas de Ride with GPS».
- Solo usa la API v1 oficial. El CORS está abierto: comprobado con un preflight el 2026-11-11.
- **Conectar:** la clave de API se crea en ridewithgps.com/api/api_clients.
  - El correo y la contraseña van solo a `POST /api/v1/auth_tokens.json`.
  - Se guardan la clave y el token en `meta` (`rwgps:credentials`), fuera de Ajustes y de la copia de seguridad. La contraseña no se guarda nunca.
- **Añadir al catálogo:** se pegan muchos enlaces de rutas o colecciones, o se añade la «colección fijada».
  - Se descarga cada ruta (`/routes/{id}.json`, `track_points`) con 150 como máximo por vez.
  - Se guarda con `catalog.kind = 'rwgps'` y ref `rwgps-<id>`, y entra en las 3 propuestas como el resto.
- «Buscar en Ride with GPS» abre `ridewithgps.com/find` en una pestaña del usuario. La API no tiene búsqueda por zona y no se hace scraping: robots.txt bloquea `/routes/*.json` y los GPX de la web.
- **Código:**
  - `src/routes/sources/ridewithgps.ts` (lector de rutas) y `rwgpsImport.ts` (token, enlaces, colecciones y lote);
  - `rwgpsCredentials.ts`;
  - pruebas `tests/ridewithgps.test.ts` y `tests/rwgpsImport.test.ts`, y e2e `e2e/rwgps.spec.ts` (360 y 430 px);
  - nota en `docs/ridewithgps.md`.
- **Pendiente del usuario:** crear el API client, conectar y pegar los enlaces de rutas cercanas que le dio Claude Cowork.

**Siguiente: Garmin directo** (ver «Retomar aquí, tarde» más abajo).

## Retomar aquí (2026-11-11, tarde)

**Publicado hoy en `main`:**
- `b93ce11`: conector de Intervals.icu endurecido. La clave se guarda cifrada por cuenta y hay un bloqueo de sincronización por cuenta. Se siguen filtrando Strava y Garmin. El usuario lo ha probado con su clave y su id `i794435`: funciona y entra iGPSPORT.
- `ab89a3a` (merge de `e892b51`): Rutas de Wikiloc cerca y adaptación, marcador «→ FBikeTrain» (`public/wikiloc-marcador.html`), calidad de rutas y fuentes externas. GitHub Pages desplegado. Desplegadas las Edge Functions `route-sources` y `ai-routes`; no hay migraciones nuevas.
- Antes de publicar se corrigieron los hallazgos de la revisión de interfaz (break-ui):
  - `.btn.btn--wrap`: `kit.css` imponía `nowrap`.
  - Cifras con punto de miles («1.200»).
  - Km con un decimal por debajo de 10 km.
  - Estado de 0 rutas recibidas y concordancia de «1 ruta recibida».
  - Espera más larga en `tests/wikilocAdaptar.test.tsx`.
- Verificación sobre `main`: `tsc` sin errores, vitest 124 ficheros y 1580/1580. Los e2e de Wikiloc, break-ui-wikiloc, rutas, rutas-ia, fuentes-externas y biblioteca-calidad dan 44/44; el desborde de biblioteca-calidad ya no se reproduce.

**Abierto (menor, UI de Wikiloc):**
- Con 50 rutas, la recomendación de la IA queda muy abajo.
- El foco no va al primer campo con error.
- Falta avisar al lector de pantalla de que se abre una pestaña nueva.

**Pendiente del usuario:**
1. Probar Wikiloc en Chrome para Android. El formato del lector (`WIKILOC_FORMAT`, `src/bookmarklet/wikilocReader.ts`) y la descarga del GPX están hechos con fixtures sintéticos. Hay que validarlos contra la página real y ajustarlos con el usuario delante.
2. Enviar el correo de autorización del TFG (`docs/wikiloc-solicitud-acceso.md`).
3. Regenerar la API key de Intervals; se usó en la sesión para comprobar la API.

**Strava → Intervals → app: cerrado (comprobado el 2026-11-11 con la cuenta del usuario).** Con Strava vinculado en Intervals, la API devuelve 8 actividades con `source: STRAVA` como stub. Solo traen `id`, `start_date_local`, `icu_athlete_id` y `_note: "STRAVA activities are not available via the API"`. `/activity/{id}/file` responde 422. Vías válidas:
- el histórico, con la exportación «Descargar tu cuenta» de Strava;
- lo nuevo, con iGPSPORT → Intervals (`OAUTH_CLIENT`), que ya funciona;
- Garmin, con el conector directo.

**Siguiente: Garmin directo.** Codex se quedó sin cuota a medias en `C:	estTrain-garmin-intervals`, rama `codex/garmin-intervals`, desde `b93ce11`, sin commit. Ya retiró el puente Garmin vía Intervals. Dejó a medias:
- OAuth2 PKCE;
- `supabase/functions/garmin/` y `src/connections/garminServer/`;
- la migración `202611110001_garmin_connect.sql`, con tokens y RLS;
- `garminClient`, `garminSync` y `GarminProvider`;
- la UI `GarminConnection`, la fuente «Garmin» en las salidas y la página `#/privacidad` (contacto `fbiketrain@gmail.com`);
- los documentos `docs/garmin-directo.md` y el plan `docs/superpowers/plans/2026-11-11-garmin-directo.md`.

Lo que dice la documentación oficial de Garmin, según Codex:
- La API es gratuita, pero exige aprobación del Developer Program: Garmin da el client id y el secret al aprobar.
- Starter solo funciona con notificaciones push, para usuarios limitados y sin histórico.
- El backfill y el ping/pull son de Enterprise.
- La autenticación de las notificaciones no está documentada públicamente.


## 2026-11-11: Rutas de Wikiloc cerca y adaptación (publicado en `ab89a3a`)

Misma rama `codex/integracion-rutas`, sin commit. Plan: `docs/superpowers/plans/2026-11-11-wikiloc-cerca-adaptar.md`. Operativa, límites, instalación del marcador y cómo ajustar `WIKILOC_FORMAT`: [wikiloc-cerca.md](wikiloc-cerca.md).
- `#/rutas/wikiloc`: el usuario pide distancia (y desnivel opcional); «Buscar en Wikiloc» abre el mapa de ciclismo de carretera alrededor del inicio. La lista que trae el marcador se ordena por lo pedido (`rankForTarget`, de 0,5× a 1,6×); el nivel solo etiqueta y desempata. La IA elige de 3 a 5 con la operación `plan` y solo ve nombre, fuente, km y desnivel.
- Marcador «→ FBikeTrain» (`src/bookmarklet/`, `npm run build:bookmarklet` genera `public/wikiloc-marcador.html`): lee las rutas visibles o, en una ficha, hace la descarga oficial del GPX con la cuenta del usuario. Una petición por toque como máximo; no salta Premium, sesión ni confirmaciones. Entrega por `postMessage` a `#/rutas/wikiloc/recibir`, que solo acepta `https://*.wikiloc.com` y valida con zod.
- `#/rutas/wikiloc/adaptar` (`adaptRoute`, `src/routes/adapt.ts`): rota el circuito si pasa a menos de 300 m del inicio o lo une con conectores ORS; recorta (+8 %) o alarga (−20 %) con como mucho 4 consultas a ORS, y rechaza autopista, pistas, retroceso y saltos de más de 5 km. Guardar en la biblioteca con autor y enlace, y «Enviar al iGPSPORT» (Web Share o descarga GPX 1.1).
- Base Dexie de la cuenta: versión 5 con la tabla `wikilocNearby`; la lista y la ruta recibida caducan a los 7 días. Sin cambios en Supabase ni migraciones de servidor.
- **`WIKILOC_FORMAT` no está validado contra la página real.** Pendiente del usuario: validarlo en su navegador, probar el marcador en Chrome para Android y el envío al BSC200S, y enviar la solicitud TFG a Wikiloc ([wikiloc-solicitud-acceso.md](wikiloc-solicitud-acceso.md), versión TFG). Si Wikiloc la deniega, se quita la descarga del GPX por el marcador y se vuelve a la descarga manual.

## 2026-11-11: calidad de rutas e integración (publicado en `ab89a3a`)

Rama `codex/integracion-rutas` (worktree `C:	estTrain-integracion`) = `codex/rutas-calidad` + `codex/fuentes-externas`, terminadas e integradas por Claude. Sin commit.
- Lados distintos entre opciones, desnivel tenido en cuenta al parar la búsqueda y avisos honestos de distancia, desnivel y lado repetido.
- Puertos: Overpass por rectángulo y carretera más próxima; la IA elige `puertoId` con nombre, cota y distancia; una vuelta de ida y vuelta (más del 15 % de retroceso) no se atribuye al puerto.
- Biblioteca: las rutas importadas (GPX de Wikiloc incluido) se priorizan y sirven de esqueleto recalculado con ORS; «Basada en» solo si la ruta recorre ese esqueleto.
- Mediciones con ORS real y conclusiones en `docs/diagnostico-rutas-2026-11-11.md`: `round_trip` no mejora con más puntuación; la palanca real es la biblioteca.
- Al publicar hay que redesplegar `ai-routes` y `route-sources` (esquema con `biblioteca` y `puertos`). No hay migraciones nuevas.

## 2026-11-11: fuentes externas (publicado en `ab89a3a`)

Worktree **`C:\testTrain-fuentes-externas`**, rama **`codex/fuentes-externas`**, desde `main` en `d346a15`. No se ha cambiado main, ni hecho commit, push o despliegue. El material de diseño sin seguimiento de la worktree principal se conserva.

- **Punto 4 de Siguiente sesión:** Wikiloc por GPX aportado por el usuario, con biblioteca/IA conectadas localmente. Informe actualizado con fuentes oficiales y fecha: [fuentes-externas-2026-11-11.md](fuentes-externas-2026-11-11.md). Correo redactado **sin enviar**: [wikiloc-solicitud-acceso.md](wikiloc-solicitud-acceso.md). Marcador opcional aplazado hasta aclarar permiso de extracción de metadatos. Wikiloc automatizado sigue desactivado.
- **PWA:** la rama antigua `codex/pwa-compartir` (`dd1d0a1`) ya es antecesora de main, fusionada en `b489fc2`; **no necesita rebase ni otra fusión**. En la nueva rama se conserva el envío al recargar, se retiran solo ficheros procesados y se permite corregir GPX/TCX entre biblioteca e historial. Los ficheros con error del importador quedan pendientes. Descarte explícito y caducidad original de 24 h. Guía Android/iOS: [pwa-compartir.md](pwa-compartir.md).
- **Importación manual:** el input GPX/TCX de biblioteca ya estaba en main; se mantiene, se amplían tipos MIME, se aclaran los pasos desde Descargas/Archivos y se añade cobertura móvil. No crea actividades ni altera estadísticas, aunque el fichero tenga horas.
- **IA T3:** biblioteca consultada siempre, filtro local a 15 km del primer punto, prioridad y deduplicación, máximo seis referencias. Solo id, nombre, fuente, km y desnivel en prompt/petición compartida. Autor/enlace permanecen en atribución de pantalla; GPX conserva original. El recorrido nuevo de ORS puede ser distinto: la adaptación automática de geometría al objetivo sigue pendiente.
- **Publicación posterior:** desplegar `ai-routes` con el esquema que acepta fuente `biblioteca` **antes** del cliente actualizado. No requiere migración de base de datos. Publicación y commit requieren la autorización habitual; este lote los deja preparados.
- **Hallazgos de proveedores:** Ride with GPS API v1 pública, sin buscador geográfico general documentado; Intervals.icu admite recorridos en eventos compartidos desde marzo de 2026; iGPSPORT sí tiene plataforma OAuth por solicitud, además de importar GPX/TCX manualmente. No asumir disponibilidad de endpoints de rutas ni acceso concedido. El informe sustituye afirmaciones antiguas absolutas «iGPSPORT no tiene API» / «Intervals no admite rutas».

Verificación del lote y límites en `docs/verificaciones.md`. Prueba con Android y BSC200S reales pendiente del usuario; no se han usado tracks reales.

Cierre publicado anterior: 2026-11-10 por la noche (commits y push autorizados por el usuario), con `dc11295` desplegado según aquel registro. Base local de este lote: `d346a15`; el lote nuevo no se ha publicado.

### Fusionado el 2026-11-10 por la tarde (trabajo de Codex acabado y publicado)

- **Mapa de rutas** (`codex/mapa-rutas`): trazado bermellón con doble borde, para que no se confunda con los carriles bici de CyclOSM; panel de escritorio dentro de la ventana y botón «Encuadrar ruta»; `src/routes/quality.ts` penaliza tramos de ida y vuelta y bucles pequeños; una búsqueda gasta como mucho 6 consultas de ORS (`SEARCH_REQUEST_BUDGET`) y la IA reparte ese presupuesto entre sus opciones. Diagnóstico: `docs/superpowers/plans/2026-11-10-mapa-rutas.md`.
- **Inicio de escritorio A** (`codex/escritorio-inicio`): cabecera de lado a lado, cuatro KPI en fila, franja con el texto semanal y el próximo entreno, y última salida y tendencia a la misma altura. Maquetas: `docs/design/2026-11-10-escritorio-inicio/`.
- **Rutas: distancia y variedad** (Claude, a petición del usuario): la distancia pedida es un techo blando. Se apunta al 94 %, se aceptan del −20 % al +8 % y pasarse puntúa el triple que quedarse corto (`AIM_FRACTION`, `ROAD_FILTER.lengthUnder/lengthOver`, `DISTANCE_OVER_WEIGHT`). La longitud pedida a ORS se corrige en cada consulta con lo que se pasó en las anteriores. Primero se propone la mejor vuelta de cada lado del inicio (`src/routes/side.ts`). Las pistas asfaltadas ya no cuentan como pista. Con ORS real desde Granollers a 50 km: antes 1 ruta de 52,7 km; ahora 42 km limpia, 49,5 km hacia el este y 39 km hacia el oeste con aviso. Se probaron vueltas dirigidas con puntos de paso: cada punto metido en una calle lateral obliga a ir y volver por ella, así que se descartaron.
- **Conector de Intervals.icu** (`codex/conectores`): ver la sección del conector más abajo. Falta probarlo con la clave real del usuario.

## Resumen

La app está publicada en GitHub Pages con cuentas de Supabase y el servidor de IA y ORS compartidos en marcha. `main` despliega solo cuando el CI está en verde.

- Repositorio público: https://github.com/fraannr4/FBikeTrain (rama `main`).
- App: https://fraannr4.github.io/FBikeTrain/
- Cada push a `main` ejecuta:
  - `vitest`;
  - `test:db`;
  - el build, con la comprobación de que el bundle no lleva secretos;
  - el despliegue (`.github/workflows/deploy.yml`).
- Supabase: proyecto `btmsakyhkxrndvscmxqs`. Guía en `docs/supabase-configuracion.md`.

### Publicado (commits recientes)

| Commit | Qué |
|---|---|
| `8e1fc3f` | Los saltos del GPS ya no suman metros a la distancia |
| `59374c8` | Robustez del acceso, límite de 10 MB en el bucket de tracks y tiempos de test |
| `7efa992` | La caché de salidas se invalida al cambiar de cuenta |
| `b36ce54` | Una hoja que se cierra ya no roba el foco a la que se abre (CI del calendario) |
| `6fdc2e8` | Escena de bienvenida «Cumbre» tras un inicio de sesión real |
| `386a5fd` | IA y mapas desde el servidor (`ai-routes`, `ors-proxy`) y Empalmar rutas |
| `f794820` | Fusión de las fuentes de rutas de Codex: Wikiloc apagado, respaldo OSM |
| `8845887` | Reescritura de la documentación |
| `0a04198` | IA de rutas con referencias conocidas, filtro de autopista y «Proponer semana con IA» en Calendario |
| `6630691` | Imports `.ts` explícitos en `src/routes/sources` para que el empaquetador de Edge Functions los resuelva |
| `8da9efb` | Fusión de la paleta A «Atlas de montaña» de Codex (solo color; revisada) |
| `684a295` | Se ignora `supabase/.temp` |
| `8a7e831` | Se quita el acceso con Google: solo correo y contraseña |
| `c3c57e9` | Tres planes nuevos y `develop-phase.js` acepta `args.model` |

### Verificación actual (2026-11-10, sobre `c3c57e9`)

| Comprobación | Resultado |
|---|---|
| CI | en verde y desplegado en Pages |
| Servidor | `ai-routes`, `ors-proxy` y `route-sources` responden 401 sin JWT |
| Tests de acceso | 13/13 tras quitar Google |
| Paleta A | tokens y contrastes revisados; mapa oscuro de Salida con teselas reales |
| Wikiloc | 403 de Cloudflare, no se esquiva |
| Pruebas completas | las últimas cifras completas (98 ficheros, 1.227 tests, `tsc` y build limpios, `test:db` con 5 suites) son del lote de IA con referencias; el lote en curso las repetirá al cerrar |

Detalle en `docs/verificaciones.md`.

### Estado en Supabase (remoto): EN MARCHA

- Migraciones aplicadas y registradas (5 de 5): `202611090001`, `202611090002`, `202611100001`, `202611100002`, `202611100003`.
- Secretos: `GROQ_API_KEY`, `ORS_API_KEY`, `SHARED_AI_ENABLED`, `GROQ_FREE_TIER_CONFIRMED`, `SHARED_ORS_ENABLED` y `APP_ALLOWED_ORIGINS`. Las claves solo están en `.local-secrets/credenciales.md`.
- Funciones desplegadas: `ai-routes`, `ors-proxy` y `route-sources`.
- Variables del repositorio `VITE_SHARED_AI_ENABLED`, `VITE_SHARED_ORS_ENABLED` y `VITE_ROUTE_SOURCES_ENABLED` en `true`; Pages redesplegado.
- Cuotas: IA 12 al día por usuario, 40 globales, 2 por minuto por usuario y 3 globales (modelo `openai/gpt-oss-20b` en Groq); ORS 150 al día por usuario y 1.800 globales.
- Auth: Site URL y redirects de Pages y `localhost:5173`; SMTP de Brevo (30 correos por hora).
- Guía en `docs/supabase-configuracion.md`.

## Qué está hecho

### Funcionalidad (fases F1 a F5)

- **F1, importación y panel.**
  - Lee el ZIP «Descargar tu cuenta» de Strava: CSV con cabeceras en castellano y ficheros FIT, GPX y TCX, incluidos los comprimidos.
  - Trabaja en un Web Worker y guarda en Dexie/IndexedDB.
  - Descarta duplicados, actividades no ciclistas, salidas basura y picos de velocidad del GPS.
  - Regla `isTooShort` en `src/import/summary.ts`: una salida es demasiado corta si tiene menos de 60 s en movimiento, o menos de 200 m y menos de 10 min. Así se conservan las sesiones de rodillo.
- **F2, historial.** Lista con búsqueda, orden y filtros en una hoja inferior, guardados en la URL. Detalle de cada salida con mapa CyclOSM y perfil. Subidas con pasadas, VAM y dificultad. Repetidas.
- **F3, plan.** Calendario de entrenos y objetivos de volumen y de evento. La copia de seguridad incluye calendario y objetivos.
- **F4, rutas.**
  - Rutas circulares con OpenRouteService (`cycling-road`, filtros de asfalto y tipo de vía).
  - Puntuación frente al historial del usuario.
  - Exportación GPX 1.1 para el iGPSPORT BSC200S.
- **F5, rutas con IA.**
  - Preguntas guiadas a un modelo compatible con OpenAI, Groq por defecto, con validación zod.
  - La IA recibe solo cifras resumidas, nunca tracks ni «Casa». Lo cubre el test e2e `e2e/rutas-ia.spec.ts`.
  - Cancelar aborta las peticiones a ORS y a la IA (`src/ai/abort.ts`).

### Diseño, mobile-first

- Identidad «Relieve grabado», de montaña. Tema oscuro por defecto y claro completo. Tokens en `src/ui/styles/tokens.css`.
- La referencia de interfaz es el prototipo móvil `docs/design/prototipo-movil/`, que manda sobre `prototipo-final` y sobre los detalles de UI de los planes.
- Navegación con 5 pestañas abajo: Inicio, Historial, Rutas, Plan y Más.
  - Historial tiene un segmentado Salidas / Subidas / Repetidas.
  - Plan tiene un segmentado Calendario / Objetivos.
- Kit propio en `src/ui/components/`: Sheet (hoja inferior), SegmentedControl, Stepper, Toast, StateView, Skeleton, etc. Gráficas SVG en `src/ui/charts/`.
- Zonas táctiles de 44 px o más. Las pestañas miden 48 px.
- Al volver atrás se conservan el desplazamiento, los filtros y las filas cargadas en Inicio, Historial y Subidas.
- Cada pantalla pasó 2 rondas de auditoría con capturas a 360x780, 390x844, 412x915 y 430x932, en apaisado y en los dos temas.

### Extras fuera del plan

- Datos de ejemplo (`src/demo/demoData.ts`). «Ver con datos de ejemplo» está en Inicio vacío y «Quitar datos de ejemplo» en Más. Al quitarlos solo se borran las filas `demo-`.
- Contador de uso de ORS y de IA.
- Aviso de Plan en la pestaña.

### Rutas de la app (HashRouter)

`/`, `/historial`, `/historial/:id`, `/historial/subidas`, `/historial/repetidas`, `/rutas`, `/rutas/ia`, `/plan`, `/plan/objetivos`, `/mas`, `/importar`, `/ajustes`.


### Añadido el 2026-11-09 y 2026-11-10

- **Cuentas.**
  - Acceso obligatorio con correo y contraseña, recuperación y confirmación por correo. Google se quitó el 2026-11-10.
  - Perfil editable.
  - Una base IndexedDB por cuenta (`ciclismo-user-<uuid>`), sin mezclar datos entre cuentas.
- **Bienvenida «Cumbre».**
  - Escena de 1,8 s con el trazo de la marca y la silueta ciclista.
  - Solo tras un inicio de sesión real, nunca al recargar.
  - Se puede saltar y respeta el movimiento reducido.
  - `CyclingLoader` queda para las esperas reales.
- **IA y ORS desde el servidor.**
  - Selector entre el modo compartido (con cuenta y la variable activada) y la clave personal.
  - Si el servicio compartido falla, se vuelve a la clave personal.
  - Con cuota agotada (429), se muestra el límite y no se reintenta.
- **Empalmar rutas** (`/rutas/empalmar`).
  - Une dos rutas guardadas con conectores de ORS `cycling-road`.
  - Descarta autopista y autovía, saltos de más de 50 m y combinaciones demasiado largas para un track.
  - Si hay dos caminos parecidos, los propone y la IA recomienda uno usando solo cifras.
  - Exporta el GPX.
  - «Guardar en la biblioteca» en Rutas y en Rutas con IA.
- **Fuentes de referencia** (`route-sources`).
  - OSM (Overpass) es el respaldo activo.
  - Wikiloc está apagado hasta `WIKILOC_AUTOMATION_AUTHORIZED=true`.
  - Caché de 7 días y cuota por cuenta de 30 al día y 3 por minuto.
  - Detalle en `docs/fuentes-rutas.md`.

### Añadido el 2026-11-10 por la tarde

- **Servidor real en marcha.** Migraciones, secretos, funciones y variables como arriba. La IA y ORS compartidos funcionan sin pedir claves en Ajustes.
- **IA con referencias.** Rutas con IA se apoya en rutas conocidas y descarta las que usan autopista.
- **«Proponer semana con IA»** en Plan > Calendario.
- **Paleta A «Atlas de montaña»** en toda la app.
- **Acceso solo con correo y contraseña.** Google se ha quitado.

### Rutas de la app añadidas

`/rutas/empalmar`.

## Pendiente

### Siguiente sesión (acordado con el usuario el 2026-11-10)

1. **Conectividad.** Revisar con el usuario el conector de Intervals.icu (Ajustes > Conexiones, `docs/conectores-actividades.md`) con su clave real, y si iGPSPORT envía las salidas a Intervals.icu.
2. **Propuestas de la IA hacia lados distintos** (aprobado). Ahora cada opción del plan se busca por separado y se queda con la primera vuelta válida, así que varias pueden ir al mismo lado. Pasar los lados ya usados (`routeSide`, `src/routes/side.ts`) del planificador (`src/ai/routePlanner.ts`) al generador y descartarlos o penalizarlos. Prueba en `tests/routePlanner.test.ts`.
3. **Rutas «chulas» con puertos de montaña** (idea del usuario; diseñar antes con brainstorming y plan). Propuesta:
   - buscar puertos y collados cerca de Casa en OpenStreetMap por la API Overpass (`mountain_pass=yes`, `natural=saddle`, con `name` y `ele`, a 15-40 km), y sumar las subidas del historial;
   - la IA recibe solo nombres, cotas y distancias, nunca dónde está Casa, y elige;
   - el generador hace la vuelta pasando por el puerto con ORS `path`. El puerto está en carretera, así que no crea una punta de ida y vuelta, cosa que sí pasa con puntos de paso al azar.
4. **Contraste con rutas conocidas y Wikiloc.** Wikiloc no tiene API y su web está detrás de Cloudflare: no se automatiza ni se elude.
   - Vía principal: compartir el GPX desde la app de Wikiloc a la PWA (Android), que lo guarda en la biblioteca. Después, el lote IA T3: la IA recorta, alarga o empalma rutas de la biblioteca hasta el objetivo, y la geometría la recalcula ORS.
   - Opcional: un marcador del navegador que, en la página de Wikiloc abierta por el usuario, guarde solo nombre, cifras y enlace. Las condiciones de Wikiloc prohíben extraer el track.
   - Actualización 2026-11-11: hecho como «Rutas de Wikiloc cerca» (sección del principio y [wikiloc-cerca.md](wikiloc-cerca.md)). El marcador también hace la descarga oficial del GPX de una ruta, pendiente de la autorización que se pide a Wikiloc; el track nunca se extrae de la página.
   - Fuentes con acceso abierto: rutas ciclistas de OSM (ya en `findRouteReferences`). RideWithGPS tiene API con clave (por evaluar). Komoot y Outdooractive solo para socios.
5. **Detalles menores.**
   - La miniatura de la tarjeta de ruta sigue en azul `--trace` y el mapa va en bermellón: decidir si se igualan.
   - `splice.ts` y `roadPath.ts` aún cuentan como pista las pistas asfaltadas.
   - Los worktrees de Codex ya fusionados se pueden borrar con `git worktree remove`.


### Conector de actividades (rama `codex/conectores`, 2026-11-10)

Investigación y decisiones en `docs/conectores-actividades.md`. Fusionado en `main` y publicado el 2026-11-10: Ajustes > Conexiones permite guardar clave personal e id de Intervals.icu (incluido prefijo `i` o alias `0`), traer originales FIT/GPX/TCX por el Worker/importador actual con su informe de duplicados, y comprobar al abrir/reanudar como máximo cada 6 h. CORS permite lectura directa; no hay proxy, SQL nuevo ni claves en Supabase/backups. Configuración y seguimiento aislados por cuenta en IndexedDB. Se excluyen Strava y fuentes/dispositivos identificados como Garmin; Garmin directo queda para Personal/Starter. La app debe estar abierta. Antes de promover uso multiusuario, registrar OAuth de Intervals. Pendiente probar con una clave y dispositivo reales, y confirmar conexión nativa iGPSPORT en el móvil; no usar puentes con contraseña. El conector y el resultado de sus verificaciones se detallan en la guía y `docs/verificaciones.md`.

**Revisión del 2026-11-11 (`codex/conectividad-revision`), publicada en `b93ce11` y probada por el usuario con su clave: funciona.** El usuario ya confirmó lista 200, llegada iGPSPORT como `OAUTH_CLIENT`/`IGPSPORT 202`/`fit`/`Ride` y descarga original FIT sin gzip, CORS `*`; no facilitó su clave ni tracks al agente. Añadida regresión sintética con esos valores. Corregido el solape de siete días tras consultas en varias ventanas, deduplicación por ids propios y carreras al guardar/desconectar. Primera lectura propuesta: últimos 30 días sin historial o última salida real menos dos días; archivos para histórico anterior. Backoff 429/5xx acotado con Retry-After y sin retry 401/403. Credenciales AES-GCM con CryptoKey no exportable por cuenta, migración local, recuperación de clave dañada y proveedor de autorización separado del sincronizador. Guía móvil con acceso a ajustes, aviso de conexión directa sin Strava, botón «Sincronizar ahora» y estado. OAuth solo documentado en `docs/intervals-oauth.md`; ningún backend ni SQL nuevo. Verificación final y límites en `docs/verificaciones.md`. Falta probar el flujo diario en el móvil físico después de integrar/publicar con autorización.

### PWA y recepción de archivos (rama `codex/pwa-compartir`, 2026-11-10; revisión 2026-11-11)

Fusionado en main por `b489fc2`: manifest instalable, iconos de marca 192/512, SW propio que solo recibe POST multipart, pantalla `/compartido`, reanudación tras login y acción de instalación en Ajustes. Rutas de referencia mediante `importReferenceRoute`; actividades mediante el importador existente con su informe de duplicados. No hay precaché ni modo offline. La revisión sin publicar de `codex/fuentes-externas` conserva envíos al recargar, permite elegir biblioteca/historial para GPX/TCX y no consume los archivos que el importador no pudo leer. La biblioteca ya tiene selector manual como respaldo para iOS, que no admite `share_target`. Guía y límites: `docs/pwa-compartir.md`. Pendiente comprobar instalación y envíos desde Wikiloc/iGPSPORT en un Android real. Verificación en `docs/verificaciones.md`.

### Lote de IA con referencias y entrenos: HECHO (plan `docs/superpowers/plans/2026-11-10-ia-referencias-entrenos.md`)

- **Task 1. Referencias y solo carretera.**
  - Rutas con IA pide rutas conocidas a `route-sources` en un radio de 15 km, solo con `VITE_ROUTE_SOURCES_ENABLED` y con cuenta.
  - La IA recibe como mucho 6 referencias, cada una con nombre, fuente, km y desnivel, sin URL ni coordenadas, y puede basar una opción en una de ellas.
  - La tarjeta muestra «Basada en: …» con enlace al original.
  - Las rutas generadas que usan autopista (`waycategory`) se descartan. `usesMotorway` está compartido con Empalmar.
  - ORS no distingue autovía (trunk) de nacional: las dos cuentan dentro del límite de vías principales.
- **Task 2. «Proponer semana con IA» en Plan > Calendario.**
  - Propone de 1 a 7 entrenos para los próximos 7 días, adaptados al nivel y al próximo objetivo.
  - El código recorta las cifras al 15 % sobre la referencia, deja una sola salida larga y respeta los días ocupados.
  - El usuario elige qué añadir.
  - Usa la operación `workouts` de `ai-routes` o la clave personal, con respaldo ante 503 y sin reintento ante 429.
  - Si guardar falla a medias, reintenta solo lo que falta, sin volver a pedir a la IA.
- **Verificación.**
  - `npx vitest run`: 98 ficheros y 1.227 tests.
  - `tsc` y build limpios.
  - `test:db`: 5 suites.
  - e2e en verde: `ia-entrenos`, `break-ui-ia-entrenos`, `rutas-ia`, `rutas`, `plan` y `empalmar`.

### Lote de IA: Empalmar y objetivo HECHOS (`031a5c4`); referencias de biblioteca preparadas sin publicar

Plan `docs/superpowers/plans/2026-11-10-ia-empalmes-objetivo-biblioteca.md`. El workflow se paró a propósito antes de la Task 3 (presupuesto semanal al 15 %).
- T1 hecha: Empalmar hasta 3 tramos en el orden elegido, salidas del historial como tramo, guardar el empalme en la biblioteca y «Empalmar con…» desde la tarjeta de IA (guardado automático). e2e `empalmar`, `break-ui-empalmar` y `rutas-ia`: 17/17 en el verificador del workflow.
- T2 hecha: el objetivo (evento más próximo; si no, el volumen vigente; solo cifras, nunca nombres) va en los prompts de plan y de empalme con `aiGoalSchema` estricto; cuota de la IA 30 por usuario y 300 globales al día, 10 globales por minuto (migración `202611100004`, aplicada en remoto el 2026-11-10). `ai-routes` redesplegada ese día.
- T3 implementada el 2026-11-11 en `codex/fuentes-externas`: referencias de biblioteca con enlace y autor del GPX (`ReferenceRoute.author`, `referenceSite`, `libraryReferences`, `pickReferences`, fuente `biblioteca`), prioridad local y campos permitidos en prompt/cliente compartido. Pendientes commit/fusión autorizados y publicación coordinada de `ai-routes` y frontend. No relanzar el workflow sobre esta tarea sin revisar primero estos cambios.
- Verificado antes del commit: `tsc`, `vitest` (98 ficheros), `test:db` (6 suites), `build`. No se repitió el e2e tras la T2.
- En el móvil, pendiente: con un evento en Objetivos, que el «motivo» de una ruta con IA y la recomendación de Empalmar citen el objetivo.

Planes en cola, escritos y commiteados, sin lanzar:
1. `docs/superpowers/plans/2026-11-10-zona-buscador-amigos.md` (migración `202611100005`).
2. `docs/superpowers/plans/2026-11-10-retos.md` (migración `202611100006`).

Orden: lote de IA, amigos, retos. Cada uno con commit, push, CI y migración remota.

Decisiones del usuario que mandan: zona tras el login («al menos el pueblo»); búsqueda de personas por nombre, para cualquiera; búsqueda cercana a 25 o 50 km; retos 1 contra 1 entre amigos, plazo de 30 días, salidas elegidas a mano y visibles solo para los dos; sin valoraciones de rutas por ahora; paleta A.

### Ramas de Codex: FUSIONADAS el 2026-11-10

- `codex/pwa-compartir` en `b489fc2`: PWA instalable y Web Share Target (GPX, TCX, FIT). Ajustado al fusionar: `id` del manifest `/FBikeTrain/`, `text/xml` y `application/xml` aceptados. Límites conocidos: sin icono maskable; el envío se consume al leerlo. Falta probarlo en un Android real.
- `codex/escritorio` en `e8b64fa`: escritorio desde 1024 px. Corregido al fusionar: `Page.tsx` ya no remonta los hijos al llegar el mapa, Rutas deja cambiar la salida con resultados y Calendario conserva la tira semanal. Menores sin hacer: `useDesktopLayout` se resuscribe en cada render, umbrales 1024/1280 repetidos, `HistoryWorkspace` con dos `Page`, sin prueba de capturas a 390 px contra main.
- Arreglo del mismo día (`cdda84f`): ORS responde `waytype` en vez de `waytypes`; las rutas fallaban con «algo inesperado». `ors-proxy` redesplegada.
- Mismo día, tarde: `6f8f2f4` las búsquedas de rutas no se quedan vacías (8 semillas de más, 5xx de ORS saltados, vueltas cercanas con aviso como último recurso; desde Granollers solo 2 de 8 vueltas pasaban el filtro por pistas). `e6f045f` escritorio: Inicio en dos columnas equilibradas, páginas de 1520 px desde 1440, rail ancho desde 1280.
- Siguiente encargo a Codex: conectores de actividades (intervals.icu como puente; Garmin Starter cuando lo aprueben), rama `codex/conectores`.

### Necesita al usuario

1. **Garmin.** Enviar el formulario de Garmin Starter (`docs/garmin-solicitud-starter.md`). Falta una página pública de privacidad en `#/privacidad`. Opcional: una clave Garmin Personal en `credenciales.md`.
2. **En el móvil.** Probar una ruta con IA que cite una referencia, la semana con IA en el calendario, un empalme exportado al BSC200S y fijar la zona.
3. **Seguridad.** Rotar el token de Supabase y la clave SMTP de Brevo. Aplazado porque es una app de pruebas.
4. **Comprobaciones antiguas sin registrar:** F2, una subida conocida contra Strava; F3, vincular un entreno con una salida real. Ver `docs/verificaciones.md`.

### Hoja de ruta

Amigos, Retos, Garmin Starter, comprobación física de la PWA, conector opcional de Intervals.icu y sincronización de salidas con Supabase. iGPSPORT admite GPX/TCX en su app y ofrece plataforma OAuth por solicitud; sus endpoints de rutas y la conexión nativa con Intervals deben confirmarse por separado (informe de fuentes del 2026-11-11).

### Pendiente técnico

- **Sincronización.** Subir a Supabase las salidas, los tracks, el calendario y los objetivos, y la comparativa social. Plan: `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md`. Hoy los datos siguen en el IndexedDB de cada cuenta en cada dispositivo.

### Mejoras opcionales (no bloquean)

- Dividir el bundle con `import()` por pantalla.
- Leer el ZIP de Strava en streaming.
- Añadir los nombres en castellano que falten en `CYCLING_TYPES`.
- Añadir una prueba e2e de la copia de seguridad.

## Límites conocidos

- El BSC200S no se detecta por USB. Se probó con el dock, con un puerto directo y con 2 cables. El GPX se pasa con la app de iGPSPORT.
- No se usan la API ni el MCP de Strava: piden suscripción.
- Wikiloc bloquea el acceso automatizado con Cloudflare (403 con desafío, incluso en `robots.txt`). No se esquiva: el usuario descarga el GPX con su cuenta y lo importa.
- ORS no distingue autovía (trunk) de nacional: solo se filtra la autopista (motorway).
- La IA no ve el mapa, solo cifras.
- Las salidas aún no se sincronizan con Supabase.

## Datos útiles

- ZIP real: `C:\Users\Fran.Romano\Downloads\export_180782712.zip`. Nunca va al repositorio.
- Servidor de desarrollo para el móvil: `npx vite --host 0.0.0.0 --port 5173 --strictPort`, en http://192.168.1.141:5173.
- Playwright usa el puerto 4173 con reutilización; ese puerto debe quedar libre.
- El prototipo móvil se sirve sin caché con `node docs/design/prototipo-movil/servir.mjs` en el puerto 5174. Después de tocar su CSS o su JS hay que ejecutar `version.mjs`.
- Presupuesto: el usuario pide no pasar de un 60 % del límite semanal de tokens. Se usan agentes Sonnet, la verificación la hace la sesión principal con comandos y no se lanzan workflows grandes.
