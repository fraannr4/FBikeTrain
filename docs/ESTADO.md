# Estado del proyecto FBikeTrain

Última actualización: 2026-11-10 por la tarde (commits y push autorizados por el usuario).

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

### Conector de actividades (rama `codex/conectores`, 2026-11-10)

Investigación y decisiones en `docs/conectores-actividades.md`. Fusionado en `main` y publicado el 2026-11-10: Ajustes > Conexiones permite guardar clave personal e id de Intervals.icu (incluido prefijo `i` o alias `0`), traer originales FIT/GPX/TCX por el Worker/importador actual con su informe de duplicados, y comprobar al abrir/reanudar como máximo cada 6 h. CORS permite lectura directa; no hay proxy, SQL nuevo ni claves en Supabase/backups. Configuración y seguimiento aislados por cuenta en IndexedDB. Se excluyen Strava y fuentes/dispositivos identificados como Garmin; Garmin directo queda para Personal/Starter. La app debe estar abierta. Antes de promover uso multiusuario, registrar OAuth de Intervals. Pendiente probar con una clave y dispositivo reales, y confirmar conexión nativa iGPSPORT en el móvil; no usar puentes con contraseña. El conector y el resultado de sus verificaciones se detallan en la guía y `docs/verificaciones.md`.

### PWA y recepción de archivos (rama `codex/pwa-compartir`, 2026-11-10)

Implementado en la rama, sin push ni despliegue: manifest instalable, iconos de marca 192/512, SW propio que solo recibe POST multipart, pantalla `/compartido`, reanudación tras login y acción de instalación en Ajustes. Rutas de referencia mediante `importReferenceRoute`; actividades mediante el importador existente con su informe de duplicados. No hay precaché ni modo offline. Guía y límites: `docs/pwa-compartir.md`. Pendiente comprobar la instalación y los envíos desde Wikiloc/iGPSPORT en un Android real; iOS no admite `share_target`. Verificación del lote en `docs/verificaciones.md`.

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

### Lote de IA: Empalmar y objetivo HECHOS (`031a5c4`); referencias de biblioteca PENDIENTE

Plan `docs/superpowers/plans/2026-11-10-ia-empalmes-objetivo-biblioteca.md`. El workflow se paró a propósito antes de la Task 3 (presupuesto semanal al 15 %).
- T1 hecha: Empalmar hasta 3 tramos en el orden elegido, salidas del historial como tramo, guardar el empalme en la biblioteca y «Empalmar con…» desde la tarjeta de IA (guardado automático). e2e `empalmar`, `break-ui-empalmar` y `rutas-ia`: 17/17 en el verificador del workflow.
- T2 hecha: el objetivo (evento más próximo; si no, el volumen vigente; solo cifras, nunca nombres) va en los prompts de plan y de empalme con `aiGoalSchema` estricto; cuota de la IA 30 por usuario y 300 globales al día, 10 globales por minuto (migración `202611100004`, aplicada en remoto el 2026-11-10). `ai-routes` redesplegada ese día.
- T3 pendiente: referencias de la biblioteca con enlace y autor del GPX (`ReferenceRoute.author`, `referenceSite`, `libraryReferences`, `pickReferences`, fuente `biblioteca`). Relanzar con `Workflow({ name: 'develop-phase', args: { plan, ui: true, maxFixRounds: 1, model: 'fable', tasks: [{ n: 3, agent: 'cycling-routes-engineer' }] } })`.
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

Amigos, Retos, Garmin Starter, PWA para compartir, escritorio, conector opcional de intervals.icu (iGPSPORT no tiene API: se comparte por la PWA o se puentea con intervals.icu) y sincronización de salidas con Supabase.

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
