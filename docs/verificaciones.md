# Verificaciones (tarea 1, F0)


## Publicación y comprobaciones con cuenta real, 2026-11-11 (tarde)

- Intervals.icu en la app publicada (`b93ce11`): el usuario guarda la clave y el id `i794435` y sincroniza. **Funciona.**
- Strava vinculado a Intervals: `GET /api/v1/athlete/0/activities?oldest=2026-08-01&newest=2026-11-11` da **200** con 9 actividades: 8 con `source: STRAVA` y 1 con `OAUTH_CLIENT` (iGPSPORT). Las de Strava solo traen `id`, `start_date_local`, `icu_athlete_id` y `_note: "STRAVA activities are not available via the API"`. `GET /activity/{id}` también da el stub, y `GET /activity/{id}/file` da **422**. Conclusión: la vía Strava → Intervals → app no es posible. La clave no se guardó en ningún fichero.
- `main` en `ab89a3a`: `npx tsc --noEmit` sin errores, `npx vitest run` con **124 ficheros y 1.580/1.580 PASS**. `PLAYWRIGHT_PORT=4391 npx playwright test` de wikiloc-cerca, break-ui-wikiloc, rutas, rutas-ia, fuentes-externas y biblioteca-calidad: **44/44 PASS**. GitHub Pages: run 43051853716, success. `wikiloc-marcador.html` responde 200. Edge Functions `route-sources` y `ai-routes`: «Deployed Functions».

## Rutas de Wikiloc cerca y adaptación, 2026-11-11 — `codex/integracion-rutas`

- Worktree `C:\testTrain-integracion`, sin commit, push ni despliegue, y sin cambios en Supabase. Plan `docs/superpowers/plans/2026-11-11-wikiloc-cerca-adaptar.md` (tareas 1 a 5); operativa y límites en `docs/wikiloc-cerca.md`.
- No se ha accedido a wikiloc.com. Todos los fixtures son sintéticos: HTML y JSON de lista, mapa y ficha, GPX y rutas con ids, nombres y autores inventados. Ni HTML, respuestas, tracks ni claves reales. El e2e intercepta `https://*.wikiloc.com/**` y sirve páginas propias.
- `npx vitest run` de los 13 ficheros de la funcionalidad (`wikilocNearby`, `wikilocStore`, `adaptRoute`, `adaptedRouteLibrary`, `wikilocReader`, `trackDownload`, `bookmarklet`, `bookmarkletInstallPage`, `sendGpx`, `wikilocAdvisor`, `wikilocCerca`, `wikilocRecibir` y `wikilocAdaptar`): **161/161 PASS**.
- Suite completa `npx vitest run --maxWorkers=2 --minWorkers=1`: **119 ficheros, 1.551/1.551 PASS**.
- `npx tsc --noEmit`: salida 0.
- `PLAYWRIGHT_PORT=4183 npx playwright test e2e/wikiloc-cerca.spec.ts --workers=2`: **4/4 PASS** (360 y 430 px, claro y oscuro): lista, recomendación de la IA, adaptación y envío. Comprueba que el cuerpo enviado a la IA no lleva enlaces de wikiloc.com, autores, ids de ruta, coordenadas ni las de Casa, y que no hay desbordamiento horizontal. El build previo de Playwright regenera `public/wikiloc-marcador.html` y conserva los avisos ya conocidos de zod, importación mixta de demo y bundle grande.
- **Sin validar contra la página real:** `WIKILOC_FORMAT` (selectores de tarjetas, respuesta de `find.do?event=map`, enlace de «Descargar» y señales de Premium o sesión) es un supuesto. Lo valida el usuario en su navegador con su sesión, sin guardar HTML real en el repositorio.
- Pendiente real del usuario: instalar el marcador y lanzarlo en Chrome para Android en el teléfono; comprobar que la descarga da el GPX (original o reducido) y no pide confirmación; enviar el GPX adaptado a la app de iGPSPORT y al BSC200S; enviar la solicitud TFG de `docs/wikiloc-solicitud-acceso.md` y anotar aquí la respuesta.

## Mapa de rutas, 2026-11-10 — `codex/mapa-rutas`

- Worktree `C:\testTrain-mapa-rutas`, base `650a510`, sin commit/push. Diagnóstico y límites en `docs/superpowers/plans/2026-11-10-mapa-rutas.md`.
- Tres regresiones fallaron sobre producción original: ocho peticiones en vez de dos al alcanzar el número de rutas, dieciséis peticiones si todas tenían pista moderada y elección de una vuelta con retroceso antes que una simple. Tras corregir, las 98 pruebas focalizadas de generador/geometría/mapa/plan IA/vista pasan. La regresión adicional de notas IA también falló primero y pasó tras conservar los avisos.
- `npx tsc --noEmit`: correcto. Build de producción (`npm run build`, ejecutado por Playwright): correcto, con los avisos existentes de tamaño de bundle, anotaciones zod e importación de demo.
- `npx vitest run` al cerrar: 1310 pruebas; fallaban 2 de `tokens.test.ts` porque el tema claro no tenía `--map-route-edge` ni `--map-route-halo`. Añadidos; después, en verde.
- e2e de rutas, IA, Empalmar, break-ui de Empalmar y `mapa-rutas.spec.ts`: 22/22 tras corregir en la prueba nueva el botón de escritorio («Exportar GPX» sin «de…» en la tarjeta).
- Capturas reales de la aplicación, móvil 390 px antes de escritorio 1440 px, claro/oscuro y forced-colors en `mapa-rutas.local/antes` y `mapa-rutas.local/despues`. Baseline desde archivo de `650a510`; teselas reales de CyclOSM y recorridos matemáticos sintéticos, sin tracks privados. Encuadre interno correcto antes y después, también tras cambio de tarjeta/tamaño. El panel inicial de escritorio antes terminaba en y=921,44 con ventana de 900 px; después en y=825,44.
- La cuota sigue siendo del servidor: seis consultas por operación no impiden agotar ocho por minuto al encadenar operaciones. Geometría a 15 m de tolerancia: puede marcar ramas paralelas muy próximas; las conserva como respaldo con aviso, sin inventar ni recortar el GPX.

## Conector personal de Intervals.icu, 2026-11-10

- Rama `codex/conectores`, desde `main` (`e8b64fa`), en `C:\testTrain-conectores` (worktree de `C:\testTrain`). Investigación escrita antes de implementar: `docs/conectores-actividades.md`, con fuentes oficiales, condiciones, formatos, CORS, cuotas, aprobación, coste y recomendación. Corregida la solicitud Garmin: Courses publica recorridos; no se promete lectura privada ni se recomiendan puentes iGPSPORT con contraseña.
- Ajustes > Conexiones: clave personal e id completo de Intervals, importar a un toque por el Worker/importador existente y su informe, desconexión, comprobación automática al abrir/reanudar como máximo cada seis horas. Clave/seguimiento en IndexedDB por cuenta, fuera de Supabase y backups. No hay cambios SQL ni Edge Functions nuevas; `test:db` no aplica a este lote.
- Preflight real sin credenciales desde el Origin de Pages: lista y original devuelven 200 y permiten GET/authorization con CORS. No se ha probado descarga autenticada con una clave real. No se ha accedido al ZIP real.
- `npx vitest run --maxWorkers=2 --minWorkers=1`: **101 ficheros, 1.313/1.313 PASS**. Esa pasada incluía 19 tests del conector. Tras la revisión del cursor se añadió la regresión entre ventanas y se repitió `npx vitest run tests/intervals.test.ts --maxWorkers=2 --minWorkers=1`: **20/20 PASS** sobre el servicio final. Cubren originales reales sintéticos, deduplicación manual, aislamiento, backup sin clave incluso con «incluir claves», cuota, seis horas, errores/cancelación, prefijo `i`, exclusiones y reintento de pendientes sin bloquear fechas nuevas.
- `npx tsc --noEmit`: salida 0. `npm run build` también pasa en el arranque de Playwright sobre el código final. Se conservan los avisos existentes de Zod, importación mixta de demo y bundle grande.
- `$env:PLAYWRIGHT_PORT='4179'; npx playwright test e2e/conexiones.spec.ts --workers=2`: **16/16 PASS**, repetición final. FIT generado en memoria con fabricante `development`, nunca una actividad real. Comprueba importación/dedupe, HTTP 500 y reintento, actualización de Inicio y reserva de seis horas entre recargas, 429/Retry-After con reactivación del botón, borrado durante descarga y otra cuenta sin acceso a la clave.
- **20 capturas** en `test-results/conexiones/`: configurar y conectado, 360×780, 390×844, 412×915, 430×932 y 844×390, claro/oscuro. Sin desbordamiento horizontal y acciones de al menos 44 px; revisadas visualmente las vistas de 360 oscuro y 430 claro. Los resultados y las capturas están ignorados por Git.
- Revisión independiente de la pantalla y el seguimiento: corregidos Web Locks, id moderno, cambio de clave con alias `0`, coordinación del borrado, actualización de pantallas abiertas, vencimiento de cuota, identificación Garmin por dispositivo y bloqueo de ventanas posteriores por un original pendiente. En la última pasada e2e solo se corrigió un selector ambiguo de la prueba de borrado tras añadir los detalles de configuración; no requirió otro cambio del producto.
- Preview de Playwright cerrado: comprobado que no queda listener en **4179**. No se ha tocado el servidor de main en 4173. Sin push, merge ni despliegue.
- Pendiente real: configurar la clave propia en la app, verificar una salida del dispositivo y comprobar la conexión nativa de iGPSPORT en la versión/región del teléfono. Este conector excluye Strava y datos identificados como Garmin. Para Garmin, Personal/Starter directo; para promover uso multiusuario de Intervals, OAuth público con PKCE.

## Paleta A Fiel · Atlas de montaña, 2026-11-10

- Aplicada en la rama `codex/paleta-a`, creada desde `main`, siguiendo la propuesta vigente de `C:\testTrain\docs\design\2026-11-10-paleta\propuestas.md`. Esa carpeta de exploración no se incorpora al commit.
- Solo colores: superficies, tintas, estados, seis series, montaña, bruma, carretera, favicon y fondo previo al CSS. Se conservan geometría del paisaje, marca B Trazado, estructura, textos, navegación y lógica. `BrandMark.tsx` y `SceneSvg.tsx` ya consumen los tokens y no necesitan modificaciones.
- Acceso B: sus ocho colores aprobados se conservan y pasan a tokens centrales. Se separan `--on-badge` y `--trace-thread` del texto del botón para mantener legibles los avisos rojos y el hilo claro del mapa. Las gráficas activas son SVG; ECharts está instalado pero no se utiliza. Leaflet sigue leyendo sus colores desde CSS.
- `npx vitest run --maxWorkers=2 --minWorkers=1`: **98 ficheros, 1228/1228 PASS**. La primera pasada detectó tres fallos en el contrato de tokens: copia literal de la paleta azul anterior, marcas `[chart]` ausentes y dos tokens compartidos sin declaración clara explícita. Se corrigieron las declaraciones; la prueba ahora conserva el contrato de tipografía/espaciado/geometría/movimiento y comprueba contraste sobre las cuatro superficies, estados, botones y series.
- `npx tsc --noEmit`: salida 0. `npm run build`: salida 0; siguen los avisos de anotaciones de Zod, importación mixta de datos de ejemplo y tamaño de bundle.
- `npx playwright test --workers=2 --output=playwright-report/paleta-a-run`: **95/95 casos existentes PASS**. Los ocho casos nuevos de paleta necesitaron corregir dos selectores de la prueba: distinguir el día del calendario de la fila de próximos entrenos y esperar el listado de propuestas de IA compartido por móvil/PC, en lugar del botón de exportación del dock móvil. No se cambiaron componentes para resolverlos.
- Repetición final `npx playwright test e2e/paleta.spec.ts --workers=2 --output=playwright-report/paleta-capturas`: **8/8 PASS**. En conjunto quedan verificados los 103 casos. El arranque inicial de Playwright agotó los 180 s del servidor; se compiló y arrancó `vite preview` por separado antes de las pasadas completas.
- **80 PNG** en `C:\testTrain-codex\test-results\paleta-a\{dark,light}\{360,390,430,1440}\`: Inicio, Historial, Salida, Rutas (formulario y resultado), Rutas con IA (formulario y resultado), Plan/Calendario, Ajustes y Login. Incluyen las cuatro métricas de Inicio, mapa/perfil y datos sintéticos; Supabase/ORS/IA están interceptados y las teselas externas se bloquean.
- Informes `contraste.json` en cada carpeta: **6774 textos comprobados, cero fallos**, umbral de 4,5:1 también en títulos y etiquetas SVG. Las capturas esperan a que desaparezcan las confirmaciones temporales para no tapar datos. Las tintas cumplen los mínimos de la tabla A en los cuatro fondos; `ink-3` mantiene al menos 5,84:1 en oscuro y 4,90:1 en claro. El auditor compone capas CSS; no certifica contraste de cartografía externa ni reconstruye todos los rellenos SVG arbitrarios.
- Sin push ni despliegue. Logs locales en `test-results/vitest-paleta-a.log`, `test-results/playwright-paleta-a.log` y `test-results/playwright-paleta-capturas.log`.

## Logo B Trazado: integración global, 2026-11-09

- El usuario elige B y pide coherencia con toda la web. SVG nativo aplicado a cabeceras, Inicio, carril lateral, acceso y favicon. `rg` no encuentra referencias a `HitoLogo`/`.hito-logo` en `src` o `index.html`.
- `node node_modules/typescript/bin/tsc --noEmit`: salida 0.
- `node node_modules/vitest/vitest.mjs run tests/shell.test.tsx tests/app.test.tsx tests/themeBoot.test.ts --maxWorkers=1 --minWorkers=1`: **37/37 PASS**. No se han añadido pruebas que repliquen la geometría del dibujo.
- `node node_modules/vite/bin/vite.js build`: correcto, mantiene aviso previo de tamaño de chunk.
- `node scripts/preview-brand.mjs`: vista generada con navegador instalado fuera del aislamiento, revisada a 16/24/32 px, oscuro/claro y adaptación Cartografía. PNG en `docs/design/2026-11-09-logo-trazado-aplicaciones.png`.
- Sin commit, push ni publicación. No se ha repetido la suite completa por este cambio visual de marca.

## Documentación de diseño y fuentes externas, 2026-11-09

- Usuario aprueba B Cartografía y animación sutil; ciclista tras login y en cargas; servicio de IA común con coste cero/cuotas. Solicita descubrimiento de rutas externas y empalme de tramos, considerando salida y puntos de paso.
- Wikiloc: ayuda oficial consultada el 2026-11-09 indica que no ofrece API pública (`https://help.wikiloc.com/article/102-api-for-developers`). Su ayuda describe descarga manual de GPX/TCX (`https://help.wikiloc.com/article/520-download-trails-wikiloc-web`). Esto no prueba acceso automático autorizado ni la existencia de integraciones gratuitas con otros proveedores.
- Guardada la lámina de propuestas en `docs/design/2026-11-09-opciones-login.png` y aprobado el centro B. Brief y plan de continuación enlazados desde `CLAUDE.md`, `AGENTS.md` y `docs/ESTADO.md`.
- Este cambio es documental: no se ha cambiado el runtime, no se ha integrado ningún proveedor de rutas nuevo ni se han repetido tests de aplicación por estas ediciones de MD.

## Cuentas y perfiles: preparación del 2026-11-09 (Codex)

### Lote de acceso y perfil (2026-11-09)

- Cliente oficial de Supabase integrado con URL y clave publishable públicas. Registro, entrada, recuperación, Google, perfil editable y salida implementados. Caché `ciclismo-user-<uuid>` y Worker dirigido a esa base; datos antiguos conservados en `ciclismo`.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit`, salida 0. Build de producción correcto; JS principal de unos 1.037 kB sin comprimir (314 kB gzip), mantiene aviso de tamaño. No se ha desplegado.
- SQL: `npm run test:db`, PASS en PostgreSQL embebido con los esquemas externos Auth/Storage simulados. La prueba cubre identidad, permisos, duplicados, aceptación y filas del bucket. La API real no está verificada. Se añade este comando a CI.
- Vitest completo con cuatro workers bajo carga: 944/949, 77/80 ficheros. Fallan dos pruebas de Ajustes y tres de cuentas por esperas/tiempos y un efecto posterior de timeout. Repetidos esos tres ficheros con un worker: **36/36 PASS**, sin relajar límites ni modificar sus aserciones para pasar. No presentar la pasada global como limpia. Logs locales: `verification-unit.local` y `verification-recheck.local`.
- Playwright del acceso/perfil: **19 PASS** con backend simulado. 32 capturas a 360×780, 390×844, 412×915 y 430×932 y sus tamaños apaisados, en ambos temas; sin desbordamientos horizontales. Revisión visual corrigió capas del paisaje y contraste del texto en claro. Capturas regenerables en `test-results/accounts/` (no versionadas).
- Regresión Playwright completa tras el último ajuste visual: **66/66 PASS**, 3,4 minutos, con dos workers. Incluye las 47 pruebas existentes adaptadas a sesiones sintéticas y las 19 nuevas de acceso/perfil. Importación, calendario, rutas/IA y casos de 5.000 salidas siguen pasando. Log local: `verification-e2e-all.local`.
- El aislamiento bloquea el acceso a localhost (`EACCES`), por lo que se ejecutan servidor y navegador con permiso fuera del aislamiento, en el puerto 4180 (4173 estaba ocupado). Playwright admite `PLAYWRIGHT_PORT` y usa la CLI local de Vite para evitar bloqueos de `npx`.
- Pendiente: aplicar migración en Supabase, configurar Google/SMTP/redirects y probar con dos cuentas reales. No se han enviado correos ni cambiado los servicios remotos desde esta sesión. Sincronización y comparativas pendientes.

### Registro de preparación anterior

- Decidido acceso con correo y contraseña y Google. Actualización del usuario: creados el proyecto Supabase `btmsakyhkxrndvscmxqs`, Google Cloud `fbiketrain-514211` y la cuenta Brevo. Esto es una confirmación del usuario, no una prueba de conexión ni de configuración.
- Brevo: captura del usuario muestra `FBikeTrain <fbiketrain@gmail.com>` como verificado. Sin dominio propio; persisten avisos DKIM/DMARC. SMTP y pruebas de correo pendientes. Credencial de Gmail conservada a petición del usuario en un Markdown local excluido de Git; no se registra en documentación versionable.
- Preparados `supabase/migrations/202611090001_profiles_friendships.sql` y `supabase/tests/profiles_friendships.sql`. Sin aplicación remota ni datos reales.
- `node node_modules/typescript/bin/tsc --noEmit`: código de salida 0 en esta sesión. Esto comprueba TypeScript, no valida SQL ni los permisos.
- Pruebas SQL y API de Storage: **pendientes**. No se dispone de instancia configurada ni de Postgres/Supabase CLI/Docker en el entorno actual. No se ha certificado la seguridad ni un login funcional.
- Guía para continuar: `docs/supabase-configuracion.md`; fases y pendientes en `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md`.

Resultados de las comprobaciones previas. No contiene filas del archivo ni tracks reales.

## Paso 1. Archivo «Descargar tu cuenta» de Strava

- Fecha: 2026-11-06.
- Disponible sin suscripción: sí. Llega por correo con un enlace firmado a S3 que caduca en 7 días (`X-Amz-Expires=604800`).
- Tamaño de esta cuenta: 3,8 MB, 96 entradas, ZIP sin compresión (`store`).

## Paso 2. Contenido del archivo

### Carpetas y ficheros de primer nivel

`activities/`, `media/`, `clubs/`, `routes/`, `activities.csv`, `profile.jpg`, `messaging.json` y unos 35 CSV más (`bikes.csv`, `goals.csv`, `routes.csv`, `segments.csv`…). Solo usamos `activities.csv` y `activities/`.

### `activities.csv`

- Codificación UTF-8, sin BOM. Separador coma. Los textos con comas van entre comillas.
- **La cabecera está traducida al idioma de la cuenta (castellano), no en inglés.** El lector no puede depender de los nombres en inglés que suponía el plan (`Activity ID`, `Activity Type`, `Filename`…).
- 104 columnas. **Hay nombres repetidos**: `Tiempo transcurrido` (5 y 15), `Distancia` (6 y 17), `Frecuencia cardiaca máxima` (7 y 30), `Esfuerzo Relativo` (8 y 37), `Desplazamiento` (9 y 50). Al construir el índice por nombre, gana la **primera** aparición.

Columnas que usa el lector (`STRAVA_COLUMNS`):

| Campo | Cabecera en castellano | Cabecera en inglés (cuentas en inglés) | Índice en este archivo |
|---|---|---|---|
| `id` | `ID de actividad` | `Activity ID` | 0 |
| `name` | `Nombre de la actividad` | `Activity Name` | 2 |
| `type` | `Tipo de actividad` | `Activity Type` | 3 |
| `filename` | `Nombre del archivo` | `Filename` | 12 |

Recomendación: `STRAVA_COLUMNS` acepta las dos variantes de cada campo y localiza la columna por nombre (primera aparición), no por índice.

Otros formatos observados, por si se usan más adelante:
- `Fecha de la actividad`: texto localizado, por ejemplo `31 oct 2026, 7:48:29`, con meses `ene feb mar abr may jun jul ago sept oct nov dic`. No se usa: la hora de inicio sale del fichero, como dice el plan.
- `Hora de inicio`: vacía en todas las filas.
- La primera `Distancia` (6) va en km con coma decimal (`44,86`). La segunda (17) va en metros con punto (`44860.5`).
- `Tiempo en movimiento` (16), `Velocidad máxima` (18) y `Velocidad promedio` (19) van en segundos y m/s, con punto decimal. `Desnivel positivo` (20) va en metros.
- `Cadencia promedio` vacía en las filas observadas.

### Valores de `Tipo de actividad`

| Valor | Filas | ¿Ciclismo? |
|---|---|---|
| `Bicicleta` | 8 | sí |
| `Carrera` | 36 | no (running) |
| `Caminata` | 3 | no |

`CYCLING_TYPES` debe incluir los valores en inglés del plan (`Ride`, `Virtual Ride`, `E-Bike Ride`, `Gravel Ride`, `Mountain Bike Ride`) y los equivalentes en castellano. Solo `Bicicleta` está confirmado; los demás nombres en castellano (bicicleta virtual, eléctrica, gravel, montaña) no aparecen en este archivo y se añadirán cuando salgan. Las carreras y caminatas se descartan.

Segundo filtro, por si el tipo del CSV es desconocido: los GPX de Strava traen `<type>` (`cycling`, `running`, `walking`) y los FIT traen `sport`. Solo entra lo que sea ciclismo.

### Ficheros en `activities/`

- Ruta en el CSV: `activities/<id>.<ext>`.
- Extensiones encontradas: `.gpx` (45) y `.fit` (2). **Sin `.gz`** en este archivo; el lector debe seguir aceptando `.fit.gz`, `.gpx.gz` y `.tcx.gz`, que Strava usa en otras cuentas.
- Cruce tipo y extensión: `Bicicleta` 6 GPX y 2 FIT; `Carrera` 36 GPX; `Caminata` 3 GPX.
- GPX: `creator="StravaGPX"`, con `<type>` igual a `cycling`, `running` o `walking`.
- FIT: cabecera `.FIT` válida (archivos de 551 KB y 39 KB).

## Paso 3. iGPSPORT BSC200S por USB

Primer intento, 2026-11-06: el usuario conectó el dispositivo encendido y por USB, a través del dock HP USB-C. Windows no lo detectó: no apareció ninguna unidad, ningún dispositivo portátil (WPD/MTP) ni ningún dispositivo USB nuevo en el Administrador de dispositivos. El único almacenamiento USB que había era un CD virtual «GO! Suite» (VID_0EA0), que es otro aparato.

Segundo intento, el mismo día: puerto USB del propio portátil, sin dock, y con otro cable. El dispositivo solo muestra que está cargando y Windows sigue sin detectar nada.

Conclusión: en la práctica, el BSC200S no ofrece sus datos por USB a este PC. **La app no dependerá del USB:**
- las salidas llegan por Strava, que es la copia maestra;
- las rutas GPX se pasan al dispositivo desde la app móvil de iGPSPORT;
- la tarea 1 de F4 comprueba ese paso con un GPX de prueba.

Mientras tanto, no bloquea nada. Las salidas llegan a la app por Strava, que es la copia maestra. Las rutas en GPX se pueden pasar al dispositivo desde la app móvil de iGPSPORT.

## Paso 4. Política de datos de Groq

Fuente: https://console.groq.com/docs/your-data (consultada el 2026-11-06).

- Por defecto, Groq no conserva los datos de las peticiones de inferencia.
- Excepción: puede registrar entradas y salidas durante un máximo de 30 días para resolver problemas de fiabilidad o investigar abusos.
- Cualquier cliente puede activar Zero Data Retention (ZDR) en Data Controls. Con ZDR desaparece también ese registro de 30 días. Recomendación: activarlo, porque la app no usa lotes ni ajuste fino.
- Entrenamiento: la página oficial no lo dice. Según resúmenes de terceros, el contrato de servicio (Services Agreement y DPA) prohíbe entrenar con lo que envía el cliente sin su permiso. No está comprobado en el texto original.
- En cualquier caso, la IA solo recibe cifras resumidas, nunca tracks ni la dirección de «Casa».

## Paso 5. CORS de ORS y Groq desde el navegador

Comprobado el 2026-11-06 con `curl`, sin claves, simulando `Origin: http://localhost:5173`.

| Llamada | Preflight `OPTIONS` | Respuesta sin clave |
|---|---|---|
| ORS `POST /v2/directions/cycling-road` | 204, `access-control-allow-origin: *`, permite `Authorization` y `Content-Type` | 403 **sin** cabecera `access-control-allow-origin` |
| Groq `GET /openai/v1/models` | 204, `access-control-allow-origin: *`, permite `authorization` | 401 con `access-control-allow-origin: *` |
| Groq `POST /openai/v1/chat/completions` | 204, `access-control-allow-origin: *`, permite `authorization` y `content-type` | (no probado) |

Conclusiones:
- Groq acepta llamadas directas desde el navegador. No hace falta el plan B (Cloudflare Worker) para la IA.
- ORS acepta el preflight. Queda pendiente confirmar con una clave válida que la respuesta 200 también trae `access-control-allow-origin`.
- **Consecuencia para `probeOrs`:** la respuesta 403 de ORS por clave mala no trae cabecera CORS, así que el navegador la ve como un error de red (`TypeError`), no como 403. Una clave ORS incorrecta aparecerá como `network` o `cors`, no como `unauthorized`. El mensaje de Ajustes debe decir «Clave rechazada o sin conexión».

## Sesión del 2026-11-09 por la noche: cuentas, servidor y empalmes

**Supabase remoto.** Proyecto `btmsakyhkxrndvscmxqs`, operado con la API de gestión y un token que vive solo en `.local-secrets/`.
- Las migraciones `202611090001` y `202611090002` estaban sin aplicar: la app daba `PGRST205`. Se aplicaron y se registraron en `supabase_migrations.schema_migrations`.
- La Site URL era `http://localhost:3000`. Ahora es la URL de Pages, con redirects de Pages y `localhost:5173`.
- El SMTP no estaba configurado, aunque se creía que sí. Ahora usa Brevo (`smtp-relay.brevo.com:587`), con 30 correos por hora.
- Login real en producción comprobado: una cuenta confirmada inició sesión el 2026-11-09 a las 15:50.
- El bundle publicado no lleva secretos. La cadena `sb_secret_` que aparece es la comprobación de prefijo de supabase-js.

**CI.**
- El run 42645709360 falló en el test del calendario «adds workout from a day»: el título se guardaba como «Co». La hoja del mes, al cerrarse, devolvía el foco a su botón mientras se escribía en la hoja nueva. Corregido en `src/ui/components/Sheet.tsx` (`b36ce54`).
- Runs en verde y desplegados:
  - 42647488343;
  - 42669547748 (`6fdc2e8`, `386a5fd`);
  - 42671066509 (`f794820`).

**Pruebas sobre `f794820`.**
- `npx vitest run`: 95 ficheros y 1.171 tests en verde.
- `npx tsc --noEmit`: limpio.
- `npm run test:db`: 5 suites SQL en verde.
- e2e de empalmar y break-ui de empalmar: 12/12.

**Pendiente de comprobar con servicios reales.** Todo requiere las claves de Groq y ORS:
- `ai-routes`, `ors-proxy` y `route-sources` sin desplegar;
- migraciones 202611100001-0003 sin aplicar en remoto;
- variables `VITE_SHARED_*` y `VITE_ROUTE_SOURCES_ENABLED` apagadas.

Wikiloc sigue apagado hasta que el usuario acepte el riesgo de sus condiciones.


## Sesión del 2026-11-10 (tarde): servidor en marcha, paleta y Wikiloc

**Despliegue del servidor** (proyecto `btmsakyhkxrndvscmxqs`).
- Migraciones remotas aplicadas y registradas: `202611090001`, `202611090002`, `202611100001`, `202611100002`, `202611100003` (5 de 5).
- Secretos puestos: `GROQ_API_KEY`, `ORS_API_KEY`, `SHARED_AI_ENABLED`, `GROQ_FREE_TIER_CONFIRMED`, `SHARED_ORS_ENABLED` y `APP_ALLOWED_ORIGINS` (Pages y `localhost:5173`). Las claves solo viven en `.local-secrets/credenciales.md`.
- Funciones desplegadas: `ai-routes`, `ors-proxy` y `route-sources`. Prueba de humo: las tres responden 401 sin JWT.
- Variables del repositorio `VITE_SHARED_AI_ENABLED`, `VITE_SHARED_ORS_ENABLED` y `VITE_ROUTE_SOURCES_ENABLED` en `true`; Pages redesplegado con ellas.
- Cuota de IA hoy: 12 al día por usuario, 40 globales, 2 por minuto por usuario y 3 globales. La subida a 30/300 y 10 por minuto globales va en la migración `202611100004` del lote en curso. Cuota de ORS: 150 al día por usuario y 1.800 globales.

**Paleta A «Atlas de montaña»** (`8da9efb`, de Codex). Solo color. Revisada: los tokens y los contrastes coinciden con `docs/design/2026-11-10-paleta/propuestas.md`. El mapa de Salida en oscuro se comprobó con teselas reales.

**Wikiloc.** Acceso automatizado bloqueado por Cloudflare: HTTP 403 con desafío `__cf_chl`, incluso para `robots.txt` y con un User-Agent identificable. No se esquiva; `WIKILOC_AUTOMATION_AUTHORIZED` sigue sin definir.

**Retirada de Google** (`8a7e831`). Tests de acceso en verde: 13/13.

**Lote de IA, T1 y T2** (`031a5c4`). Antes del commit: `npx tsc --noEmit` rc 0; `npx vitest run` rc 0 (98 ficheros); `npm run test:db` 6 suites PASS, incluida la nueva «cuota de la IA compartida subida: 30 por usuario y 300 globales al día, 10 globales por minuto»; `npm run build` rc 0 (`index-DonpDOhd.js`, 1.201 kB). e2e de la T1 (17/17) solo en el verificador del workflow, con `PLAYWRIGHT_PORT=4174` porque el 4173 lo ocupaba un `vite preview` de Codex con un bundle viejo; `playwright.config.ts` reutiliza ese puerto, así que con Codex activo hay que fijar `PLAYWRIGHT_PORT`. `ai-routes` redesplegada y migración `202611100004` aplicada en remoto el 2026-11-10.

**Ramas de Codex revisadas** (agentes sonnet, solo lectura, `tsc` rc 0 en las dos; `tests/sharedFiles.test.ts` 20/20): detalle en `docs/ESTADO.md` y correcciones en `docs/codex-correcciones-2026-11-10.md`.

**Pendiente de comprobar por el usuario, en el móvil:**
1. Una ruta con IA que cite una referencia conocida.
2. «Proponer semana con IA» en Calendario.
3. Un empalme exportado al BSC200S con la app de iGPSPORT.
4. Fijar la zona.
5. Con un evento en Objetivos: el «motivo» de una ruta con IA y la recomendación de Empalmar citan el objetivo.
6. Empalmar con tres tramos y con una salida del historial; «Empalmar con…» desde una ruta generada.

## 2026-11-10 (tarde): rutas y rutas con IA fallaban siempre

Síntoma: «Ha fallado algo inesperado al preparar las rutas» en Rutas, Rutas con IA y Empalmar. Causa, reproducida con la cadena real cliente → `handleSharedOrs` → ORS: ORS responde ahora el extra `waytype` (singular) en vez de `waytypes`; el proxy lo descartaba y `analyzeRoute` fallaba con `TypeError: Cannot read properties of undefined (reading 'summary')`. Arreglo: `orsExtras()` en `src/routes/shared/orsService.ts` acepta las dos claves y entrega `waytypes`, en el proxy y en la ruta con clave personal (`src/routes/ors.ts`). Tests de regresión en `tests/ors.test.ts` y `tests/sharedOrs.test.ts`; `vitest` 1274/1274, `tsc`, build. `ors-proxy` redesplegada el mismo día. Aparte, ORS da a ratos 404/500 o tarda >60 s en `round_trip` de bici; eso sale como error del motor, no como «inesperado».

## 2026-11-10 — PWA y ficheros compartidos (rama `codex/pwa-compartir`)

- Manifest instalable con iconos 192/512 de la marca, SW propio sin precaché ni manejadores de GET, recepción multipart y pantalla `#/compartido`. Instalación en Ajustes y reanudación del envío tras login. Sin dependencias nuevas ni cambios en los archivos reservados al lote de rutas/IA.
- `npx vitest run --maxWorkers=2 --minWorkers=2 --retry=1`: **99 ficheros y 1.248 pruebas correctas**, incluidos 20 tests nuevos de clasificación y Cache API simulada.
- `npx tsc --noEmit` y `npm run build`: correctos. El build conserva los avisos existentes de tamaño del bundle, importación de demo y anotaciones de zod.
- Build adicional con `--base=/FBikeTrain/` y prueba real en Chromium: manifest, start URL, scope, acción POST y scope del SW bajo la subruta correcta. Un envío sintético redirige a `/FBikeTrain/#/compartido?envio=…` y permanece en caché mientras se muestra el login.
- Los 22 tests de `e2e/compartido.spec.ts` pasan: mezcla de referencias y actividades, duplicados, envío consumido, instalación, vuelta del login, POST multipart al SW y capturas. **18 capturas** en `test-results/pwa-compartir/`: claro/oscuro × 360/390/430 px × uno/tres/no admitido. Sin desbordamiento horizontal; revisión visual de los estados representativos.
- Regresión completa: `npx playwright test --workers=2 --timeout=90000 --retries=1`, salida **0**: **121 correctos y 4 intermitentes que pasan al reintentarse** (125 casos en total, 20,2 min). Dos casos de Inicio fallaron al cerrar el contexto con `ENOSPC: no space left on device`; dos de Subidas agotaron la espera de 15 s de un elemento. No se han cambiado esas aserciones. Los 22 casos nuevos de PWA pasan sin reintento. La suite no fue una pasada sin incidencias.
- Incidencias de entorno: el primer arranque de Playwright agotó los 180 s mientras compilaba. La primera pasada unitaria con build/navegador simultáneos tuvo un timeout en «guided questions in order»; la pasada completa final, sin esas cargas simultáneas, está en verde. La prueba de rendimiento de Inicio también pasó al ejecutarse sin Vitest en paralelo. No se cambiaron sus aserciones ni límites.
- Pendiente real: instalar y compartir archivos desde Wikiloc/iGPSPORT en un Android físico tras publicar los cambios. No se ha probado un dispositivo real ni se ha hecho push o despliegue. iOS no admite `share_target`. Guía, criterio de clasificación y límites de conservación en `docs/pwa-compartir.md`.

## 2026-11-11 — Revisión de conectividad (`codex/conectividad-revision`)

Worktree `C:\testTrain-conectividad-revision`, creada desde `main` (`d346a15`). Sin commit, push ni despliegue.

**Evidencia real facilitada por el usuario, no ejecutada por el agente:** lista de actividades 200; iGPSPORT con `source=OAUTH_CLIENT`, `device_name=IGPSPORT 202`, `file_type=fit`, `type=Ride`; original `/activity/{id}/file` como FIT sin gzip (`application/octet-stream`), CORS `*`. Las actividades que llegan desde Strava no se devuelven. El agente no recibe ni usa la clave real ni tracks privados.

**TDD y hallazgos:**

- El filtro ya admitía iGPSPORT. Nueva regresión con los cuatro campos exactos y el FIT sintético de fixtures, mediante el importador real; segunda consulta no descarga otra vez el id.
- Prueba roja de carga retrasada: el cursor al terminar varias ventanas quedaba en el último día, perdiendo el solape. Corregido a hoy menos siete días. Primera lectura sin historial: 30 días; con historial: última salida real menos dos días. Duplicados por id y por inicio/distancia del importador, pendientes y ventanas posteriores cubiertos.
- Corregida confusión entre ids y propiedades heredadas de `Object` (regresión con `constructor`).
- Pruebas rojas/verdes para provider de autorización, backoff 429/5xx, Retry-After segundos/fecha, no retry 401/403 y cancelación durante espera. Esperas largas guardan pausa y detienen el lote.
- AES-GCM y CryptoKey no exportable comprobados con WebCrypto real en Vitest: recarga, migración de texto antiguo sin perder cursor, fallo de descifrado, desconexión y ausencia de alternativa plaintext. Sigue comprobado el aislamiento por cuenta y que el backup no exporta la clave. El cifrado no protege contra XSS ni acceso completo al perfil del navegador.
- Dos revisiones independientes detectaron recuperación bloqueada con credencial dañada y carrera entre guardar/desconectar y sincronizar. Corregidas con botón de restablecimiento, bloqueo compartido y reserva de guardado antes de WebCrypto; regresiones rojas/verdes. Revisión posterior sin problemas mayores pendientes.
- Provider probado al abrir, en visibilitychange visible/oculto y pageshow, eventos simultáneos, desmontaje y cancelación. Una petición manual muestra el error castellano seguro. El guardado bloquea reanudación/segundo guardado y `stop()` espera su finalización.
- UX con pasos, botón a los ajustes oficiales, alias `0`, aviso de conexión directa sin Strava, última sincronización y «Sincronizar ahora». La clave guardada no se vuelve a insertar en el DOM.

**Verificación final:** resultados de Vitest completo y e2e se incorporan al cerrar la ejecución en esta worktree. `npx tsc --noEmit` y `npm run build` han terminado con salida 0. Bundle `index-PnHa26bT.js`, 1.232,91 kB (383,33 kB gzip); se conservan avisos previos de tamaño, importación de demo y anotaciones de zod. Los seis archivos unitarios afectados contienen 49 casos; las pasadas dirigidas están en verde.

El primer arranque del e2e agotó los 180 segundos del `webServer` durante el build, sin ejecutar casos. Se generó el build por separado y se sirve en el puerto exclusivo 4183 para evitar reutilizar una preview de otra worktree. La máquina tenía otras verificaciones en paralelo; no se alteraron tiempos de prueba ni aserciones para ocultarlo.

**Límites:** sin OAuth, SQL, Edge Functions ni servicios nuevos. Preparación comprobada contra fuentes oficiales en `docs/intervals-oauth.md`, incluidos registro, callback, tokens y webhooks. La sincronización requiere app abierta; no reconcilia borrados remotos ni ediciones de originales ya completados y no recupera automáticamente cargas anteriores al solape. Retry-After exige exposición CORS; sin ella aplica backoff predeterminado. Sin Web Locks solo se coordina el mismo documento. Pendiente comprobar el flujo diario, retorno desde iGPSPORT y persistencia de almacenamiento en el móvil físico después de integrar/publicar con autorización.

Mensaje de commit propuesto: `fix(connections): endurecer sincronización de Intervals y guiar conexión móvil`.


## 2026-11-11 (noche): catálogo de rutas

- Datos sintéticos; Overpass, Open-Meteo y ORS interceptados.
- `npx tsc --noEmit`: sin errores.
- `npx vitest run`: 118 ficheros, 1477/1477.
- `npm run build`: correcto.
- `npx playwright test e2e/catalogo.spec.ts`: 4/4, en claro y oscuro, a 360 y 430 px, sin desborde horizontal.
- Comprobado en el e2e:
  - el centro que sale a Overpass va redondeado a 2 decimales;
  - no sale la coordenada exacta de Casa.
- Pendiente con datos reales: la precarga desde la cuenta del usuario y la prueba en Android con el BSC200S.
