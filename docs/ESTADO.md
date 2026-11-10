# Estado del proyecto FBikeTrain

Última actualización: 2026-11-10 (sesión nocturna del 2026-11-09, con commits y push autorizados por el usuario).

## Resumen

La app está publicada en GitHub Pages con cuentas de Supabase. `main` despliega solo cuando el CI está en verde.

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
| `386a5fd` | IA y mapas desde el servidor (`ai-routes`, `ors-proxy`) y Empalmar rutas (`/rutas/empalmar`) |
| `f794820` | Fuentes de referencia de rutas (`route-sources`): OSM activo y Wikiloc apagado por defecto (rama de Codex) |

### Verificación actual (2026-11-10, sobre `f794820`)

| Comprobación | Resultado |
|---|---|
| `npx vitest run` | 95 ficheros, 1.171 tests en verde |
| `npx tsc --noEmit` | sin errores |
| `npm run test:db` | 5 suites SQL en verde: perfiles, cuota de IA, cuota de ORS, caché y cuota de fuentes |
| e2e | bienvenida, acceso, empalmar y break-ui de empalmar en verde (12/12 en empalmar) |
| CI | runs 42669547748 (`386a5fd`) y 42671066509 (`f794820`) en verde y desplegados |
| Producción | el login real funciona: una cuenta confirmada inició sesión el 2026-11-09 |

### Estado en Supabase (remoto)

- Aplicadas y registradas en `schema_migrations`:
  - `202611090001_profiles_friendships.sql` (perfiles, amistades y bucket privado de tracks);
  - `202611090002_shared_ai_quota.sql`.
- Auth configurado por la API de gestión:
  - Site URL de Pages y redirects de Pages y `localhost:5173`;
  - SMTP de Brevo (`smtp-relay.brevo.com:587`), con 30 correos por hora.
- **Sin aplicar:**
  - `202611100001_shared_ors_quota.sql`;
  - `202611100002_route_sources_cache.sql`;
  - `202611100003_route_sources_quota.sql`.
- **Funciones sin desplegar:** `ai-routes`, `ors-proxy` y `route-sources`.
- Las variables del repositorio `VITE_SHARED_AI_ENABLED`, `VITE_SHARED_ORS_ENABLED` y `VITE_ROUTE_SOURCES_ENABLED` siguen apagadas. Mientras tanto, la app pide claves personales en Ajustes.

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
  - Acceso obligatorio con correo y contraseña, recuperación y confirmación por correo. Google está preparado en el código, pero falta configurarlo en Supabase.
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

### Rutas de la app añadidas

`/rutas/empalmar`.

## Pendiente

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

### Necesita al usuario

1. **Claves del servidor.** Crear la clave de Groq (plan gratuito, sin tarjeta) y la de OpenRouteService, y guardarlas en `.local-secrets/credenciales.md` como `GROQ_API_KEY=` y `ORS_API_KEY=`. Con ellas, Claude hace lo siguiente:
   - aplica las migraciones 202611100001-0003;
   - despliega `ai-routes`, `ors-proxy` y `route-sources`;
   - guarda los secretos (`SHARED_AI_ENABLED`, `GROQ_FREE_TIER_CONFIRMED`, `SHARED_ORS_ENABLED` y `APP_ALLOWED_ORIGINS`);
   - activa las variables `VITE_*` y vuelve a desplegar.
2. **Wikiloc.** Confirmar si se acepta el riesgo de sus condiciones de uso antes de activar el rastreo. Sin esa confirmación, solo se usa OSM.
3. **Google OAuth.** Configurar el proveedor en Supabase con el cliente de Google Cloud `fbiketrain-514211`.
4. **Paleta de colores.** Elegir entre las propuestas de `docs/design/2026-11-10-paleta/`, que salen de otro chat y aún no están en git. No se aplica nada sin esa elección.
5. **Seguridad.** Al terminar, revocar el token de gestión de Supabase y la clave SMTP de Brevo: se pegaron en el chat. Guardar los nuevos solo en `.local-secrets/`.
6. **En el móvil.** Probar:
   - la bienvenida tras el login;
   - una ruta sin claves, cuando el servidor esté activo;
   - un empalme exportado al BSC200S con la app de iGPSPORT.
7. **Garmin e iGPSPORT.** La importación de varios FIT sueltos ya funciona en Importar. La investigación recomienda un conector de intervals.icu (clave personal, `GET /api/v1/activity/{id}/file`) para no depender del límite de exportación de Strava. Antes de planificarlo, comprobar si la app de iGPSPORT permite exportar o compartir los FIT.
8. **Comprobaciones antiguas sin registrar:**
   - F2: una subida conocida contra Strava;
   - F3: que un entreno se vincule con una salida real;
   - F4 y F5: rutas reales con claves.
   - Ver `docs/verificaciones.md`.

### Pendiente técnico

- **Sincronización.** Subir a Supabase las salidas, los tracks, el calendario y los objetivos, y la comparativa social. Plan: `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md`. Hoy los datos siguen en el IndexedDB de cada cuenta en cada dispositivo.
- Retirar el worktree de Codex (`C:\testTrain-codex`, rama `codex/fuentes-rutas`, ya integrada en `main`) cuando Codex no lo use.

### Mejoras opcionales (no bloquean)

- Dividir el bundle con `import()` por pantalla.
- Leer el ZIP de Strava en streaming.
- Añadir los nombres en castellano que falten en `CYCLING_TYPES`.
- Añadir una prueba e2e de la copia de seguridad.

## Límites conocidos

- El BSC200S no se detecta por USB. Se probó con el dock, con un puerto directo y con 2 cables. El GPX se pasa con la app de iGPSPORT.
- No se usan la API ni el MCP de Strava: piden suscripción.

## Datos útiles

- ZIP real: `C:\Users\Fran.Romano\Downloads\export_180782712.zip`. Nunca va al repositorio.
- Servidor de desarrollo para el móvil: `npx vite --host 0.0.0.0 --port 5173 --strictPort`, en http://192.168.1.141:5173.
- Playwright usa el puerto 4173 con reutilización; ese puerto debe quedar libre.
- El prototipo móvil se sirve sin caché con `node docs/design/prototipo-movil/servir.mjs` en el puerto 5174. Después de tocar su CSS o su JS hay que ejecutar `version.mjs`.
- Presupuesto: el usuario pide no pasar de un 60 % del límite semanal de tokens. Se usan agentes Sonnet, la verificación la hace la sesión principal con comandos y no se lanzan workflows grandes.
