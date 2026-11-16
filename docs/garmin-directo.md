# Garmin directo: contrato y puesta en marcha

Revisado el **2026-11-16** (rama `garmin-directo`, sin commit ni despliegue). Sustituye la versión de Codex del 2026-11-11. El puente «Garmin vía Intervals» queda descartado: Intervals conserva su alcance y sus filtros. Solo se usa el programa oficial de Garmin, nunca contraseñas ni APIs privadas.

## Qué documenta Garmin hoy

| Tema | Lo que dice la fuente | Fuente |
|---|---|---|
| Autorización | **OAuth 2.0 con PKCE** (no OAuth 1.0a). `GET https://connect.garmin.com/oauth2Confirm` con `response_type=code`, `client_id`, `code_challenge` (S256), `redirect_uri`, `state`. Verificador de 43 a 128 caracteres. | [OAuth2PKCE_1.pdf](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf) |
| Tokens | `POST https://diauth.garmin.com/di-oauth2-service/oauth/token`, formulario, con `client_secret` obligatorio (por eso va en servidor). Respuesta con `expires_in` y `refresh_token_expires_in`; cada renovación devuelve un refresh token nuevo. Restar 600 s a la caducidad. | mismo PDF |
| Identidad y permisos | `GET .../wellness-api/rest/user/id` y `.../user/permissions` (`ACTIVITY_EXPORT`, `COURSE_IMPORT`…). Los cambios posteriores llegan por el webhook `User_Permission`. | mismo PDF |
| Desconectar | `DELETE .../wellness-api/rest/user/registration` es **obligatorio** si la app ofrece «Desconectar» o «Borrar mi cuenta». | mismo PDF |
| Niveles | Starter: Activity API (JSON y .FIT), Courses API (JSON), Health, Training; **solo push**, sin histórico, usuarios limitados. Enterprise añade Ping/Pull e histórico. | [Programa](https://developer.garmin.com/gc-developer-program/overview/) |
| Activity API | Resúmenes JSON o archivos FIT tras sincronizar el dispositivo; push o ping/pull. | [Activity API](https://developer.garmin.com/gc-developer-program/enterprise/activity-api/) |
| Courses API | «Publicar recorridos en Garmin Connect»; el usuario los sincroniza y los sigue en el menú Recorridos del dispositivo. | [Courses API](https://developer.garmin.com/gc-developer-program/courses-api/) |

**Lo que no es público** (está en el portal tras la aprobación): el esquema exacto de los push y el de Courses. El código sigue lo que usan integraciones públicas en producción y **hay que contrastarlo con los PDF del portal antes de activar**:

- Push: cuerpo JSON con listas por tipo, p. ej. `{"activityFiles":[{"userId","summaryId","activityId","fileType":"FIT","callbackURL","startTimeInSeconds"}]}`, `{"deregistrations":[{"userId"}]}`, `{"userPermissionsChange":[{"userId","permissions"}]}`. El FIT se descarga con `GET callbackURL` y `Authorization: Bearer <token del usuario>`; la URL es `https://apis.garmin.com/wellness-api/rest/activityFile?id=…&token=…`. Garmin espera respuesta en unos 30 s. Referencias: [open-wearables](https://github.com/the-momentum/open-wearables/blob/main/backend/app/services/providers/garmin/webhook_handler.py), [quantified-self](https://github.com/jimmykane/quantified-self/blob/main/docs/garmin-integration.md).
- **Garmin no firma los push.** Solo envía la cabecera `garmin-client-id` (el client id, que no es secreto). Por eso el receptor exige además un secreto propio en la ruta: `/notifications/<GARMIN_WEBHOOK_SECRET>`. Según quantified-self, el portal conserva la ruta y elimina la query, así que el secreto va en la ruta y no como parámetro.
- Courses: `POST https://apis.garmin.com/training-api/courses/v1/course` con `{courseName, distance, elevationGain, elevationLoss, activityType:"ROAD_CYCLING", coordinateSystem:"WGS84", geoPoints:[{latitude, longitude, elevation?}]}`; responde `{courseId}`. Puntos a 100 m como máximo y unos 10.000 como mucho. Referencias: [trailrunn.ing](https://github.com/bs-tools/trailrunn.ing/blob/main/internal/garmin/courses.go), [mapforge](https://github.com/mapforge-org/mapforge/blob/main/app/models/concerns/garmin_account.rb).

## Cómo funciona en FBikeTrain

1. **Ajustes → Conexiones → «Conectar con Garmin».** La Edge Function genera PKCE y `state` (un solo uso, 10 min, verificador cifrado) y el navegador abre la página oficial de Garmin.
2. Garmin vuelve a `/garmin/callback`. El servidor canjea el código, lee identidad y permisos, exige `ACTIVITY_EXPORT` y deja los tokens **cifrados (AES-GCM, clave `GARMIN_TOKEN_ENCRYPTION_KEY`, ligados a la cuenta)** como vinculación pendiente, sin guardar todavía la conexión. Redirige a `#/ajustes?abrir=conexiones&garmin_code=<código>`: un código de un solo uso y 5 minutos de vida, del que el servidor guarda solo el hash. La app lo retira de la dirección y llama a `POST /garmin/complete` con su sesión; el servidor guarda la conexión **solo si esa sesión es la cuenta que pulsó «Conectar»**. Si es otra cuenta, descarta la vinculación y responde 403. Así se evita el CSRF de OAuth: un atacante no puede iniciar el flujo con su cuenta y hacer que la víctima lo complete para quedarse con su Garmin. El navegador nunca recibe tokens de Garmin; tampoco van a IndexedDB ni a las copias.
3. Al sincronizar una salida, Garmin hace push a `/garmin/notifications/<secreto>`. El servidor comprueba el secreto y `garmin-client-id`, descarga el FIT (solo desde `apis.garmin.com/wellness-api/rest/activityFile`, sin redirecciones, 20 MB como máximo), comprueba la cabecera FIT y lo deja 30 días en el bucket privado `garmin-originals`. Cada entrega se procesa una sola vez (`garmin_claim_event`). Un fallo transitorio responde 503 para que Garmin reintente.
4. La app, al abrirse o al volver a primer plano, pide `/garmin/activities` y descarga cada FIT por `/garmin/activities/{id}/file`. Lo importa con el Worker y el importador de siempre, con descarte de duplicados y `origin: 'garmin-connect'` (atribución «Garmin» en lista y detalle).
5. **«Desconectar»** llama a `DELETE user/registration` y borra tokens, archivos y cola. Si Garmin manda una baja (`deregistrations`), se borra igual. Las salidas ya importadas se quedan.
6. **Biblioteca → «Enviar a Garmin»** (solo si el usuario concedió `COURSE_IMPORT`) publica el trazado mostrado como recorrido `ROAD_CYCLING`, remuestreado para que no haya más de 100 m entre puntos.
7. Las cuentas anónimas se rechazan (`signedInAccount`), igual que en `ors-proxy` y `route-sources`.

Mientras falten las claves (sin `GARMIN_CLIENT_ID` o `GARMIN_CLIENT_SECRET` en el servidor, o con `VITE_GARMIN_ENABLED` distinto de `true` en la build), el botón sale desactivado con «Pendiente de la aprobación de Garmin» y el camino manual: «Exporta el FIT desde Garmin Connect y súbelo en Importar». Con el interruptor apagado, la app no llama a la función.

## Rutas de la Edge Function `garmin`

Base: `https://btmsakyhkxrndvscmxqs.supabase.co/functions/v1/garmin`.

| Ruta | Acceso | Uso |
|---|---|---|
| `GET /callback` | pública (state de un solo uso) | Retorno OAuth. Esta URL se registra en Garmin. |
| `POST /notifications/<GARMIN_WEBHOOK_SECRET>` | pública (secreto + `garmin-client-id`) | Push de Garmin. Sin secreto configurado responde 503. |
| `GET /status` | sesión FBikeTrain | `available`, `connected`, `courseAvailable`, `receptionAvailable`. |
| `POST /connect` | sesión, no anónima | Devuelve la URL de consentimiento. |
| `POST /complete` | sesión de la cuenta que inició `/connect` | Cuerpo `{code}` con el `garmin_code` de la redirección. Guarda la conexión pendiente; 403 con otra cuenta, 400 si el código no existe, ya se usó o caducó. |
| `POST /disconnect` | sesión | Revoca en Garmin y borra todo. |
| `POST /course` | sesión, `COURSE_IMPORT` | Publica un recorrido. |
| `GET /activities`, `GET /activities/{id}/file` | sesión, `ACTIVITY_EXPORT` | FIT pendientes de importar (30 días). |

## Secretos y despliegue (solo con autorización del usuario)

Secretos de la función, nunca en el repositorio, en Vite ni en el chat:

- `GARMIN_CLIENT_ID` y `GARMIN_CLIENT_SECRET`: los da Garmin al aprobar.
- `GARMIN_TOKEN_ENCRYPTION_KEY`: 32 bytes aleatorios en base64 (`openssl rand -base64 32`).
- `GARMIN_WEBHOOK_SECRET`: cadena aleatoria URL-safe (`openssl rand -hex 32`).
- Ya existentes y reutilizados: `APP_ALLOWED_ORIGINS`. Opcional: `GARMIN_APP_URL` (por defecto `https://fraannr4.github.io/FBikeTrain/`).

Pasos:

1. Aplicar la migración `supabase/migrations/202611160010_garmin_connect.sql`. Crea las tablas sin acceso del navegador y el bucket privado.
2. `supabase functions deploy garmin --no-verify-jwt`. Hace falta `--no-verify-jwt` porque Garmin llama sin JWT a `/callback` y `/notifications`; las rutas de cuenta validan la sesión dentro del handler con `auth.getUser`.
3. Configurar los cuatro secretos.
4. Variable del repositorio `VITE_GARMIN_ENABLED=true` y volver a desplegar Pages.
5. Probar con una cuenta propia: conectar, sincronizar una salida nueva, comprobar la importación sin duplicados, enviar un recorrido, desconectar y comprobar que el acceso desaparece en Garmin Connect.

## Pruebas

- `tests/garminServer.test.ts`: PKCE, callback de un solo uso, vinculación solo desde la cuenta que inició el flujo (otra cuenta, código reutilizado o caducado: rechazado), refresco con rotación, revocación, receptor push (secreto, cabecera, hosts permitidos, idempotencia, 503 transitorio, bajas y permisos), Courses y rechazo de anónimos.
- `tests/garminClient.test.ts`, `garminProvider.test.tsx`, `garminConnection.test.tsx`, `sendToGarmin.test.tsx`, `garminSync.test.ts`, `privacy.test.tsx`.
- SQL: `supabase/tests/garmin_connect.sql` en `npm run test:db`.
- E2E: `e2e/conexiones.spec.ts` (390 px). El flujo conectado necesita una build con `VITE_GARMIN_ENABLED=true`.

Todo con mocks y fixtures sintéticos: no se ha llamado nunca a Garmin. **No hay ninguna prueba contra Garmin real.**

## Pendiente de confirmar con el portal tras la aprobación

- Esquema exacto de `activityFiles`, `deregistrations` y `userPermissionsChange`, y si el `callbackURL` redirige (el código rechaza redirecciones).
- Si Garmin ofrece algún mecanismo de autenticación del push además de `garmin-client-id`.
- Campos y límites de Courses (tipo `ROAD_CYCLING`, número de puntos y separación).
- Una baja que llegue tarde, después de reconectar, borraría la conexión nueva. Es poco probable; se resuelve reconectando.

Atribución de marca: «Garmin [modelo]» o «Garmin» junto a los datos, según la [guía de marca para API](https://developer.garmin.com/brand-guidelines/api-brand-guidelines/) (`src/ui/components/ActivitySource.tsx`).
