# Verificaciones (tarea 1, F0)

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
