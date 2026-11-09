# Estado del proyecto FBikeTrain

Última actualización: 2026-11-09. Próxima sesión: viernes 2026-11-13.

## Resumen

La app está terminada, verificada y publicada (2026-11-09).

La versión publicada corresponde a F1–F5. **En desarrollo local:** acceso obligatorio y perfiles (correo/contraseña, Google, recuperación, edición de nombre/privacidad y cierre de sesión), con cachés independientes por cuenta. La sincronización y la comparativa social siguen pendientes. No se ha publicado este lote.

Verificación del lote de cuentas, 2026-11-09: tipos y build correctos, SQL/RLS en PostgreSQL embebido PASS y Playwright completo **66/66 PASS**. Vitest completo: 944/949 bajo carga; los tres ficheros con los cinco fallos pasan aislados (36/36). Detalles y límites en `docs/verificaciones.md`. Pendientes las pruebas contra los servicios reales.

- Repositorio público: https://github.com/fraannr4/FBikeTrain (rama `main`, autor de los commits `fraannr4@users.noreply.github.com`).
- App en GitHub Pages: https://fraannr4.github.io/FBikeTrain/
- Cada push a `main` ejecuta los tests, genera el build y despliega (`.github/workflows/deploy.yml`).
- Cada commit sigue necesitando el OK explícito del usuario.
- 2026-11-09: el primer despliegue falló en CI por un test del calendario. Un foco diferido al título del día robaba el foco del formulario mientras se escribía. Corregido en `src/ui/pages/Calendario.tsx`.

## Verificación final (2026-11-07)

| Comprobación | Resultado |
|---|---|
| `npx vitest run` | 76 ficheros, 932 tests en verde |
| `npx tsc --noEmit` | sin errores |
| `npm run build` | correcto (aviso de chunk > 500 kB, ver limitaciones) |
| `npx playwright test` | 47 en verde (móvil 390x844, break-ui, 5.000 salidas < 3 s, privacidad IA, GPX) |
| ZIP real de Strava a 390 px | 7 salidas importadas, 1 descartada por corta, 39 no ciclistas; 0 errores de consola, 0 desbordamientos, ningún NaN |
| Revisión final de código | sin críticos; el único medio (cancelar IA no abortaba peticiones) está corregido |
| Barrido de secretos y datos reales | limpio; solo fixtures sintéticos en `tests/fixtures` |

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

## Pendiente

### Nueva petición: acceso, animación e IA (2026-11-09)

Logo: **B Trazado aprobada para toda la web**, respetando la estética general además del login. SVG nativo integrado en cabeceras, Inicio, navegación lateral, acceso y favicon; colores de los tokens actuales y variantes claro/oscuro. Tipos/build y 37 pruebas aprobadas; sin publicación. Brief y vista global: `docs/design/2026-11-09-logo-propuestas.md` y `docs/design/2026-11-09-logo-trazado-aplicaciones.png`.

**Aprobado: B Cartografía**, columna central de `docs/design/2026-11-09-opciones-login.png`, con animación sutil sin sobrecarga. Ciclista subiendo después del login y en pantallas de carga; IA compartida con coste cero y búsquedas limitadas. Nueva petición: consultar Wikiloc o fuentes equivalentes, considerar puntos de salida/paso y **empalmar rutas/tramos** con conexiones reales calculadas por el motor cartográfico. Wikiloc declara que no tiene API pública: integración automática no confirmada; estudiar acceso autorizado, GPX del usuario y fuentes alternativas verificadas. Brief: `docs/design/2026-11-09-acceso-ciclista-ia.md`. Plan: `docs/superpowers/plans/2026-11-09-login-cartografia-carga-rutas-ia.md`. Todo este nuevo alcance está documentado, no implementado; no cierra los pendientes de cuentas y sincronización.

### 0. Cierre del 2026-11-09: lo que queda abierto

**Cambios sin commit.** Hay tres ficheros modificados que aún no están en GitHub:
- `src/import/summary.ts`: arreglo de los saltos del GPS. Un tramo calculado con haversine que supera la velocidad de pico cuenta a la mediana de su ventana de 5 tramos, no con la distancia del salto. La distancia que graba el dispositivo (FIT) no se toca.
- `tests/summary.test.ts`: prueba nueva, «a GPS jump out and back does not add its metres to the distance».
- `docs/ESTADO.md`: este documento, con la sección del login.
- `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md`: plan de cuentas, sin seguimiento en git.
- `AGENTS.md`: guía para Codex y otros agentes, sin seguimiento en git.

Estado de la verificación, 2026-11-09 a las 12:01: `npx vitest run` da 933 de 933 en verde y `npx tsc --noEmit` sale limpio. No se ha publicado.

Para subirlo hace falta el OK explícito del usuario. Luego se ejecuta `git push` y se sigue el despliegue con `gh run watch`. Mensaje propuesto:

```
Stop GPS jumps from adding metres to the total distance

A GPS spike segment computed with haversine now counts at the median speed
of its 5-segment window instead of its raw jump distance. Device-recorded
distance (FIT) is left untouched. Also documents the login request for Friday.
```

**Viernes 2026-11-13: login y sincronización.** Orden previsto:
1. El usuario crea la cuenta en supabase.com y un proyecto. Pasa la URL del proyecto y la clave pública (anon). La clave de servicio nunca se pasa ni va al repositorio.
2. Cerrar con la skill `grilling` las decisiones que faltan, según el plan `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md`: método de acceso, datos locales existentes, conflictos y borrados, nombres únicos y zona horaria. Las métricas de la comparativa ya están decididas en ese plan.
3. Detallar las tareas de cada fase del plan.
4. Implementar en este orden: Auth, tablas con RLS, sincronización y Storage para los tracks. Probar con dos cuentas que ninguna ve los tracks de la otra.

**Comprobaciones del usuario.** Siguen igual que en el punto 2.

### Revisión de planes, 2026-11-09 (Codex)

Los planes de F1–F5 y del rediseño conservan casillas sin marcar incluso para funcionalidades que este estado recoge como terminadas. No deben tratarse como un registro fiable de tareas pendientes sin contrastarlas con el código y las verificaciones. No se han marcado retroactivamente ni se ha ejecutado una nueva verificación completa en esta revisión.

Además de los pendientes enumerados abajo, los planes proponen comprobaciones reales que no constan como realizadas en `docs/verificaciones.md`:

- F2: comparar una subida conocida y sus pasadas con Strava (longitud y pendiente ±10 %).
- F3: crear un entreno para el día de una salida real, importarla y comprobar que se vincula.
- F4: comprobar con una clave ORS válida la respuesta y sus cabeceras; generar una ruta e importar su GPX en iGPSPORT y enviarlo al BSC200S.
- F5: probar Fondo, Subidas y Mixto con claves reales, contrastar las explicaciones y anotar el consumo de ORS y Groq.

Estas comprobaciones necesitan datos, claves o intervención del usuario. Su ausencia del registro no demuestra por sí sola que nunca se hicieran. Antes de iniciar cambios, acordar prioridades con el usuario.

### 1. Publicar: HECHO el 2026-11-09 (se conserva para referencia)

1. El usuario ejecuta `! gh auth login`.
2. Hecho el 2026-11-09: `git init -b main` y `.gitignore` ampliado.
   - Se excluyen `.playwright-mcp`, `tsconfig.tsbuildinfo` y `.impeccable/hook.cache.json`.
   - Se excluye `docs/design/prototipo-movil/capturas/`: 5.299 PNG, unos 940 MB, que se regeneran con `shots.mjs`.
   - Entrarían 467 ficheros, unos 32 MB.
   - Aún no hay ningún commit.
   - `gh` no tiene sesión iniciada.
3. Revisar `git status` antes del primer commit: ningún dato real, ninguna clave, nada de `test-results/` ni `.playwright-mcp/`.
4. Crear el repositorio público `FBikeTrain` con `gh repo create`. Activar GitHub Pages con origen GitHub Actions; el workflow `.github/workflows/deploy.yml` ya existe y usa `BASE_PATH`.
5. Enseñar el commit propuesto y esperar el OK. Mensaje propuesto:

```
Initial release of FBikeTrain: Strava import, progress, routes and AI planner

Static Vite + React + TypeScript app for GitHub Pages, mobile-first.
- Import: Strava account ZIP (CSV + FIT/GPX/TCX), de-duplication and junk/spike filters.
- Inicio, Historial (rides, climbs, repeated routes), Plan (calendar, goals), Más.
- Routes: OpenRouteService round trips scored against history, GPX export for iGPSPORT.
- AI routes (Groq, OpenAI-compatible): summarised figures only, no tracks or home address.
- Mobile-first design system with dark/light themes and demo data.
- 932 unit tests, 47 Playwright e2e tests; synthetic fixtures only.
```

6. Tras desplegar, abrir la URL de Pages en el móvil y comprobar que carga con la base `/FBikeTrain/`.

### 1b. Para el viernes 2026-11-13: cuentas de usuario (login)

Plan y registro: `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md`. El acceso y el perfil están integrados localmente con el cliente oficial y la clave publishable facilitada; la migración de perfiles/amistades/Storage privado pasa pruebas en PostgreSQL embebido. El usuario confirma creados Supabase (`btmsakyhkxrndvscmxqs`), Google Cloud (`fbiketrain-514211`) y Brevo con remitente Gmail verificado. **Falta aplicar la migración y verificar OAuth, SMTP y redirects en el proyecto real**, además de sincronización, migración de datos antiguos y pantallas sociales. Recursos y guía: `docs/supabase-configuracion.md`.

Petición del usuario del 2026-11-09: que cada persona tenga su cuenta.

Decisiones del usuario del 2026-11-09: la cuenta será obligatoria para usar la app. Al iniciar sesión en otro dispositivo quiere tenerlo todo: perfil, salidas, mapas y tracks, calendario y objetivos sincronizados. Los tracks serán privados y estarán protegidos mediante las reglas de acceso de Supabase, sin cifrado adicional en el cliente. El usuario quiere buscar perfiles y comparar estadísticas de salidas y rutas para fomentar la competición; faltan por concretar las métricas y los permisos de visibilidad, respetando la privacidad de los tracks. Queda también por decidir la incorporación de datos locales existentes; Supabase es el servicio propuesto. Estas decisiones definen el objetivo, no implican que ya esté implementado.

Decisión social: cada usuario podrá elegir si sus estadísticas son visibles para todos los usuarios de la app o solo para amigos aceptados. Por defecto serán visibles para todos los usuarios de la app. Los perfiles se podrán buscar y comparar según esa elección; los tracks siguen siendo privados. Falta definir las métricas y la gestión de amistades.

Hoy cada navegador guarda sus datos en su propio IndexedDB, sin servidor.
- Dos personas con el mismo enlace no se pisan ni ven lo del otro.
- Un mismo usuario tampoco ve en el PC lo que importó en el móvil, salvo por la copia de seguridad (exportar e importar el JSON).

Lo que aporta un login: sincronizar entre los dispositivos del usuario y, si se quiere, compartir con amigos.

Propuesta del 2026-11-09: **Supabase**, con la app sigue en Pages.
- Auth para el login con correo o Google.
- Postgres con RLS para que cada usuario lea solo sus filas.
- Storage para los tracks comprimidos.
- El plan gratuito (unos 500 MB de base de datos y 1 GB de ficheros) basta. El proyecto se pausa tras unos 7 días sin uso.
- El usuario debe crear la cuenta en supabase.com.

Alternativas descartadas por ahora:
- Firebase: consultar el historial es más incómodo.
- Cloudflare D1: el login habría que hacerlo a mano.
- Servidor propio: exige mantenimiento.

Ya decidido (2026-11-09):
- **Servicio:** Supabase. La app sigue estática en Pages y el servicio es externo.
- **Acceso:** ambos métodos, correo y contraseña y Google.
- **Correo:** `fbiketrain@gmail.com`, creado y verificado como remitente en Brevo según captura del 2026-11-09. Sin dominio propio; avisos DKIM/DMARC y configuración SMTP pendientes. Contraseña guardada por petición del usuario únicamente en Markdown local excluido de Git (`.local-secrets/`).
- **Qué se sube:** todo (perfil, salidas, tracks, calendario y objetivos).
- **Tracks:** privados, protegidos con RLS, sin cifrado en el cliente.
- **Modo sin cuenta:** no hay. La cuenta es obligatoria.
- **Social:** estadísticas visibles para todos por defecto, o solo para amigos aceptados si el usuario lo elige. Los tracks nunca se comparten.

Decisiones abiertas para concretar durante el plan:
- **Comparación de rutas o subidas concretas:** cómo identificar recorridos equivalentes. Para la primera comparativa se han acordado distancia, desnivel, tiempo y número de salidas por semana, mes y año.
- **Amistades:** cómo se envía, acepta y retira una solicitud.
- **Datos locales existentes:** cómo se suben a la cuenta la primera vez que el usuario inicia sesión.

Reglas que no cambian:
- **Claves de ORS y Groq.** Siguen guardándose solo en local, nunca en el servidor.
- **Repositorio público.** La clave pública (anon) de Supabase puede ir en el código; la de servicio nunca. Las reglas RLS deben hacer que cada usuario lea solo lo suyo, salvo las estadísticas que haya decidido mostrar.

### 2. Comprobaciones del usuario

- Conseguir las claves de OpenRouteService y Groq, meterlas en Ajustes y probar una ruta real y una ruta con IA. Sin claves, Rutas y Rutas con IA solo muestran la pantalla que pide la clave.
- Comparar un mes real con Strava (distancia, desnivel, tiempo) y anotar el resultado en `docs/verificaciones.md`.
- Confirmar si la salida descartada por corta del ZIP real es basura de verdad.

### 3. Mejoras opcionales (no bloquean)

- Dividir el bundle con `import()` por pantalla. Ahora el JS principal pesa 795 kB (250 kB comprimido) y el worker 785 kB.
- Leer el ZIP de Strava en streaming. JSZip lo carga entero en memoria.
- Añadir los nombres en castellano que falten en `CYCLING_TYPES`, cuando aparezcan en un export: bicicleta virtual, eléctrica, gravel y montaña.
- Reducir los avisos de la región viva durante la importación.
- Añadir una prueba e2e de la copia de seguridad (F3 tarea 7) y una prueba de interfaz de que Cancelar en Rutas con IA aborta.
- Unificar en un helper la restauración del desplazamiento de Inicio, Historial y Subidas.
- Las fuentes emiten `.woff` además de `.woff2`.

## Límites conocidos

- El BSC200S no se detecta por USB. Se probó con el dock, con un puerto directo y con 2 cables. El GPX se pasa con la app de iGPSPORT.
- No se usan la API ni el MCP de Strava: piden suscripción.

## Datos útiles

- ZIP real: `C:\Users\Fran.Romano\Downloads\export_180782712.zip`. Nunca va al repositorio.
- Servidor de desarrollo para el móvil: `npx vite --host 0.0.0.0 --port 5173 --strictPort`, en http://192.168.1.141:5173.
- Playwright usa el puerto 4173 con reutilización; ese puerto debe quedar libre.
- El prototipo móvil se sirve sin caché con `node docs/design/prototipo-movil/servir.mjs` en el puerto 5174. Después de tocar su CSS o su JS hay que ejecutar `version.mjs`.
- Presupuesto: el usuario pide no pasar de un 60 % del límite semanal de tokens. Se usan agentes Sonnet, la verificación la hace la sesión principal con comandos y no se lanzan workflows grandes.
