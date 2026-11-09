# IA compartida: preparación, no desplegada

`ai-routes` admite POST autenticado con el JWT de sesión en `Authorization: Bearer ...` y la clave publicable de la app en `apikey`. Mantener el control JWT de la plataforma y la comprobación `auth.getUser` del handler; la clave publicable sola no autoriza generar.

Contratos:

- `{ operation: 'plan', summary: LevelSummary, answers: { focus, minutes, explore, notes: '' }, maxDistanciaKm }`
- `{ operation: 'explain', summary: LevelSummary, facts: RouteFacts[] }`
- `{ operation: 'splice', facts: SpliceFacts[] }`: recomendación de empalme. De 1 a 12 opciones con solo cifras (distancia, desnivel, vías principales, conector, solape, retroceso); devuelve `{ recomendada, motivo }` y `recomendada` debe ser uno de los `id` recibidos.
- `{ operation: 'workouts', summary: LevelSummary, objetivo: { diasHasta, distanciaKm, desnivelM } | null, ocupados: number[], disponibles: number[], notas: '' }`: entrenos de los próximos 7 días. Los días son índices desde hoy (0-6); el objetivo va sin nombre ni lugar y las notas vacías, como en `plan`. Devuelve `WorkoutWeekSchema` (`{ entrenos: [{ dia, titulo, distanciaKm, desnivelM, notas }], motivo }`); el navegador recorta las cifras y los días.
- Éxito: `{ data: ... }` con el esquema de la operación.
- Error: `{ error: { code, message }, retryAfterS? }`. Códigos: unauthorized, invalid_request, quota_exceeded, unavailable, provider_error, timeout, cancelled, invalid_response. No se devuelven errores crudos ni claves.

La validación es estricta: sin coordenadas, tracks ni campos extras. No admite URL, modelo ni prompt del cliente. Notes está vacío por diseño para evitar enviar direcciones en texto libre; los títulos de hechos se sustituyen por `Ruta N`. El servidor reutiliza los prompts/esquemas existentes, controla el modelo (`openai/gpt-oss-20b`), no reintenta automáticamente y limita salida a 1.600 tokens y petición de proveedor a 20 segundos.

## Activación y secretos

No se ha activado ningún servicio remoto. Antes de desplegar deben comprobarse el runtime/bundle de Deno, aplicar `202611090002_shared_ai_quota.sql` y comprobar Auth/RLS/HTTP reales. Los tests locales no equivalen a esa verificación.

Configurar solo en secretos del proyecto:

- `GROQ_API_KEY`: clave del servicio común, no de un usuario existente.
- `SHARED_AI_ENABLED=true`: activación explícita.
- `GROQ_FREE_TIER_CONFIRMED=true`: solo tras comprobar que la cuenta está en el plan gratuito; el código no puede deducirlo de la clave ni garantiza que las tarifas futuras no cambien.
- `APP_ALLOWED_ORIGINS`: orígenes exactos separados por comas, por ejemplo `https://fraannr4.github.io,http://localhost:5173,http://127.0.0.1:5173`. No son URLs con `/FBikeTrain/`: CORS compara el origen.

La función usa las credenciales de Supabase ya disponibles en el entorno del servidor; nunca las copie a Vite ni al repositorio. Si falta configuración o falla comprobar la cuota, el servicio devuelve 503 antes de llamar a Groq.

## Cuotas iniciales conservadoras

Solo la función SQL de servidor puede consumir. Un bloqueo transaccional compartido evita sobreconsumo por concurrencia:

- 12 operaciones por día/usuario; 40 globales por día (UTC).
- 2 operaciones por minuto/usuario; 3 globales por minuto.
- `plan`, `explain`, `splice` y `workouts` cuentan por separado, una operación cada una: una búsqueda habitual necesita dos operaciones. Los intentos ya admitidos consumen incluso si el proveedor falla; evita reintentos ilimitados y gasto no contabilizado.

No confundir estas cuotas de aplicación con las efectivas del proveedor (peticiones y tokens). No se cambia automáticamente a planes de pago. Al agotarse, 429 con Retry-After.

Si el servicio común responde 503 o no hay red y el usuario tiene clave personal de IA en Ajustes, la app sigue con su clave. Con 429 (cuota agotada) no reintenta: muestra el límite y el formulario manual.

Pruebas: `node node_modules/vitest/vitest.mjs run tests/sharedAi.test.ts --maxWorkers=1 --minWorkers=1` y `npm run test:db` (PostgreSQL embebido, esquemas externos simulados). La prueba de cuotas verifica límites y permisos; la simultaneidad entre conexiones remotas requiere prueba en Supabase.

# Motor de rutas compartido: `ors-proxy`

Mismo patrón que `ai-routes`: POST autenticado (`Authorization: Bearer <JWT de sesión>` y `apikey` publicable), CORS con `APP_ALLOWED_ORIGINS`, JWT validado con `auth.getUser` y lógica portable en `src/routes/shared/orsService.ts` (probada con `tests/sharedOrs.test.ts`).

Contratos (zod estricto; ningún campo más):

- `{ operation: 'round_trip', start: { lat, lng }, lengthM, points, seed }`
- `{ operation: 'path', waypoints: [{ lat, lng }, ...], alternatives? }`: de 2 a 8 puntos; `alternatives` (2 o 3) solo con dos puntos, porque ORS no da alternativas con más.
- Éxito: `{ data: { features: [...] } }` con solo `geometry` y `properties.summary`/`extras` (`surface`, `waytypes`, `steepness`). No se reenvía `metadata.query`.
- Error: `{ error: { code, message }, retryAfterS? }`. Códigos: unauthorized, invalid_request, quota_exceeded, no_route, unavailable, provider_error, invalid_response, timeout, cancelled.

El servidor construye el cuerpo de ORS (`buildOrsBody`): perfil `cycling-road`, `elevation: true`, `extra_info: ['surface', 'waytype', 'steepness']` (en los trayectos `path`, también `waycategory`, para descartar autopistas en los empalmes) y `avoid_features: ['ferries', 'fords', 'steps']`. El cliente nunca envía la URL, el perfil ni las opciones. No registra coordenadas ni reenvía los mensajes de ORS (repiten las coordenadas). Espera máxima a ORS: 20 s.

Secretos: `ORS_API_KEY` (clave del servicio común, no la de un usuario) y `SHARED_ORS_ENABLED=true`. Sin ellos responde 503 antes de llamar a ORS.

Cuota (`202611100001_shared_ors_quota.sql`, función `consume_shared_ors_quota(account_id, cost)`, solo `service_role`): por usuario 150 al día y 8 por minuto; global 1.800 al día y 35 por minuto, por debajo de los 2.000 diarios y 40 por minuto de la clave gratuita de ORS. Cada petición cuesta 1, también con alternativas. Una búsqueda de Rutas usa 8 y una con IA hasta 15, así que la IA puede quedarse en 8 por el límite por minuto: la app muestra las rutas obtenidas y el aviso.

# Despliegue de las dos funciones (Windows, `npx supabase`)

Desde la raíz del repositorio, en PowerShell:

```
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push --dry-run
npx supabase db push
npx supabase secrets set GROQ_API_KEY=<clave> SHARED_AI_ENABLED=true GROQ_FREE_TIER_CONFIRMED=true
npx supabase secrets set ORS_API_KEY=<clave> SHARED_ORS_ENABLED=true
npx supabase secrets set APP_ALLOWED_ORIGINS=https://fraannr4.github.io,http://localhost:5173,http://127.0.0.1:5173
npx supabase functions deploy ai-routes
npx supabase functions deploy ors-proxy
```

No usar `--no-verify-jwt`: la plataforma debe exigir el JWT antes del handler. `db push --dry-run` enseña las migraciones pendientes (0001, 0002 y la de ORS) antes de aplicarlas.

Después, en GitHub, Settings > Secrets and variables > Actions > Variables: `VITE_SHARED_AI_ENABLED=true` y `VITE_SHARED_ORS_ENABLED=true`. Sin ellas el despliegue las deja en `false` y la app pide las claves personales. El despliegue comprueba con `scripts/check-bundle-secrets.mjs` que `dist` no lleva claves de servidor.

# Fuentes de referencia: `route-sources`

`route-sources` no usa Groq ni modifica este servicio IA. Preparar las migraciones `202611100002_route_sources_cache.sql` y `202611100003_route_sources_quota.sql`, `APP_ALLOWED_ORIGINS` y desplegar con `supabase functions deploy route-sources`, manteniendo la verificación JWT. El runtime utiliza su propia clave de servicio para caché/RPC; nunca llevarla al cliente. La nueva migración instala la cuota por cuenta (30/día y 3/minuto, sin anónimos) y la escritura con purga acotada y máximo de 2.000 puntos por ruta.

OSM es el respaldo disponible para activar primero. Wikiloc queda deshabilitado hasta obtener autorización expresa para acceso automatizado y confirmar una plantilla pública de búsqueda de carretera. Solo después se configuran, en servidor, `WIKILOC_AUTOMATION_AUTHORIZED=true` y `WIKILOC_PUBLIC_SEARCH_TEMPLATE`. No hay API pública de Wikiloc ni se sortean login, Premium o captcha. El adaptador se ha probado con fixtures sintéticos, sin validación contra HTML real.

Condiciones consultadas, contrato, límites, smoke tests y pasos completos: [docs/fuentes-rutas.md](../../../docs/fuentes-rutas.md). No se ha realizado despliegue remoto.
