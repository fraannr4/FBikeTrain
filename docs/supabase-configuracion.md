# Configuración de cuentas

Desarrollo iniciado el 2026-11-09. Acceso obligatorio integrado en el punto de entrada de la aplicación, con correo/contraseña, registro, recuperación y Google. Pendiente validar esos flujos contra el proyecto real y completar configuración del panel.

## Recursos creados (confirmación del usuario, 2026-11-09)

| Recurso | Identificador | Estado |
|---|---|---|
| Supabase | `btmsakyhkxrndvscmxqs` | Proyecto creado según el usuario; configuración no comprobada en el panel |
| URL API | https://btmsakyhkxrndvscmxqs.supabase.co | Clave publishable facilitada e integrada en `src/auth/client.ts`; es pública, no una contraseña |
| Google Cloud | `fbiketrain-514211` | Proyecto creado; consentimiento y cliente OAuth pendientes |
| Brevo | Cuenta creada | Remitente `FBikeTrain <fbiketrain@gmail.com>` verificado en la captura del usuario; SMTP pendiente |
| Correo del proyecto | `fbiketrain@gmail.com` | Cuenta creada según el usuario; sin dominio propio |

Panel de Google: https://console.cloud.google.com/home/dashboard?project=fbiketrain-514211 .
Callback previsto para el cliente OAuth de Google: `https://btmsakyhkxrndvscmxqs.supabase.co/auth/v1/callback` (contrastar con el panel de Supabase antes de guardar).

No se almacena ninguna contraseña, clave SMTP ni secreto OAuth en esta documentación. Se ha recomendado cambiar la contraseña de Supabase compartida en el chat; cambio pendiente de confirmación del usuario. La contraseña de base de datos no sustituye a la clave pública del cliente.

El usuario ha pedido conservar las credenciales del correo: se han guardado en un Markdown local bajo `.local-secrets/`, carpeta excluida mediante `.gitignore`, sin copiarlas a los documentos versionables. Ese fichero es texto plano, no un gestor cifrado.

Captura del 2026-11-09: Brevo muestra el remitente Gmail como **Verificado**, con advertencias DKIM/DMARC por usar un dominio gratuito. Esto confirma la verificación del remitente, no la autenticación de `gmail.com` ni el envío efectivo desde Supabase. Pendiente configurar SMTP y probar confirmación y recuperación.

## Proyecto

Crear un proyecto Supabase (preferiblemente en región UE). Guardar la contraseña de base de datos fuera del repositorio. Para el navegador solo se necesitarán la URL del proyecto y su clave **publishable** (o la antigua `anon`). No usar `service_role` ni claves secretas en Vite, GitHub Pages o el chat.

Las migraciones se guardan en `supabase/migrations/`. La primera crea perfiles, amistades y un bucket privado de tracks. Aplicarla primero en un proyecto de pruebas, ejecutar las pruebas SQL y revisar los permisos antes de usar datos reales. Todavía no incluye tablas de actividades, sincronización ni comparativas.

Actualización del 2026-11-13: `202611130007_profile_journal.sql` aplicada y registrada por la API de gestión existente. Añade biografía, estilo ciclista, versión de foto, bucket privado `fbiketrain-avatars` (WebP, 512 KiB, archivo fijo por usuario) y publicaciones opt-in con RLS/RPC y cuota. No incluye sincronización de actividades ni tracks. Comprobaciones reales: tabla con RLS, bucket no público y acceso anónimo a los nuevos datos/RPC rechazado con 401. Las pruebas SQL cubren permisos con dueño, amigo aceptado, tercero y anónimo; se ejecutan en PostgreSQL embebido.

## Correo y Google (ambos acordados)

- Mantener la confirmación de correo activada. Configurar SMTP para enviar confirmaciones y recuperación a usuarios externos; el servicio predeterminado solo sirve para pruebas restringidas.
- Activar Google en Authentication > Providers. Crear el cliente OAuth de tipo web en Google Cloud y registrar como callback la URL indicada por Supabase (`https://<proyecto>.supabase.co/auth/v1/callback`). El secreto de Google se configura en Supabase, nunca en el código de la app.
- Configurar Site URL como `https://fraannr4.github.io/FBikeTrain/` y autorizar también `http://localhost:5173/` para desarrollo. Usar URLs exactas en producción.
- El cliente utilizará PKCE y procesará el callback antes de montar HashRouter; evitar que los tokens ocupen el fragmento reservado a las rutas. Verificar registro, confirmación, Google y recuperación desde Pages y desde local.

## Modelo preparado

- El cliente oficial usa PKCE, sin detección automática del fragmento. Un inicializador canjea el código una sola vez y limpia parámetros sensibles antes de montar el router; recuperación usa `?auth=recovery`.
- La guardia de cuentas impide montar pantallas y navegación sin sesión. La base local se abre como `ciclismo-user-<uuid>` y el Worker recibe expresamente ese nombre. Cambiar de identidad tras usar una cuenta fuerza recarga para vaciar estados en memoria.
- La base antigua `ciclismo` se conserva aparte, sin asignarla ni subirla silenciosamente. La migración asistida de esos datos está pendiente con la sincronización.
- «Más > Tu perfil» permite editar username, nombre y visibilidad y cerrar sesión localmente. La edición necesita que se aplique la migración SQL en Supabase.

- Perfiles buscables para usuarios autenticados, sin correos ni metadatos de OAuth públicos. Username único, nombre visible y visibilidad de estadísticas (`everyone` por defecto o `friends`). Cambiar la visibilidad no da acceso a tracks.
- Solicitudes por pareja única; solo el destinatario acepta. Cualquiera de los dos puede rechazar, cancelar o retirar. No se permiten escrituras directas en amistades.
- Tracks en bucket privado, bajo `<uuid-usuario>/<archivo>`; cada usuario solo puede leer y escribir en su carpeta. Ningún permiso social habilita lectura del GPS.
- 2026-11-09: migraciones 0001 y 0002 aplicadas en remoto con la API de gestión (token local en `.local-secrets/`, fuera del repositorio) y registradas en `supabase_migrations.schema_migrations`. Comprobado: tablas con RLS, bucket privado `fbiketrain-tracks` de 10 MB, 7 políticas, 5 funciones y el trigger de perfil. Aún no se han subido datos.
- 2026-11-09: Auth configurado por la API de gestión. Site URL `https://fraannr4.github.io/FBikeTrain/`; redirecciones para Pages y `localhost:5173`; SMTP de Brevo (`smtp-relay.brevo.com:587`, remitente `FBikeTrain <fbiketrain@gmail.com>`, 30 correos/hora). Credenciales solo en `.local-secrets/`. Pendiente: probar un registro real y Google.

## Crear y verificar el remitente en Brevo

1. Abrir **Configuración / Settings > Remitentes, dominios e IP / Senders, Domains, IPs > Remitentes / Senders**.
2. Pulsar **Añadir un remitente / Add a sender**.
3. Escribir **FBikeTrain** como nombre visible y una dirección de correo que se controle y pueda recibir mensajes. No inventar `noreply@fbiketrain.com` si no se posee ese dominio y dirección. El login técnico `…@smtp-brevo.com` tampoco es un remitente.
4. Guardar. Si el dominio no está autenticado, Brevo envía un código de seis dígitos a esa dirección. Revisar también spam, introducirlo en Brevo y pulsar **Verificar remitente / Verify sender**.
5. Confirmar que aparece como verificado. Si el dominio ya está autenticado, los remitentes que lo usan se verifican automáticamente.

Verificar la dirección y autenticar el dominio son pasos distintos. Con Gmail/Outlook se puede encontrar un aviso de autenticación: no se controla su DNS y no se puede autenticar ese dominio. Brevo documenta que puede sustituir temporalmente el remitente por una dirección propia y que la entrega puede verse afectada. No considerar el correo listo para usuarios reales solo por haber recibido el código.

Para un remitente estable con dominio propio:

1. Confirmar que se posee un dominio y acceso a su panel DNS. GitHub Pages puede seguir con su URL actual; el dominio de correo no obliga a cambiar el alojamiento web. No consta todavía que el usuario tenga dominio propio.
2. En **Dominios / Domains**, añadir el dominio y seguir la autenticación guiada de Brevo.
3. Copiar exactamente los registros DNS que muestre ese proyecto (código Brevo, DKIM y DMARC, según el flujo disponible). No inventar valores ni crear registros DMARC duplicados si ya existe uno; revisar la configuración existente.
4. Volver a Brevo y comprobar la autenticación. Los cambios DNS pueden tardar en propagarse; el proveedor indica hasta 48 horas.
5. Añadir el remitente del dominio y probar recepción real, confirmación de cuenta y recuperación de contraseña antes de abrir registros.

## Conectar Brevo a Supabase (después de verificar el remitente)

En Brevo, **Settings > SMTP & API > SMTP**, obtener el login SMTP y generar una **clave SMTP**. No usar la contraseña de Brevo ni una clave API. Configurar esos valores exclusivamente en el panel de Supabase, en los ajustes de SMTP de Authentication (la ubicación exacta puede variar según la versión del panel).

| Campo | Valor |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Puerto | `587` |
| Usuario | Login SMTP mostrado por Brevo |
| Contraseña | Clave SMTP generada en Brevo; no guardar en el repo ni enviar por chat |
| Nombre del remitente | `FBikeTrain` |
| Email del remitente | La dirección verificada, no el login técnico SMTP |

Guardar y probar el flujo real de confirmación y recuperación. Documentar solo el resultado y los errores sin credenciales. Las plantillas de Auth las gestiona Supabase; no hace falta crear campañas de marketing para esta integración.

## Verificación necesaria

`npm run test:db` ejecuta migración y pruebas de permisos en PostgreSQL embebido (PGlite), simulando solo los esquemas externos de Auth/Storage. Ha pasado localmente el 2026-11-09. Esto valida SQL y RLS del modelo de pruebas; no sustituye la API de Storage ni los flujos de OAuth/correo reales.

Ejecutar `supabase/tests/profiles_friendships.sql` contra la base de pruebas como administrador con `psql -v ON_ERROR_STOP=1 -f supabase/tests/profiles_friendships.sql`. El script utiliza usuarios sintéticos y revierte sus cambios. Hace falta una instancia Supabase; no basta con Vitest. Comprobar además la API de Storage real con dos sesiones (listado, subida, descarga, intento de mover y borrar archivos ajenos) antes de dar la seguridad por validada.

Fuentes consultadas el 2026-11-09:
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Permisos de Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
- [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Correo de pruebas](https://supabase.com/docs/guides/auth/testing-auth-flows)
- [Crear un remitente en Brevo](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)
- [Autenticar dominio en Brevo](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC)
- [Configurar dominio y propagación](https://help.brevo.com/hc/en-us/articles/35337929909778-Set-up-your-domain-in-Brevo)
- [Requisitos y sustitución temporal de remitentes](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)
- [SMTP de Brevo](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP)
