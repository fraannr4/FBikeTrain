# IA compartida: preparación, no desplegada

`ai-routes` admite POST autenticado con el JWT de sesión en `Authorization: Bearer ...` y la clave publicable de la app en `apikey`. Mantener el control JWT de la plataforma y la comprobación `auth.getUser` del handler; la clave publicable sola no autoriza generar.

Contratos:

- `{ operation: 'plan', summary: LevelSummary, answers: { focus, minutes, explore, notes: '' }, maxDistanciaKm }`
- `{ operation: 'explain', summary: LevelSummary, facts: RouteFacts[] }`
- Éxito: `{ data: ... }` con RoutePlanSchema o ExplanationSchema.
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
- `plan` y `explain` cuentan por separado: una búsqueda habitual necesita dos operaciones. Los intentos ya admitidos consumen incluso si el proveedor falla; evita reintentos ilimitados y gasto no contabilizado.

No confundir estas cuotas de aplicación con las efectivas del proveedor (peticiones y tokens). No se cambia automáticamente a planes de pago. Al agotarse, 429 con Retry-After. La clave común de ORS y la centralización del motor cartográfico son otra tarea.

Pruebas: `node node_modules/vitest/vitest.mjs run tests/sharedAi.test.ts --maxWorkers=1 --minWorkers=1` y `npm run test:db` (PostgreSQL embebido, esquemas externos simulados). La prueba de cuotas verifica límites y permisos; la simultaneidad entre conexiones remotas requiere prueba en Supabase.
