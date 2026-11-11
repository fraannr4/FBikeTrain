# Conectores de actividades

Investigación: 2026-11-10; revisión: 2026-11-11. Fuentes oficiales enlazadas junto a cada conclusión. «No publicado» significa que no hay una garantía pública comprobada; no equivale a gratuito, ilimitado o compatible con CORS. El agente solo usa fixtures sintéticos; la evidencia autenticada del 2026-11-11 la ha facilitado el usuario, sin compartir su clave ni sus tracks.

## Decisión antes de implementar

Implementar **Intervals.icu con clave personal para uso propio**, lectura directa desde el navegador y almacenamiento local por cuenta. No necesita aprobación, servidor nuevo ni claves comunes. Para ofrecer conexión general a varios usuarios, la guía del proveedor recomienda OAuth: registrar una aplicación pública con PKCE antes de promocionar ese uso. No pedir contraseñas de terceros.

El puente **no garantiza recuperar Garmin ni Strava**: Intervals excluye Strava y avisa desde octubre de posibles restricciones de Garmin. Para Garmin, priorizar Personal o Starter directo. iGPSPORT aparece hoy en el catálogo oficial de integraciones de Intervals, aunque documentación anterior decía que no había conexión: hay que comprobar la opción nativa en la versión/región del móvil del usuario. No recomendar herramientas que inicien sesión en APIs privadas.

## Comparativa

| Opción | Datos y dirección | Acceso | Navegador o servidor | Límites, coste y aprobación | Encaje |
|---|---|---|---|---|---|
| Garmin Personal | Actividades JSON/FIT y salud; pull; no Courses anunciado | Clave personal y generación de tokens oficiales | CORS y protocolo detallado pendientes de verificar con la documentación de Personal; no asumir acceso directo | Solo datos propios; cuotas y precio no publicados en la tabla del programa; no solicitud Business | Alternativa directa para el dueño de un Garmin |
| Garmin Starter | Activity JSON/FIT, Health, Training, Courses; push; sin histórico | Solicitud y consentimiento OAuth oficial | Edge Functions para notificaciones y secretos/tokens; CORS no resuelve la recepción push | Usuarios limitados, cifra y precio no publicados; aprobación de Garmin | Objetivo para integración Garmin multiusuario |
| iGPSPORT | FIT de salidas y GPX/rutas según exportación disponible; conexiones seleccionadas | Autorización en las aplicaciones oficiales; no clave pública localizada para FBikeTrain | No hay contrato de API pública/CORS comprobado; no usar endpoints privados | Sin cuota pública para desarrolladores; depende de dispositivo/app/región y del tercero | Conexión nativa a Intervals si aparece; si no, compartir archivo |
| Intervals.icu | Lista JSON, original FIT/GPX/TCX según archivo recibido; rutas también tienen endpoints independientes | Basic `API_KEY:<clave>` para uso personal; OAuth para aplicaciones | CORS comprobado; no hace falta Edge Function para la clave personal | 5.000 peticiones/día, 2.500/15 min para claves; además 10/s/IP; API sin royalties; sin aprobación para clave propia | Primera implementación |
| Wahoo Cloud | Entrenamientos/salidas y archivo original; planes y rutas tienen scopes separados | OAuth2 con aplicación solicitada | Backend recomendado para secretos y notificaciones; no dar CORS por garantizado | Sandbox: 25/5 min, 100/h, 250/día; producción: 200/5 min, 1.000/h, 5.000/día. Precio no publicado; aprobación | Posterior, si hay usuarios Wahoo |
| COROS Partner | Actividades, push, sincronización bidireccional y rutas GPX | OAuth2; onboarding y credenciales de partner | Edge Functions para callbacks y secretos; CORS no comprobado | Cuotas y precio no publicados en la solicitud; requisitos de seguridad/operación | Posterior; el MCP individual no sustituye un conector FIT |
| Polar AccessLink | Ejercicios JSON/FIT/TCX/GPX; salud y actividad diaria. No confundir `activities` diarias con salidas | Registro de cliente, OAuth2 y alta/consentimiento del usuario | Servidor para client secret, intercambio y webhooks; CORS no comprobado | 500 + 20×usuarios/15 min; 5.000 + 100×usuarios/24 h. Cuotas por cliente. Sin tarifa por llamada publicada en referencia; revisar condiciones al registrar | Posible conector directo sin selección de partners equivalente a Garmin |
| Suunto Cloud | FIT con resumen, sensores y GPS; otras capacidades según producto contratado | OAuth2 y suscripción/API key de aplicación aprobada | Backend para secretos y callbacks; CORS no comprobado | API gratuita; solo empresas/organizaciones para público, no uso personal. Cuotas dependen del producto del portal; aprobación | Posterior |
| Komoot | Principalmente rutas; exportación GPX oficial de rutas y actividades completadas | Exportación por el usuario; API reservada a fabricantes seleccionados | Archivo/PWA; no automatizar la API web privada | Región de inicio desbloqueada para exportar; un archivo cada vez. Sin acceso público de desarrollador | Biblioteca de rutas, no puente automático de salidas |
| Dropbox | Bytes originales FIT/GPX/TCX en carpeta; no genera actividades | OAuth2 PKCE público; token personal solo para desarrollo propio | SDK JS/CORS; backend si se quieren webhooks o tareas con app cerrada | 429/Retry-After, sin cuota universal numérica; almacenamiento según plan; ampliar distribución requiere revisar estado de la app | Respaldo si el dispositivo ya deposita archivos |
| Google Drive | Archivos originales seleccionados; cambios/listado y descarga `alt=media` | OAuth, GIS/Picker; `drive.file` con mínimo permiso | SDK JS/CORS; servidor para refresh secreto o push | Cuotas y posible facturación cambian en 2026; scopes amplios requieren verificación | Más configuración que Intervals; no crea una exportación automática del dispositivo |

### Garmin: corregir la expectativa de Courses

La [tabla actual del programa](https://developer.garmin.com/gc-developer-program/overview/) confirma Personal y Starter y sus formatos/modos. La [documentación de Courses](https://developer.garmin.com/gc-developer-program/enterprise/courses-api/) describe **publicar recorridos de nuestra app en Garmin Connect**, no una garantía de descargar la biblioteca privada de Courses del usuario. Solicitar a Garmin confirmación de lectura de cursos antes de prometerla en el formulario de `docs/garmin-solicitud-starter.md`. [OAuth2 PKCE oficial](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf); credenciales de aplicación y tokens deben seguir sus condiciones y guías de marca. No usar librerías que acceden a la web con contraseña.

### iGPSPORT: qué está confirmado y qué no

La [FAQ de iGPSPORT](https://arg.igpsport.com/faqs/) explica conexiones a plataformas; [TrainingPeaks confirma AutoSync de salidas](https://www.trainingpeaks.com/partners/igpsport/) y envío de entrenamientos estructurados. Komoot sirve para recorridos, no se debe inferir una cadena de FIT hacia FBikeTrain. Strava queda descartado por decisión del proyecto.

El [catálogo oficial de Intervals](https://www.intervals.icu/integrations/) incluye iGPSPORT junto a Garmin, Wahoo, COROS, Suunto y Polar. No especifica en esa página el sentido, disponibilidad por región o modelo de cada conexión: comprobar **iGPSPORT Ride internacional → ajustes de conexiones → Intervals.icu**, consentimiento oficial y llegada de una salida original. No se garantiza para el BSC200S sin prueba física. No se ha localizado documentación oficial pública de API general ni exportación programada a carpeta de iGPSPORT. Un producto de terceros que pida la contraseña iGPSPORT no cumple las reglas de este proyecto, aunque luego suba por la API oficial de Intervals. La instrucción anterior de usar ese tipo de herramienta queda descartada.

### Intervals: contrato de lectura y restricciones

La [guía de acceso](https://forum.intervals.icu/t/api-access-to-intervals-icu/609) explica autenticación, cuotas, 429 y el aviso Garmin. La [referencia OpenAPI](https://intervals.icu/api/v1/docs) define:

- `GET /api/v1/athlete/{id}/activities?oldest=YYYY-MM-DD&newest=...`: orden descendente; fechas **locales**, no cursor paginado. `limit` limita el resultado; no usarlo para simular paginación perdiendo filas.
- `GET /api/v1/activity/{id}/file`: devuelve el archivo original; no garantiza que sea FIT. `file_type` permite elegir extensión. Los registros de Strava son stubs y su original no está disponible.
- No hay que convertir el JSON resumido a un GPX inventado: descargar el original y conservar sensores y tiempos.

Los [términos de API](https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087) permiten usos legales, incluso comerciales, sin royalties; prohíben abuso y requieren atribución para datos Garmin. El modo de clave personal pedido aquí es para datos propios. Para distribuir una integración multiusuario, usar [OAuth público con PKCE](https://forum.intervals.icu/t/intervals-icu-oauth-support/2759) y `ACTIVITY:READ`, sin secreto en el cliente.

**CORS medido el 2026-11-10**, sin autenticación: OPTIONS tanto en `/athlete/0/activities` como en `/activity/i1/file`, Origin `https://fraannr4.github.io`, método GET y cabecera authorization. Ambos: 200, `Access-Control-Allow-Origin` con ese origen, GET permitido y `authorization` admitida. Es evidencia del preflight, no una prueba de descarga autenticada. Si una petición real recibe desafío/403 o CORS cambia, mostrar error; no cambiar User-Agent ni esquivar protección. No enviar claves a un proxy público.

En este primer conector se excluyen explícitamente `STRAVA`, `GARMIN_CONNECT` y los originales cuyo `device_name` identifica Garmin, también si llegaron mediante otra fuente. Garmin directo queda para Personal/Starter, evitando depender del cambio anunciado y sin introducir atribución Garmin incompleta en las estadísticas existentes. Se informa del número excluido; no se los presenta como importados ni como fallo de la clave.

Los ids actuales de atleta pueden incluir prefijo `i`; se conserva completo. Los numéricos antiguos y el alias `0` también se admiten, como aclara el [autor de Intervals](https://forum.intervals.icu/t/api-access-to-intervals-icu/609?page=36).

### Otros proveedores y carpetas

[Wahoo portal](https://developers.wahooligan.com/cloud) requiere solicitud de aplicación y separa Sandbox/Producción; [referencia](https://cloud-api.wahooligan.com/) documenta cuotas y descarga (la autenticación y los archivos no consumen esa cuota). Respetar acuerdo API y scopes concedidos; no prometer gratuidad contractual sin respuesta del proveedor.

[COROS solicitud oficial](https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application): enviar datos de plataforma y redirects. La vía MCP individual no prueba disponibilidad de archivos originales para esta web. [Suunto API Zone](https://apizone.suunto.com/) confirma FIT, OAuth2, gratuidad y selección de partners; aceptar acuerdo antes de integrar.

[Polar referencia](https://www.polar.com/accesslink-api/) permite registrar cliente; revisar ventana de disponibilidad de ejercicios y consentimiento antes de importar histórico. Los antiguos endpoints transaccionales limitan datos a subidos después del alta y últimos 28 días; no extrapolar esa ventana a todos los endpoints actuales. Respetar permisos/revocación y cuotas.

[Komoot API para partners](https://support.komoot.com/hc/en-us/articles/10805168381210-komoot-API-for-partners) no es pública. La [exportación oficial](https://support.komoot.com/hc/en-us/articles/10115477099674-Export-and-import-Routes-and-Activities) está autorizada y exige región desbloqueada; no devuelve sensores completos en GPX.

[Dropbox OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth), [SDK JS oficial](https://dropbox.github.io/dropbox-sdk-js/index.html) y [errores/límites](https://developers.dropbox.com/en-us/error-handling-guide): listar carpeta con cursor de cambios y descargar, con permisos mínimos. OAuth de desarrollo no equivale a aprobación para distribución amplia. Solo funciona si alguien o un dispositivo coloca los FIT allí; una carpeta no sincroniza iGPSPORT por sí sola.

[Drive navegador](https://google.github.io/google-api-javascript-client/docs/start.html), [scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) y [cuotas vigentes](https://developers.google.com/workspace/drive/api/guides/limits): preferir Picker/`drive.file`; no asumir acceso recursivo a todos los futuros archivos de una carpeta elegida. Acceso amplio implica verificación de scopes restringidos. Para proyectos nuevos desde mayo de 2026: 1.000.000 unidades/min/proyecto y 325.000/min/usuario/proyecto; umbrales diarios de 400 millones de unidades y 1 TB de salida. Uso estándar sin coste adicional; la página anuncia posibles cargos posteriores. Respetar política de datos de Google. No usar enlaces públicos para FIT privados.

## Recomendación ordenada

1. **Ya:** Intervals personal para originales de fuentes admitidas, importación a un toque y comprobación al abrir/reanudar, máximo cada 6 h. API key e id en el navegador, fuera de backups y Supabase. Primera lectura desde la última salida real (con solape); sin historial, últimos 30 días. Importador y reporte existentes, reintento de pendientes y sin borrar salidas al desconectar.
2. **iGPSPORT ahora:** comprobar conexión nativa con Intervals y un FIT real en el móvil; si no está disponible, PWA/archivo oficial. No hay garantía de automatización compatible sin esa conexión; no usar puentes con contraseña ni Strava.
3. **Garmin propio:** probar Personal con clave generada por el usuario en su portal; verificar tokens, CORS y cuotas antes de otro desarrollo. Mantener importación de archivos como respaldo.
4. **Cuando aprueben Starter:** OAuth, revocación/borrado, recepción push autenticada según contrato, descarga FIT idempotente y almacenamiento privado/RLS. Starter no recupera el histórico: importarlo manualmente. Confirmar Courses de salida y posibles capacidades de lectura; no prometer ambas direcciones.
5. **Para varios usuarios:** registrar OAuth público de Intervals con PKCE; después priorizar Polar o Wahoo según dispositivos reales. Suunto/COROS solo si justifican onboarding. Carpetas de FIT como opción secundaria, Komoot para rutas.

Una web estática solo comprueba nuevas salidas mientras está abierta; no se promete sincronización con la app cerrada. Ninguna de estas decisiones autoriza despliegue, push o usar contraseñas ajenas.

## Uso de la implementación local

En **Más → Ajustes → Conexiones**, pega el athlete id completo (o `0`) y la clave personal, elige si quieres la comprobación automática y pulsa **Guardar conexión**. Después, **Sincronizar ahora**. La configuración se pliega y puedes volver a abrirla en «Cambiar conexión y sincronización». El informe es `ImportReportView`, también usado por la importación manual.

Las credenciales cifradas y el seguimiento se guardan en `db.meta`, separados de `Settings`: no salen ni siquiera en backups con «incluir claves». El cambio de clave/id reinicia el seguimiento; desconectar elimina clave, CryptoKey y seguimiento, conservando salidas. Borrar todos los datos cancela primero la sincronización y limpia también su estado de memoria.

Se reservan los intentos automáticos antes de la red; fallar o recargar no elude las seis horas. Las ventanas son de 30 días, sin `limit`, con solape de siete días tras completarse. En el primer enlace se incluyen dos días antes de la última salida real para cubrir diferencias horarias. Los originales completados no se descargan de nuevo; los errores se reintentan sin duplicar lo ya guardado. Un archivo pendiente no bloquea ventanas posteriores; las actividades manuales sin original se excluyen. Se respetan `Retry-After`, bloqueo entre pestañas, cancelación, 30 s por petición y 20 MB por archivo. No hay cambios SQL ni despliegue de funciones.

La descarga autenticada y la llegada de iGPSPORT quedan confirmadas por el usuario el 2026-11-11 (detalle abajo). Queda comprobar el uso diario en su móvil físico tras integrar estos cambios y las condiciones concretas concedidas por Garmin. Las pruebas automatizadas usan FIT/GPX sintéticos, nunca su ZIP ni actividades reales.

## Revisión para uso diario — 2026-11-11

Trabajo local en `codex/conectividad-revision`, sin commit, push ni despliegue.

### Contrato comprobado y filtro

El usuario ha comprobado `GET /api/v1/athlete/0/activities?oldest=&newest=` con respuesta 200. iGPSPORT llega con `source: "OAUTH_CLIENT"`, `device_name: "IGPSPORT 202"`, `file_type: "fit"`, `type: "Ride"`. Ese payload se admite; `OAUTH_CLIENT` identifica la integración que lo subió y no equivale a Strava ni Garmin. La regresión usa exactamente esos cuatro valores y un FIT sintético por el importador real. Strava y Garmin se siguen excluyendo por las reglas existentes.

El original de `/api/v1/activity/{id}/file` se recibió como `application/octet-stream`, sin comprimir, con `Access-Control-Allow-Origin: *`. El cliente comprueba los bytes gzip y admite ambos formatos, sin depender de `Content-Disposition`. No se reenvían archivos ni coordenadas a IA.

### Incremental y duplicados

- Se propone y conserva un primer rango de **30 días** sin historial: evita descargar años de archivos al configurar desde el móvil. Con historial, comienza dos días antes de la última salida real, nunca por `importedAt`; los datos demo y fechas futuras no amplían ese rango. Para histórico anterior, usar archivos.
- Consultas inclusivas de hasta 30 días locales, sin `limit`. Tras completarse, cursor en hoy menos siete días. Se corrigió un bug que usaba el comienzo de la última ventana y podía reducir ese solape a un día. Las ventanas con errores permanecen pendientes aunque se hayan importado ventanas posteriores.
- Se recuerda cada id completado dentro del rango revisable; un mismo original no se descarga otra vez. El importador conserva su segundo descarte por inicio/distancia para archivos manuales o dos ids distintos de la misma salida. Se corrigió también la comprobación de ids para no confundir propiedades de `Object` con ids completados.
- Los duplicados y descartes definitivos completan el id. Los archivos ilegibles quedan pendientes. Una actividad ya completada no se actualiza si luego cambia en Intervals; borrados remotos y cargas con más de siete días de retraso no se reconcilian automáticamente.

### Red y disparadores

429 y 5xx: máximo tres intentos por petición, esperas de 1 y 2 segundos o el `Retry-After` mayor (segundos o fecha HTTP). Una espera superior a cinco segundos detiene el lote y guarda `retryAt`; al agotar reintentos se impone además una pausa de al menos 60 segundos. Se evita continuar descargando otros archivos ante un fallo de servicio. Cancelación aborta tanto red como backoff. 401/403 nunca se reintentan; los errores no muestran cuerpos remotos ni secretos.

`Retry-After` solo es legible si Intervals lo expone mediante CORS; si no, se aplica el backoff predeterminado. El CORS de una descarga 200 no demuestra esa exposición en errores. Las reservas automáticas siguen limitadas a seis horas, incluso al recargar tras un fallo. **Sincronizar ahora** permite comprobar antes, respetando la pausa del proveedor. Al abrir, `visibilitychange` al volver visible y `pageshow` usan la misma ruta de sincronización y bloqueo de concurrencia. App cerrada: no sincroniza.

Guardar, cambiar y desconectar usan el mismo bloqueo que sincronizar: una operación concurrente informa de que hay que esperar y no cambia la conexión a mitad de descarga. Provider reserva también el trabajo antes de iniciar el cifrado; borrar todo espera su finalización. Web Locks coordina pestañas; sin esa API, la reserva en memoria solo coordina operaciones del mismo documento.

### Clave local y OAuth futuro

`intervalsCredentials.ts` resuelve las credenciales por base IndexedDB de cuenta. Guarda API key cifrada con AES-GCM de 256 bits e IV aleatorio, junto a una `CryptoKey` no exportable. Clave y cifrado se escriben atómicamente; el nombre de la base autentica el cifrado. La configuración anterior en texto se migra al leer sin reiniciar el seguimiento. Sin WebCrypto o si falla el descifrado no se usa texto plano como alternativa. Desconectar elimina ciphertext, CryptoKey y seguimiento; conserva las salidas. Nada de esto se incluye en backups ni se envía a Supabase.

Esto evita la clave legible en un volcado de los valores de configuración y su exportación mediante `exportKey`. **No protege contra XSS, extensiones maliciosas, un usuario con la sesión abierta ni una copia íntegra del perfil del navegador**: el mismo origen puede solicitar el descifrado con la CryptoKey. No sustituye el cifrado del dispositivo. Borrar los datos del navegador exige volver a conectar.

`intervalsSync` solo obtiene `{ provider, autoSync }`. El cliente pide `provider.authorization(signal)` en cada petición. Sustituir Basic por Bearer corresponde al proveedor, sin modificar ventanas, duplicados o importación. No se implementa OAuth en este lote. Pasos y requisitos comprobados: [Preparación OAuth](intervals-oauth.md).

### Uso móvil

Más → Ajustes → Conexiones ofrece un botón **Abrir ajustes de Intervals.icu**, pasos numerados, athlete id `0` preseleccionado y aviso visible de conectar el dispositivo directamente a Intervals, **no a través de Strava**. Tras guardar, la acción principal es **Sincronizar ahora**, junto a la última sincronización completa y el último intento. La clave guardada no se reinserta en el campo del formulario; dejarlo vacío la conserva. La recuperación de almacenamiento permite restablecer solo la conexión local sin borrar salidas.

Pruebas y capturas: [Verificaciones del lote](verificaciones.md). La emulación no sustituye la comprobación en el móvil físico.
