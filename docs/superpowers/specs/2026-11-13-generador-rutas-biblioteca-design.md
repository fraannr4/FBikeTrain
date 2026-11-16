# Generador único de rutas con biblioteca común de referencia

Fecha: 2026-11-13. Estado: borrador para aprobar.

## Intención

Hoy las rutas propuestas son malas. El 2026-11-13, en la prueba real desde Caldes (`scripts/check-nearby.ts`), salieron 2 vueltas para 60 km y 1 para 60 km y 800 m. El diagnóstico está en el traspaso del 2026-11-13. Causas:
- El factor carretera/línea recta es fijo y vale 1,3, cuando en la realidad es de 1,4 a 2.
- Una consulta por combinación, sin corregir la vuelta.
- Puntos de paso elegidos por etiquetas de OSM.
- ORS elige las carreteras entre 1 o 2 puntos.
- La diversidad se mide por rumbo.
- La IA recibe poco contexto.

El usuario quiere que el sistema **aprenda la zona a partir de rutas reales de ciclistas**: qué carreteras se usan, cuántos km tienen las vueltas y cuánto suben. Con eso debe montar vueltas por su cuenta, **sin buscar por nombre**. También quiere **un solo generador de rutas** que funcione bien, en lugar de varias pantallas a medias.

## Objetivos

- Una biblioteca común de rutas de referencia en Supabase. La carga el administrador a partir de Ride with GPS, Komoot, Bikemap, Wikiloc y Strava (GPX).
- Un mapa de calor por cuadrículas, sacado de esa biblioteca. Da para cada cuadrícula cuántas rutas pasan y cuánto suben por km.
- Un generador único que, para un inicio, unos km y un desnivel opcional, devuelve **de 3 a 5 propuestas** que mezclan:
  - **(B) Rutas de la biblioteca adaptadas:** las de la zona que encajan con los km y el desnivel, adaptadas a la salida del usuario con `adaptRoute`.
  - **(A) Vueltas nuevas sobre los tramos populares:** de 4 a 6 puntos de paso en las cuadrículas más transitadas, colocados en anillo. ORS las une con el perfil `cycling-road`.
  - Si no se llega a 3, se completa con más vueltas de tipo A con criterios más amplios. No vuelve el motor de puertos y cimas.
- Criterio de éxito, comprobado contra Overpass/ORS reales con el script de prueba (antes de publicar): desde Caldes (41.6327, 2.1677), **al menos 3 propuestas válidas y lo ideal 5**, en dos casos: 60 km, y 60 km con 800 m. Una propuesta es válida si:
  - cumple 60 km ±10 % y, si se pide, el desnivel ±25 %;
  - es de asfalto, con un máximo del 20 % de carretera principal y sin pistas;
  - se solapa menos del 70 % con las demás propuestas.
- Mobile-first (`docs/requisito-mobile-first.md`). Se valida con capturas a 360-430 px.

## Lo que no entra

- Que un modelo de lenguaje «aprenda» el mapa. Un LLM no conserva nada entre búsquedas y no puede recibir trazados. El aprendizaje es el mapa de calor y lo usa el motor. **(Decisión mía.)** El generador no usa IA en esta versión. Si después hace falta, recibirá solo cifras del mapa de calor.
- Que los usuarios suban rutas a la biblioteca común. La alimentan:
  - el administrador, con un script;
  - la sincronización de Ride with GPS;
  - el llenado automático de zonas desde Ride with GPS (apartado 2).

  Las rutas personales siguen en la biblioteca del móvil.
- Un enrutador propio o el ajuste de los trazados a OSM.

## Cosas que no pueden pasar (aunque técnicamente funcione)

- Publicar sin la prueba real desde Caldes.
- Meter GPX, tracks o «Casa» en el repositorio, que es público. Los GPX de origen viven en `.rutas/`, ignorado por git.
- Mandar a la IA o a terceros trazados o la dirección de «Casa».
- Mandar vueltas por carreteras principales, por pistas o con mucho ida y vuelta por la misma carretera, aunque cuadren los km.

## Restricciones

- ORS gratuito, compartido: 2.000 consultas al día y 40 por minuto. Nuestros límites son 1.500 al día y 38 por minuto por persona, y 1.900 y 38 en total. ORS admite 8 puntos de paso.
- Overpass público es lento en frío. Los puntos de paso ya no hacen falta para el generador nuevo.
- Las tablas se crean con migraciones `supabase/migrations/`, con test en `supabase/tests/` ejecutado por `npm run test:db`. Se aplican en producción con la Management API.
- La privacidad de las rutas personales no cambia: el historial del usuario no sale del navegador.

## Enfoques considerados

1. **Mapa de calor por cuadrículas y puntos de paso en anillo (elegido por el usuario).** Se reutiliza `buildCellCounts` (`src/metrics/grid.ts`, cuadrícula de 200 m) y la lógica de `historyWaypoints.ts`. Es un esfuerzo medio y fija la carretera con varios puntos. Funciona peor en zonas con pocas rutas cargadas.
2. **Empalmar trozos de rutas de referencia.** Cada tramo es real, pero es difícil cuadrar los km cuando la salida no está en ninguna ruta.
3. **Red de carreteras propia con un enrutador.** Es lo más preciso, pero también mucho más trabajo.

## Diseño

### 1. Datos (Supabase)

- **Tabla `reference_routes`** (sustituye a `rwgps_route_index` y migra sus filas). Campos:
  - `id` uuid;
  - `source` (`rwgps` | `komoot` | `bikemap` | `wikiloc` | `strava` | `other`);
  - `source_id`;
  - `url`;
  - `name`;
  - `distance_m`;
  - `elev_gain_m`;
  - `start_lat`/`start_lng`;
  - la caja (`min_lat`…`max_lng`);
  - `line` jsonb, hasta 2.000 puntos `[lng, lat, ele?]`;
  - `loop` (bool);
  - `unpaved_pct`;
  - `imported_at`.

  `unique(source, source_id)`. Solo la usa `service_role`, como la tabla actual.
- **Tabla `reference_heat_cells`:** `cell` (clave de `cellKey` a 200 m), `lat`, `lng`, `routes` (rutas distintas que pasan), `climb_m_per_km` (media de subida en la cuadrícula) y `ele`. Se recalcula entera después de cada importación con una función SQL o desde el script de importación.
- **Lectura desde el móvil:** con una nueva operación de `route-sources` (`kind: 'library'`) se pide un círculo (inicio y radio) y devuelve:
  - las cuadrículas de calor del círculo (solo celdas y cifras);
  - las rutas de referencia cuya caja corta el círculo, con trazado simplificado para adaptarlas;
  - el **factor de carretera de la zona**, la mediana entre la longitud de cada ruta y el perímetro de su polígono de 6 puntos;
  - la **subida típica**, en m/km.

  Usa la caché y la cuota de `route-sources` que ya hay.

### 2. Carga (script del administrador)

- `scripts/library-import.ts`. Toma:
  - los ID de Ride with GPS, que se leen de su API pública;
  - los GPX de `.rutas/` (cualquier nombre), de Ride with GPS (ya convertidos), Komoot, Bikemap, Wikiloc y Strava.

  Valida, descarta lo que no es asfalto (con `unpaved_pct` si se conoce), simplifica a 2.000 puntos como máximo, hace un upsert en `reference_routes` y recalcula `reference_heat_cells`. Escribe con la Management API o con la clave de servicio de `.local-secrets`, nunca desde el móvil.
- Primera carga: las 64 rutas de `.rutas/rutas-caldes.md` (54 de Ride with GPS, que se cargan solas, y 10 de Komoot y Bikemap, cuyos GPX descarga el usuario). Para la prueba de aceptación bastan las 54 de Ride with GPS. Los GPX de Komoot y Bikemap van en paralelo y no bloquean la publicación. **(Decisión mía.)**
- **Solo rutas publicadas por su autor** (rutas planificadas públicas). Nunca actividades del administrador ni de nadie: una actividad empieza y acaba en «Casa». **(Decisión mía.)**
- **Sincronización de Ride with GPS** (Edge Function `rwgps`, `runSync` cada 6 h desde las colecciones de la cuenta común): se mantiene, pero escribe en `reference_routes` con `source = 'rwgps'` y trae el trazado completo con altura. Las filas de `rwgps_route_index` no se migran tal cual, porque tienen 300 puntos y no traen altura. Se vuelven a importar sus ID con trazado completo y luego se borra la tabla antigua. Las filas `source = 'user'` del índice viejo se descartan. **(Decisión mía.)**
- **Llenado automático de zonas (decisión del usuario).** Si una búsqueda tiene menos de unas 15 rutas de referencia en el círculo, `route-sources` busca en Ride with GPS rutas públicas de carretera de esa zona. Usa la API de la cuenta común si tiene búsqueda; si no, el buscador público `find/search.json`, con el control de ritmo por proveedor que ya existe. Filtra las de carretera con poca tierra, las importa en `reference_routes`, recalcula las cuadrículas de esa zona y genera con ellas. La primera búsqueda en una zona nueva tarda más, y la barra de progreso lo indica. Si aun así no hay rutas, la pantalla da un aviso y 0 tarjetas: no se proponen vueltas de mala calidad.

### 3. Generador

`src/routes/library/generate.ts`. Funciones puras con dependencias inyectadas, como hoy `nearby.ts`.

1. Pide a `route-sources` la biblioteca de la zona: un radio de unos 0,45 veces la distancia pedida, entre 8 y 40 km.
2. **B, rutas adaptadas.** Busca rutas de referencia con una longitud de entre el 70 % y el 140 % de la pedida, cuyo trazado pase a menos de 5 km del inicio. Las ordena por parecido en km y desnivel y las adapta con `adaptRoute` (modo `mi-inicio`, con los km pedidos). Como mucho 2 propuestas de tipo B.
3. **A, vueltas nuevas.**
   - Elige cuadrículas con `routes` ≥ 2, y ≥ 1 si la zona tiene pocas rutas.
   - Para cada sector candidato (anillos con distintos ejes):
     - toma de 4 a 6 cuadrículas populares en orden angular alrededor del inicio;
     - fija el radio con el factor de la zona para que la estimación dé los km pedidos;
     - con desnivel pedido, prefiere los sectores cuyo `climb_m_per_km` de media da el desnivel.

     Una consulta a ORS con todos los puntos. Si la longitud se desvía más del 10 %, hace una segunda consulta con el radio corregido. Esa segunda consulta mide el factor real; es la «corrección».
4. **Filtros**, los de `analyze.ts`:
   - asfalto y pistas;
   - carretera principal, hasta el 20 %;
   - retroceso, lo de `geometryQuality`;
   - longitud y desnivel.

   Diversidad por **solape** (menos del 70 %) en lugar de por rumbo. El solape se mide por cuadrículas de 200 m compartidas: celdas comunes entre las celdas de la vuelta más corta. **(Decisión mía.)**
5. Devuelve de 3 a 5 tarjetas, con avisos si no llega.
6. **Presupuesto:** unas 20 consultas a ORS por búsqueda. Con 38 por minuto no hay esperas. La barra de progreso se mantiene.

### 4. Pantallas

- **Una sola pantalla de generador en `#/rutas`.** Entradas: inicio («Casa», ubicación actual o un punto en el mapa), km y desnivel opcional. Salen de 3 a 5 tarjetas con mapa, cifras, una etiqueta «De la biblioteca» o «Nueva» y botones para guardar en la Biblioteca y exportar el GPX para el BSC200S. Abajo, plegados, los enlaces a la búsqueda de Wikiloc y a Ride with GPS Explore con los filtros, como hoy.
- **Se quitan:**
  - la pantalla actual Rutas (vuelta circular de ORS);
  - Rutas con IA (`#/rutas/ia`);
  - Rutas cerca (`#/rutas/cerca`), cuya ruta pasa a redirigir a `#/rutas`;
  - Empalmar (`#/rutas/empalmar`), **decisión mía**: es otro generador.
- **Se conservan:** Biblioteca (`#/rutas/biblioteca`) y Ruta compartida (`#/rutas/compartida`).
- **Se borra el código** que solo usaban esas pantallas: `nearby.ts`, `waypointEngine.ts`, `sources/waypoints.ts`, el motor de puertos, `rwgpsProposals.ts`, `generator.ts` si nadie más lo usa, el cliente de IA de rutas y la Edge Function `ai-routes` si queda sin uso. Primero se comprueba con grep, porque hay componentes como `AiRoutes.tsx` que pueden usarse en otras pantallas.

### 5. Comprobación

- Pruebas unitarias con fixtures sintéticos:
  - mapa de calor;
  - factor de zona;
  - selección del anillo;
  - corrección de longitud;
  - diversidad por solape;
  - mezcla de A y B;
  - de 3 a 5 resultados.
- Tests SQL de las tablas y de la operación de la biblioteca.
- `scripts/check-nearby.ts` pasa a `scripts/check-generator.ts`, contra la biblioteca de producción, ORS real y Caldes, en los dos casos. Hay que enseñar su salida antes de publicar.
- e2e de la pantalla a 390 px, con capturas.

## Lo que queda al constructor

- El tamaño exacto de los sectores, el número de anillos que se prueban y la manera de repartir el presupuesto entre A y B.
- Cómo simplificar el trazado: Douglas-Peucker o muestreo fijo.
- Si `reference_heat_cells` se recalcula en SQL o en el script.
- El orden de borrado del código viejo, con tsc, tests y build en verde en cada paso.
