# Solicitud Garmin Starter: lista para enviar

Revisada el **2026-11-16**. Detalle técnico y fuentes: [garmin-directo.md](garmin-directo.md). Garmin usa hoy **OAuth 2.0 con PKCE**. Starter incluye Activity API y Courses API, solo por push y sin histórico.

## Antes de enviar

1. Publicar la build con la página de privacidad. Comprobar que https://fraannr4.github.io/FBikeTrain/#/privacidad se abre sin iniciar sesión.
2. Comprobar que el correo de contacto fbiketrain@gmail.com recibe mensajes.

## Campos del formulario (en inglés)

- **Company / organization**: FBikeTrain (individual developer).
- **Application name**: FBikeTrain
- **Website**: https://fraannr4.github.io/FBikeTrain/
- **Privacy policy URL**: https://fraannr4.github.io/FBikeTrain/#/privacidad
- **Contact email**: fbiketrain@gmail.com
- **APIs requested**: Activity API (FIT files) and Courses API. Health, Training and Women's Health are not needed.
- **Expected users**: fewer than 100 in the first year (friends and club members).
- **Platform**: Progressive web app on GitHub Pages with a Supabase backend (Edge Functions).
- **Application description**:

  > FBikeTrain is a free, personal cycling training web app. Riders import their rides, track their progression against their own level and plan road-cycling routes. With Garmin, a rider taps "Connect with Garmin", authorizes FBikeTrain on Garmin's website (OAuth 2.0 PKCE), and new cycling activities arrive automatically: our server receives the push notification, downloads the FIT file and the app imports it into the rider's history. Riders can also send a planned route to Garmin Connect as a course to follow on their device. Garmin tokens are stored only on the server, encrypted, and never reach the browser. "Disconnect" calls the user registration delete endpoint and erases tokens and pending files. Data is used only for the rider's own statistics and routes; nothing is sold or shared.

## URLs que pide el portal

- **OAuth redirect / callback URL**: `https://btmsakyhkxrndvscmxqs.supabase.co/functions/v1/garmin/callback`
- **Push endpoint (Activity Files, Deregistrations, User Permissions Change)**: `https://btmsakyhkxrndvscmxqs.supabase.co/functions/v1/garmin/notifications/<GARMIN_WEBHOOK_SECRET>`. Se rellena después de la aprobación, en el paso 5, con el secreto real. Ese secreto no se pega nunca en el chat ni en el repositorio.

## Qué hacer en Garmin, en orden

1. Abrir https://developer.garmin.com/gc-developer-program/overview/ y pulsar el botón de solicitud del nivel Business (Starter) («Request now»).
2. Rellenar el formulario con los campos de arriba y enviarlo.
3. Esperar el correo de aprobación. Entonces entrar en https://developerportal.garmin.com/ y crear la app (**Create App**) con las APIs **Activity** y **Courses**, y los permisos **Activity Export** y **Course Import**.
4. Copiar el **Consumer key** (client id) y el **Consumer secret** a `.local-secrets/credenciales.md`. Nunca al chat ni al repositorio.
5. En la herramienta de endpoints (https://apis.garmin.com/tools/endpoints), marcar la entrega **Push** y poner la URL de notificaciones con el secreto para **Activity Files**, **Deregistrations** y **User Permissions Change**. Dejar desactivados los demás tipos. En https://apis.garmin.com/tools/apiConfiguration, comprobar que la app tiene Activity y Courses.
6. Registrar la **redirect URL** de arriba.
7. Descargar los PDF de **Activity API** y **Courses API** del portal y guardarlos fuera del repositorio. Con ellos se comprueban los campos marcados como pendientes en [garmin-directo.md](garmin-directo.md).
8. Avisar para desplegar (migración, función, secretos e interruptor `VITE_GARMIN_ENABLED`), y probar con una salida propia.

Mientras tanto, la app muestra el botón desactivado («Pendiente de la aprobación de Garmin») y el camino manual: exportar el FIT desde Garmin Connect y subirlo en Importar.
