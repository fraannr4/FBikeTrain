# Avisos push: preparación, no desplegada

Avisa al móvil (Web Push, cifrado aes128gcm de RFC 8291 y VAPID de RFC 8292, solo con Web Crypto) de dos cosas: retos (`invitation`, `accepted`, `declined`) y solicitudes de amistad (`friendship`). Los demás tipos de `community_notifications` se ignoran.

## Cómo se dispara

Un Database Webhook de Supabase hace POST a la función en cada INSERT de `public.community_notifications`. El webhook lleva la cabecera `x-push-secret` con un secreto de servidor; la función lo compara en tiempo constante y rechaza (401) cualquier otra llamada. Ningún navegador puede invocarla con éxito: no declara CORS y el secreto nunca llega a la app.

La carga cifrada solo lleva `{ title, body, url, tag }` con texto fijo en castellano y la ruta hash a abrir (`#/retos/comunidad/<id>`, `#/retos`, `#/perfil/amigos`). Nunca nombres, tracks ni ubicaciones.

## Configuración

1. Aplicar `supabase/migrations/202611170003_push.sql`.
2. Secretos de la función (`supabase secrets set ...`): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...` o `https://...`) y `PUSH_WEBHOOK_SECRET` (al menos 32 caracteres aleatorios). La clave pública es la de `src/pwa/push.ts`; la privada que la acompaña no está en el repositorio.
3. Desplegar con `supabase functions deploy push --no-verify-jwt`: el webhook se autentica con `x-push-secret`, no con un JWT de usuario.
4. Panel de Supabase, Database, Webhooks: tabla `community_notifications`, evento Insert, tipo HTTP Request (POST), URL de la función `push`, cabeceras `Content-Type: application/json` y `x-push-secret: <el mismo secreto>`.

Sin secretos o sin claves VAPID, la función responde 503 y no envía nada.

## Destinos y caducidad

Solo se envía a `https` de FCM (`fcm.googleapis.com`), Mozilla (`*.push.services.mozilla.com`), Windows (`*.notify.windows.com`) y Apple (`web.push.apple.com`, `*.push.apple.com`), sin puerto ni credenciales y sin seguir redirecciones. Un endpoint que no cumpla se borra sin enviarle nada; los que contestan 404 o 410 también.
