# IA: rutas con referencias conocidas y entrenos propuestos

Fecha: 2026-11-10. Decisiones del usuario (sesión del 2026-11-09):
- La IA solo genera rutas o entrenos.
- Para las rutas consulta fuentes externas (Wikiloc, con OpenStreetMap como respaldo).
- Siempre bici de carretera, nunca autopistas ni autovías.
- El usuario eligió tres líneas: «Rutas más buenas», «Entrenos con IA» y «Empalmar rutas». La tercera ya está hecha en `2026-11-10-bienvenida-servidor-empalmes.md`.

Estado de partida:
- Ya existen en `main`:
  - la función `route-sources` con su cliente `src/routes/sources/client.ts` (`findRouteReferences`);
  - la IA compartida `ai-routes`, con las operaciones `plan`, `explain` y `splice`;
  - el proxy de ORS.
- Nada de esto está desplegado en remoto todavía. Por eso toda función nueva:
  - va detrás de una variable `VITE_*` apagada por defecto;
  - si el servidor falla, sigue funcionando sin ella.

Reglas que se mantienen:
- La IA recibe solo cifras resumidas: nunca coordenadas, tracks GPS ni «Casa».
- Mobile-first, con capturas a 360-430 px.
- Ninguna clave en el repositorio ni en el bundle.
- Pruebas con `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run test:db` y Playwright para las pantallas tocadas.
- Alcance pequeño: dos tareas y nada fuera de ellas.

## Task 1: Rutas con IA apoyadas en rutas conocidas y solo carretera

Objetivo: en Rutas con IA, las propuestas tienen en cuenta rutas conocidas cerca del punto de salida y el nivel del usuario. Ninguna ruta generada que use autopista o autovía llega al usuario.

Ficheros:
- crear `src/ai/references.ts` (puro), que convierte `RouteReference[]` en una lista para la IA:
  - cada elemento lleva `{ id, nombre, fuente, distanciaKm, desnivelM | null }`;
  - como mucho 6, sin URL, autor, geometría ni coordenadas;
  - descarta las que superan `maxDistanciaKm` por más de un 20 %.
- modificar `src/ai/prompts.ts` y `src/ai/schema.ts`:
  - el plan admite el campo opcional `referencias`;
  - cada opción puede llevar `referenciaId` (string o null);
  - la regla del sistema: «si una referencia encaja con el objetivo (±15 % en su dimensión), puedes basar una opción en ella y citarla en motivo; nunca copies cifras distintas de las recibidas».
  - Esquema estricto; un `referenciaId` desconocido se ignora en el código.
- modificar `src/ai/shared/service.ts` (operación `plan`): acepta `referencias` con el mismo esquema estricto, con 6 como máximo.
- modificar `src/ai/routePlanner.ts`:
  - antes de pedir el plan, si `import.meta.env.VITE_ROUTE_SOURCES_ENABLED === 'true'` y hay cuenta, llama a `findRouteReferences` con radio de 15 km y señal de cancelación;
  - cualquier error de fuentes se ignora y añade un aviso suave.
- Las tarjetas de ruta de `src/ui/pages/RutasIa.tsx` que salen de una referencia:
  - muestran «Basada en: {nombre} ({fuente})»;
  - enlazan a la URL original (`target="_blank" rel="noopener noreferrer"`).
- **Solo carretera.** En `src/routes/generator.ts`, o donde se filtran las rutas de ORS:
  - descartar cualquier ruta generada cuyo `extra_info` `waycategory` o `waytype` indique autopista o autovía (`motorway`, `trunk`), con la misma función que usa `src/routes/splice.ts`, extraída a un módulo compartido si hace falta, sin duplicarla;
  - si el proxy no pide `waycategory` en `round_trip`, añadirlo en `buildOrsBody` (`src/routes/shared/orsService.ts`) y en la llamada con clave personal.
- `.github/workflows/deploy.yml`: `VITE_ROUTE_SOURCES_ENABLED` sale de `vars.*` y está apagada por defecto.

Pruebas:
- `tests/aiReferences.test.ts`: recorte a 6, sin URL ni coordenadas en lo que se envía (comprobado con `JSON.stringify`), y el filtro por distancia.
- Prompts y esquema: una opción con `referenciaId` válida, una desconocida (se ignora) y una sin referencias.
- Planificador:
  - con fuentes caídas, el plan sigue y aparece el aviso;
  - con la variable apagada, no se llama a `route-sources`.
- Generador: una ruta con `motorway` o `trunk` se descarta; una con `primary` no.
- Servicio compartido: rechaza `referencias` con campos extra.

## Task 2: Entrenos de la semana propuestos por la IA

Objetivo: en Calendario, un botón «Proponer semana con IA» sugiere entre 1 y 7 entrenos para los próximos 7 días, adaptados al nivel y al próximo objetivo. El usuario los revisa y acepta los que quiera. Se guardan como `PlannedWorkout` normales.

Ficheros:
- crear `src/ai/workoutPlanner.ts`:
  - **Entrada para la IA.** `LevelSummary`, el objetivo con fecha más próximo (`{ diasHasta, distanciaKm, desnivelM }` o null, sin nombre ni lugar), los días ya ocupados de la semana (índices 0-6), los días disponibles que marca el usuario y sus notas (200 caracteres como máximo).
  - **Respuesta.** Validada con zod: `{ entrenos: [{ dia: 0-6, titulo (≤60), distanciaKm, desnivelM | null, notas (≤200) }], motivo }`.
  - **Recorte en código.** Ninguna salida pasa de un 15 % sobre la referencia de distancia ni de desnivel del usuario. Como mucho una salida larga a la semana, y nunca en días ocupados ni repetidos. Si la IA devuelve algo inválido, se avisa y no se guarda nada.
  - **Proveedor.** Usa la IA compartida (`sharedClient`, operación nueva `workouts`) con cuenta y `VITE_SHARED_AI_ENABLED`. Si no, usa la clave personal con `chatJson`, con el mismo respaldo ante 503 o error de red y sin reintento ante 429, igual que `routePlanner`.
- modificar `src/ai/prompts.ts`: `buildWorkoutMessages`, con un sistema en castellano en la línea de `PLAN_SYSTEM`. Incluye entrenos variados: rodaje suave, subidas, salida larga y descanso. Las cifras deben ser coherentes con el resumen.
- modificar `src/ai/shared/service.ts` y `supabase/functions/ai-routes/index.ts` para añadir la operación `workouts`:
  - esquema estricto;
  - cuenta contra la misma cuota que el resto de la IA, con coste 1.
- crear `src/ui/calendario/AiWeekSheet.tsx` y usarlo desde `src/ui/pages/Calendario.tsx`, con el componente `Sheet`:
  - **Formulario.** Días disponibles como chips (L-D) y notas opcionales. Botón «Proponer».
  - **Carga.** Estado de carga cancelable.
  - **Resultado.** Lista de propuestas con casillas (todas marcadas), «Añadir al calendario (N)» y el motivo de la IA.
  - **Errores.** Un error claro y la opción de volver a intentarlo.
  - **Guardado.** Los entrenos se guardan con `saveWorkout` (`src/calendar/calendarRepo.ts`), `manual: false`, `done: false`, la fecha calculada desde hoy en Europe/Madrid, y `notes` con prefijo «IA:».
  - Mobile-first. El botón solo aparece si hay IA disponible (compartida o clave personal).

Pruebas:
- `tests/workoutPlanner.test.ts`:
  - el recorte al 15 %;
  - días ocupados y repetidos descartados;
  - una sola salida larga;
  - una respuesta inválida da error sin guardar;
  - ninguna coordenada ni nombre de objetivo en el mensaje;
  - 503 con respaldo a la clave personal y 429 sin reintento.
- Servicio compartido: operación `workouts` válida y rechazo de campos extra.
- `tests/aiWeekSheet.test.tsx`: proponer, desmarcar uno y añadir guarda N-1; cancelar no guarda.
- e2e `e2e/ia-entrenos.spec.ts` a 390x844 con la IA simulada: la propuesta aparece y los entrenos quedan en el calendario.

## Comprobaciones del usuario (anotar en `docs/verificaciones.md`)

1. [x] (hecho 2026-11-10) Claves `GROQ_API_KEY` y `ORS_API_KEY`. Despliegue de `ai-routes`, `ors-proxy` y `route-sources`, más las migraciones 202611100001-0003.
2. [x] (hecho 2026-11-10) Activar `VITE_SHARED_AI_ENABLED`, `VITE_SHARED_ORS_ENABLED` y `VITE_ROUTE_SOURCES_ENABLED`.
3. En el móvil: una ruta con IA que cite una referencia conocida y una semana propuesta añadida al calendario.
