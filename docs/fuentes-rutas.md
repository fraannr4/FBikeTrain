# Fuentes de rutas de referencia

## Actualización del 2026-11-11

Informe vigente de proveedores, fuentes oficiales consultadas y recomendación: [fuentes-externas-2026-11-11.md](fuentes-externas-2026-11-11.md). Borrador **sin enviar**: [wikiloc-solicitud-acceso.md](wikiloc-solicitud-acceso.md). Lo que sigue conserva el diseño técnico y la verificación histórica de noviembre de 2026; los apartados que dicen «sin desplegar» describen aquella entrega, no el estado actual de main (ver `ESTADO.md`).

La vía principal de Wikiloc es **GPX aportado por el usuario**, mediante Android/PWA o selector manual en la biblioteca (también iOS). No se habilita el adaptador automatizado. La nueva rama `codex/fuentes-externas` conecta esa biblioteca con la IA: prioridad a referencias próximas, máximo seis tras filtrar/deduplicar; al modelo solo nombre, fuente, km y desnivel, más identificador local. Autor y enlace quedan en la interfaz. La fuente `biblioteca` exige desplegar el esquema actualizado de `ai-routes` junto al cliente; no se ha desplegado en este encargo.

Las propuestas de IA siguen generándose con ORS usando sus cifras: citar un GPX no hace que ORS reproduzca su geometría. Las herramientas de biblioteca y Empalmar sí utilizan el track local. No se implementa aún adaptación automática de sus tramos al objetivo.

Revisión de PWA: `codex/pwa-compartir` ya era antecesora de main, fusionada en `b489fc2`; no hay fusión/rebase pendientes. En la nueva rama se corrigen conservación del envío y elección de destino. Guía actualizada: [pwa-compartir.md](pwa-compartir.md).

Fecha: **2026-11-09**. Rama `codex/fuentes-rutas`. Módulo sin UI; no se han hecho commit, push, migraciones remotas ni despliegue.

## Contrato y uso

`src/routes/sources/client.ts` exporta `findRouteReferences({ lat, lon, radiusM }, supabase.functions, signal?)`. Usa la sesión del cliente Supabase proporcionado, sin importar ni copiar claves. Prueba primero Wikiloc; ante error, respuesta inválida o lista vacía prueba OSM. Si también falla OSM, lanza `RouteSourceError('unavailable')`; una respuesta OSM válida vacía devuelve `[]`. Cancelar no dispara el respaldo.

`RouteReference` se exporta desde `schema.ts` y contiene `{ source, url, author, name, distanceM, ascentM, geometry?, fetchedAt }`. Las unidades son metros. `ascentM: null` significa desconocido (OSM no aporta elevación); no se inventa un desnivel cero. `geometry` es GeoJSON `MultiLineString`, coordenadas `[longitud, latitud]`, para conservar huecos sin conexiones ficticias. `fetchedAt` es la fecha de la consulta al proveedor y no cambia al reutilizar caché. Entradas y salidas se validan con zod, incluidos dominio de origen, fechas, magnitudes y geometría.

La Edge Function `route-sources` admite POST JSON `{ source: 'wikiloc' | 'osm', lat, lon, radiusM }` (Wikiloc por defecto). Latitud entre -85 y 85, longitud entre -180 y 180 y radio entero de 100 a 25.000 m. **Antes de calcular la clave y consultar cualquiera de los proveedores**, redondea lat/lon a tres decimales y el radio hacia arriba a pasos de 5 km (mínimo 5 km). Por ejemplo, `40.12341,-3.12341,5001` se consulta y cachea como `40.123,-3.123,10000`. Se usa la misma consulta normalizada para el filtrado geográfico. Requiere JWT de sesión válido, verificado mediante `auth.getUser`; rechaza usuarios Supabase anónimos (`is_anonymous`) y exige CORS con orígenes explícitos. No admite URLs ni parámetros arbitrarios enviados por el cliente. Respuesta: `{ data: RouteReference[] }` o `{ error: { code, message } }`; slot ocupado devuelve HTTP 429 y `Retry-After: 30`; cuota agotada devuelve `quota_exceeded` y su tiempo restante.

## Qué funciona localmente

- HTML español sintético de Wikiloc: enlaces de rutas de carretera (`rutas-ciclismo`), nombre H1, autor con enlace de perfil, distancia y desnivel positivo, con coma decimal/punto de miles. Solo se visita una búsqueda y hasta tres fichas, sin paginación. Ante `blocked` o `html_changed` en una ficha o GPX, corta el bucle sin pedir más páginas. Devuelve las fichas obtenidas, incluida la actual si solo falla su GPX; si no había ninguna ficha válida, devuelve error controlado sin cachear un vacío. Los errores de la página de búsqueda tampoco se cachean.
- GPX: solo un enlace `.gpx` explícito, HTTPS, sin parámetros y en un host Wikiloc permitido. Nunca formularios, endpoints privados, cookies, sesiones ni redirecciones. Lee tracks/segmentos y rutas GPX, con o sin prefijos XML, rechazando DTD/entidades y coordenadas inválidas. Si el fichero no es público o no es GPX, conserva los metadatos sin geometría.
- OSM: consulta Overpass de relaciones `type=route`, `route=bicycle`, redes `lcn`, `rcn`, `ncn`, y sus vías con etiquetas y geometría. Descarta la relación completa si falta una vía o hay subrelaciones no resueltas, motorway/trunk (también enlaces), prohibición de bici/acceso o superficies claramente incompatibles con carretera. No devuelve una ruta rota ocultando sus tramos peligrosos. Comprueba cercanía a vértices y segmentos. Calcula distancia con haversine por vía, sin sumar huecos. Atribución siempre `© OpenStreetMap contributors`, más el operador si existe; enlace a la relación OSM.
- Caché PostgreSQL compartida con TTL exacto de 168 horas; incluye resultados vacíos válidos. Solo `service_role` puede leer/escribir. Clave `v2` SHA-256 de fuente y consulta **cuantizada**, sin reutilizar las claves `v1` anteriores (un hash no anonimiza coordenadas). Se valida también el payload al leerlo y no se sirven filas caducadas ni geometrías que excedan el límite. La RPC `write_route_sources_cache` purga hasta **100 filas vencidas por escritura**, mediante selección con límite y `FOR UPDATE SKIP LOCKED`, y hace upsert en la misma transacción. Conserva filas vigentes. Errores de DB cierran la consulta antes de llamar al proveedor.
- Geometría de respuesta y caché: máximo **2.000 puntos totales por ruta**, no por segmento. Las rutas grandes se simplifican por distancia radial (tolerancia desde 10 m, duplicada hasta caber), conservando todos los segmentos y sus extremos. No se recalculan distancia/desnivel sobre la geometría simplificada. La RPC aplica también el límite de 2.000 puntos como defensa en la escritura.
- Cuota compartida entre fuentes por `user.id`: **30 búsquedas/día UTC y 3/minuto**, ventanas fijas y bloqueo transaccional por cuenta. Se consume tras validar sesión/petición/activación, **antes de caché y de reclamar cualquier slot global**. Los hits de caché cuentan; el respaldo OSM es otra búsqueda si se llega a consultarlo. Cada ficha/GPX de una misma búsqueda no vuelve a consumir cuota por usuario. Las aceptadas consumen aunque después falle el proveedor o esté ocupado el slot; no hay reembolso. Peticiones inválidas, anónimas o con Wikiloc desactivado no consumen; rechazos de cuota tampoco incrementan contadores. La tabla `route_sources_usage` y `consume_route_sources_quota` son exclusivas de `service_role`; la RPC comprueba además que la cuenta existe y no es anónima.
- Límite global de una concesión HTTP por segundo y proveedor, con bloqueo transaccional en PostgreSQL, más espera local de 1.050 ms entre las peticiones de Wikiloc. Cada búsqueda, ficha y GPX consume una concesión; los hits de caché no consumen slot global. No hay reintentos automáticos ni rotación de IP/User-Agent. User-Agent identificable: `FBikeTrain-RouteSources/1.0 (+https://github.com/fraannr4/FBikeTrain)`.
- Límites de tamaño: petición 2 KiB, HTML/GPX 2 MB, respuesta Overpass 8 MB, hasta 10 referencias de salida; tiempo de proveedor 10 s y de operación 30 s. No se registran respuestas, tokens ni errores crudos.

## Qué falta o puede fallar

**Wikiloc no está operativo contra el servicio real.** No hay autorización previa acreditada ni se ha confirmado un endpoint público de búsqueda apto para automatización. La función devuelve `wikiloc_authorization_required` sin hacer peticiones mientras no exista activación explícita en el servidor. Se ha preparado y probado el adaptador, no demostrado compatibilidad con el HTML real actual. Una URL/estructura distinta requiere ajustar el adaptador con permiso; no se usan endpoints ocultos ni navegador para sortear restricciones.

El buscador Wikiloc depende de una plantilla de URL confirmada por el operador tras obtener permiso. Admite `{lat}`, `{lon}`, `{radiusM}`, o los cuatro límites `{south}`, `{north}`, `{west}`, `{east}`. **No se incluye una URL de búsqueda inventada como si estuviera verificada.** Las pruebas contienen una URL ficticia. Solo se aceptan `es.wikiloc.com` y `www.wikiloc.com`. Para consultas que cruzan el antimeridiano, el adaptador Wikiloc falla de forma controlada y permite pasar a OSM. Si la búsqueda usa un rectángulo, sus esquinas exceden el radio circular: sin coordenadas verificables en la ficha no se garantiza radio estricto para esos candidatos. No se intentan adquirir GPX que requieran cuenta, Premium o captcha.

OSM es una referencia ciclista, no una garantía de asfalto, legalidad actual, dirección de marcha ni continuidad. Vías sin `surface` pueden pasar los filtros; redes ciclistas pueden incluir caminos. No hay cálculo de empalmes, elevación ni enrutamiento navegable. Un futuro motor cartográfico debe validar carretera/conexiones antes de ofrecer una ruta para circular. Relaciones enormes, incompletas o anidadas pueden descartarse o dar error controlado por límites. Overpass puede estar saturado, bloquear o agotar el timeout. No se ha consultado una zona real en esta tarea ni verificado el servicio desplegado.

La limitación SQL está probada en PostgreSQL embebido, no entre conexiones de un proyecto remoto. No hay cron: las escrituras purgan como máximo 100 filas vencidas; si el módulo queda inactivo, pueden permanecer físicamente filas expiradas, siempre excluidas de las lecturas. Los contadores viejos se purgan por cuenta, en lotes de hasta 100 al aceptar búsquedas. El despliegue debe dimensionarse a las condiciones de Overpass, más restrictivas que solo 1 petición/s para uso continuado. Los permisos de Supabase remoto y el bundling del CLI necesitan smoke test antes de activar en producción.

## Condiciones consultadas (2026-11-09)

- [Wikiloc, condiciones legales, apartado 1.2](https://www.wikiloc.com/wikiloc/terms_es.html): condiciona el acceso automatizado a autorización expresa previa; que una página sea pública no acredita ese permiso. Los derechos sobre contenidos siguen siendo de sus titulares. Guardar autor/enlace y reducir frecuencia no sustituye la autorización. La página indica revisión de marzo de 2022. Por eso Wikiloc queda desactivado por defecto.
- [Ayuda oficial: API para desarrolladores](https://help.wikiloc.com/article/102-api-for-developers): no ofrece API pública; última actualización indicada, 2025-02-05.
- [Ayuda oficial: página en blanco al descargar](https://help.wikiloc.com/article/191-blank-page-trying-download-trail-track-route): documenta bloqueos automáticos ante uso excesivo; última actualización indicada, 2025-02-10. No se intenta eludirlos.
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL): consulta `around`, relaciones y salida geométrica.
- [Instancias y políticas de Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API): instancia pública de FOSSGIS, identificación de aplicación, uso moderado, caché y límites; el uso continuado agrega todas las personas de la app. Revisar esa política antes de activar y dimensionar el despliegue.
- [Copyright y licencia OSM](https://www.openstreetmap.org/copyright): atribución a colaboradores de OpenStreetMap y licencia ODbL. Preservar autor/enlace y mostrar atribución/licencia cuando una futura UI presente las referencias o sus geometrías.

## Despliegue pendiente

1. Con autorización de despliegue, revisar/aplicar `202611100002_route_sources_cache.sql` y después **`202611100003_route_sources_quota.sql`**, ambas en `supabase/migrations/`, en el proyecto destino. La segunda instala cuotas y la escritura/purga transaccional; el código nuevo falla cerrado si falta. No se han ejecutado contra Supabase real. Mantener las migraciones existentes; el módulo no modifica las tablas de cuentas.
2. Configurar `APP_ALLOWED_ORIGINS` con orígenes exactos, por ejemplo `https://fraannr4.github.io,http://localhost:5173`. Las credenciales `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` proceden exclusivamente del runtime de servidor. Nunca poner la clave de servicio en Vite, pedirla al usuario ni copiarla al repositorio.
3. Para habilitar **solo OSM**, dejar ausentes `WIKILOC_AUTOMATION_AUTHORIZED` y `WIKILOC_PUBLIC_SEARCH_TEMPLATE`. El cliente prueba Wikiloc, recibe el error controlado y pasa a OSM.
4. Para Wikiloc, obtener primero autorización expresa que cubra búsqueda, extracción, caché y eventual GPX. Confirmar con Wikiloc una URL de búsqueda pública de carretera y las condiciones/frecuencia admitidas. Solo entonces configurar secretos de servidor `WIKILOC_AUTOMATION_AUTHORIZED=true` y `WIKILOC_PUBLIC_SEARCH_TEMPLATE=<plantilla autorizada>`. No reutilizar credenciales personales ni automatizar login. Confirmar el HTML y adaptar pruebas sintéticas antes de activar.
5. Desde la raíz, comprobar el runtime con `deno check --no-lock --config supabase/functions/route-sources/deno.json supabase/functions/route-sources/index.ts`. El `deno.json` nuevo fija imports npm y habilita `sloppy-imports` para resolver imports TypeScript compartidos sin cambiar el tsconfig de la app.
6. Desplegar con el CLI autenticado al proyecto correcto: `supabase functions deploy route-sources`. Mantener el control JWT de la plataforma; no usar `--no-verify-jwt`. No se ha ejecutado este comando. Verificar que el bundle incorpora `src/routes/sources/` y las dependencias del `deno.json` de la función.
7. Smoke test remoto: sin JWT o usuario Supabase anónimo → 401; cuerpo inválido → 400; OSM válido → referencias/vacío; repetición dentro de cuota → misma fecha `fetchedAt` sin nuevo HTTP; cuarta búsqueda/minuto o búsqueda 31/día → 429 antes de caché/slot. Acceso directo anon/authenticated a caché/RPC → denegado. Probar dos instancias concurrentes, expiración, purga de máximo 100 filas y geometrías de máximo 2.000 puntos. Wikiloc desactivado → 503 con código controlado; con autorización, bloqueos/cambios HTML → fin inmediato de la búsqueda, conservando metadatos previos o error si no había fichas válidas.
8. Revisar volumen/políticas de proveedores antes de conectar una UI. La purga acotada ya se ejecuta con cada escritura. No hay llamadas a IA ni envío de tracks personales, claves personales o dirección Casa en este módulo; el punto **cuantizado** solicitado sí se envía al proveedor de búsqueda.

### Activar Wikiloc y riesgo de uso

La activación es exclusivamente de servidor. Tras obtener la autorización expresa de Wikiloc y confirmar una URL pública de búsqueda de carretera, configurar en los secretos del proyecto:

```dotenv
WIKILOC_AUTOMATION_AUTHORIZED=true
WIKILOC_PUBLIC_SEARCH_TEMPLATE=<URL pública autorizada con los marcadores admitidos>
```

La plantilla debe usar `{lat}`, `{lon}`, `{radiusM}`, o los cuatro marcadores `{south}`, `{north}`, `{west}`, `{east}`, y un host permitido (`es.wikiloc.com` o `www.wikiloc.com`). Debe incorporar los filtros de carretera confirmados con Wikiloc. El marcador de ejemplo anterior debe sustituirse por una URL real autorizada; no es una URL operativa. Puede prepararse en un archivo local excluido de Git e importarse con `supabase secrets set --env-file <archivo-local>`, sin credenciales de usuarios ni claves de servicio. Después de desplegar, comprobar búsqueda, atribución, GPX público y parada ante bloqueos usando el procedimiento anterior.

**Poner el flag a `true` no concede permiso ni elimina el riesgo.** Las [condiciones de Wikiloc, apartado 1.2](https://www.wikiloc.com/wikiloc/terms_es.html), consultadas de nuevo el **2026-11-09**, exigen autorización previa para acceso automatizado. Una página pública, la atribución, caché y pocas peticiones no la sustituyen. La activación sin ese permiso puede incumplir sus condiciones y provocar bloqueo. El HTML y la compatibilidad real siguen sin verificarse. Para desactivar, eliminar ambos secretos o cambiar el flag a `false`; el servicio no leerá la caché de Wikiloc ni hará peticiones y el cliente podrá pasar a OSM.

## Verificación local

Fixtures exclusivamente inventados en `tests/fixtures/route-sources/`, sin HTML ni tracks reales de Wikiloc. Pruebas de parsers/cliente en `tests/routeSources.test.ts`, HTTP/caché/transporte en `tests/routeSourcesService.test.ts` y SQL/permisos en `supabase/tests/route_sources_cache.sql`, integrado en `npm run test:db`.

Verificación inicial del 2026-11-09, antes de las correcciones de revisión:

| Comando | Resultado |
|---|---|
| `npm ci` | PASS; instalación completada sin modificar manifiesto ni lockfile |
| `npx vitest run --pool=threads --maxWorkers=2 --minWorkers=1 --testTimeout=30000` | **1034/1034 PASS, 87 ficheros**, incluidos los 40 tests nuevos; 702,77 s en este equipo |
| `npx tsc --noEmit` | PASS, sin errores |
| `npm run test:db` | PASS: perfiles/amistades/Storage, cuotas IA y nueva caché/TTL/límite/permisos |
| `npx --yes --package=deno deno check --no-lock --config supabase/functions/route-sources/deno.json supabase/functions/route-sources/index.ts` | PASS, incluida resolución de imports compartidos |
| `git diff --check` | PASS |

La suite conserva avisos previos de jsdom (`window.scrollTo`) y React (`act`), sin fallos. Los dos workers y el margen de 30 s evitan la sobrecarga de la máquina; no se ha cambiado la configuración del proyecto. La compilación Deno no demuestra por sí sola el bundle ni el servicio remoto desplegado.

### Verificación de las correcciones de revisión (2026-11-09)

| Comprobación | Resultado actual |
|---|---|
| Vitest `tests/routeSources*.test.ts` | **56/56 PASS, 3 ficheros**: normalización previa a clave/proveedor, simplificación conjunta, parada de Wikiloc, cuota/anonimato y caché |
| `npx tsc --noEmit` | PASS, sin errores |
| `npm run test:db` | PASS en los cuatro bloques, incluida migración `202611100003_route_sources_quota.sql`: límites 3/min y 30/día, cuentas independientes, ventanas vencidas, rechazo anónimo, permisos, purga 101→1→0 y límite geométrico |
| Comprobación Deno del comando anterior | PASS |
| `git diff --check` | PASS |

En PowerShell el comodín literal no se expande para Vitest; se ejecutaron todos los archivos que coinciden con el patrón mediante:

```powershell
$routeSourceTests = @(Get-ChildItem tests/routeSources*.test.ts | ForEach-Object { $_.FullName })
npx vitest run @routeSourceTests
```

No se ha repetido la suite general tras estas correcciones: el resultado de 1.034 pruebas de la tabla anterior corresponde a la implementación inicial. No se ha aplicado la nueva migración ni activado Wikiloc en remoto. Sin commit ni push.
