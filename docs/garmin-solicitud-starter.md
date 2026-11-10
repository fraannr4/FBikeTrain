# Garmin Connect Developer Program: solicitud de acceso Starter

> Revisión del 2026-11-10, conector: consultar [conectores-actividades.md](conectores-actividades.md) antes de enviar. Courses API documenta **publicar** recorridos en Garmin; la lectura de la biblioteca privada no está confirmada. Intervals.icu ya incluye iGPSPORT en su catálogo oficial, pendiente de comprobar disponibilidad en el móvil; quedan descartados los puentes con contraseña descritos al final de este borrador. Intervals avisa de restricciones para redistribuir datos Garmin: usar Personal/Starter directo.

Fecha: 2026-11-10. Decisión del usuario: pedir el nivel **Starter** para conectar Garmin desde FBikeTrain y recibir salidas nuevas. Courses permite publicar recorridos en Garmin; confirmar por separado con Garmin si existe lectura de los recorridos privados del usuario.

## Por qué Starter y no «login como otras apps»

- Las apps que piden tu usuario y contraseña de Garmin usan la web privada de Garmin Connect sin permiso: incumplen sus condiciones, se rompen con cada cambio o con la verificación en dos pasos, y obligan a guardar contraseñas ajenas en nuestro servidor. No lo hacemos.
- El camino oficial es el programa de desarrolladores. Con Starter, la app muestra un botón «Conectar con Garmin»: el usuario inicia sesión **en la web de Garmin**, autoriza FBikeTrain y Garmin nos envía sus datos. Nosotros nunca vemos su contraseña. Es el mismo flujo que usan Strava, intervals.icu o TrainingPeaks.
- Niveles, según [developer.garmin.com](https://developer.garmin.com/gc-developer-program/overview/) (consultado el 2026-11-10):
  - **Personal**: solo los datos de uno mismo, con clave propia. Salidas en JSON y FIT. Sin rutas.
  - **Starter**: para «organizaciones, desde desarrolladores individuales y startups hasta empresas». Incluye Activity API (JSON y FIT), **Courses API**, Health API y Training API. Entrega por push (Garmin llama a nuestro servidor). Sin histórico y con un número limitado de usuarios.
  - **Enterprise**: lo mismo más histórico de 1 mes, usuarios ilimitados y soporte. Condiciones a medida.
- Garmin no publica precios en esa página; Starter se concede por aprobación.

## Qué tiene que hacer el usuario (Claude no puede crear cuentas ni enviar formularios)

1. Entrar en el portal con una cuenta Garmin y abrir el formulario de Starter enlazado en la página del programa.
2. Rellenarlo con los textos de abajo. Guardar las credenciales de aplicación que Garmin entregue en `.local-secrets/credenciales.md`, nunca en el repositorio ni en el chat.
3. Avisar cuando llegue la aprobación. Entonces se planifica el módulo «Conectar con Garmin».

## Textos propuestos para el formulario (en inglés, que es el idioma del portal)

- **Company / organization**: AT Infoserveis (o el nombre con el que se quiera firmar; los desarrolladores individuales también pueden solicitarlo).
- **Application name**: FBikeTrain.
- **Website**: https://fraannr4.github.io/FBikeTrain/
- **Application description**:
  FBikeTrain is a free, personal cycling training web app. Riders import their rides, see their progression against their own level, plan workouts and generate road-cycling routes (GPX) for bike computers. We want riders to connect their Garmin account so that their activities and courses flow into the app without manual exports. Data is used only for the rider's own statistics and route planning and is stored per account; nothing is sold or shared with third parties.
- **APIs requested**: Activity API (JSON and FIT), Courses API. Health and Training APIs are not needed.
- **Expected number of users**: fewer than 100 in the first year (friends and club members).
- **Platform**: Web application (progressive web app), hosted on GitHub Pages with a Supabase backend (Edge Functions receive Garmin push notifications).
- **Data handling**: Activities are stored under the rider's own account and can be deleted by the rider at any time from the app. Garmin tokens are stored server-side, encrypted, and revoked when the rider disconnects.
- **Support contact**: el correo del usuario.

## Requisitos que faltan antes de enviar

- **Política de privacidad pública.** La app no tiene ninguna página de privacidad y los programas de este tipo suelen pedir su URL. Hay que añadir `#/privacidad` (qué se guarda, dónde, cómo borrarlo, terceros: Supabase, Groq, OpenRouteService, Nominatim, Garmin) antes de solicitar. Es una tarea pequeña; se puede incluir en el lote de Amigos.
- **Endpoint de recepción.** Starter entrega por push: necesitaremos una Edge Function pública que reciba las notificaciones de Garmin y descargue cada salida. Se implementa cuando llegue la aprobación.

## Mientras tanto

- **Nivel Personal** para el propio usuario: crear la clave en Garmin Connect y guardarla en `credenciales.md`. Con ella se puede probar la descarga de salidas (JSON y FIT) y comprobar si el navegador puede llamar directo o hace falta un proxy. Las rutas no están en este nivel.
- **Compartir desde la app de Garmin Connect o de iGPSPORT** al instalar FBikeTrain como PWA (rama `codex/pwa-compartir`): sirve para FIT, GPX y TCX, sin API.
- **Exportación manual**: GPX desde la web de Garmin Connect y FIT desde iGPSPORT, importados en la app como hoy.

## iGPSPORT

No se ha localizado una API pública general para FBikeTrain. Opciones compatibles:
- Compartir el FIT/GPX desde su app a FBikeTrain (PWA, en curso con Codex).
- Conexión nativa con Intervals.icu, si la ofrece la app/región del usuario: el catálogo oficial de Intervals ya incluye iGPSPORT. Pendiente comprobar una salida real en el móvil. FBikeTrain lee originales mediante la API oficial de Intervals; no se usan herramientas que pidan contraseña de iGPSPORT. Investigación y conector personal en `docs/conectores-actividades.md`.
