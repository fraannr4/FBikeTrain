# Publicar comunidad abierta y retos

Rama: `codex/comunidad-abierta`. Worktree: `C:/testTrain-comunidad-abierta`. Base inicial: `main` en `e6e6c50`. El usuario ha autorizado el commit local de este lote. No se aplica SQL, no se hace push ni se publica.

## Qué cambia

Ciclistas lista todas las cuentas registradas con perfil, incluida la propia. Búsqueda por nombre o usuario, páginas de 50 y orden por día de uso reciente de la app; desempate estable por identificador. No representa la hora de una salida ni su ubicación. Las cuentas sin uso registrado siguen en el listado. Cuenta propia sin acciones hacia sí misma. Amigos conserva solicitudes y buscador cercano con bandas 5/10/25/50 km; nunca se amplían los permisos sobre celdas.

Retos admite distancia acumulada, desnivel acumulado, número de salidas, menor tiempo en una subida detectada y mejor media en una distancia continua. Duelos y grupos hasta 20 personas; invitaciones individuales y plazos de 1 a 30 días. Plantillas de 100 km, 1.000 m y 3 salidas. Retos anteriores de ruta conservados en una pantalla separada y enlaces antiguos por id válidos. Los enlaces de la biblioteca con `?ruta=` conservan el formulario de duelo de ruta; ese modelo anterior sigue usando amistades aceptadas. Los retos nuevos se crean desde Retos o Ciclistas y admiten a cualquiera.

El reto empieza al crearlo. Cada ciclista cuenta desde su aceptación hasta el cierre; quien entra tarde dispone de menos tiempo. La meta es una referencia de progreso: no es necesario alcanzarla para obtener el mejor resultado. Sin dos aceptaciones no hay ganador; sin registros positivos tampoco. Los empates comparten victoria.

Solo cuentan salidas completas importadas y enviadas antes del cierre, excluidos datos de ejemplo. El marcador usa un snapshot reemplazable: reimportar no suma dos veces; borrar datos locales recalcula el total durante el plazo. Al cerrar se congela y no acepta importaciones tardías. Cada participante debe abrir la app en el dispositivo que contiene sus salidas. No hay sincronización completa del historial entre dispositivos. La actualización automática conserva una cifra remota positiva si este dispositivo no reconoce su último envío; así un dispositivo vacío o desactualizado no la borra. En el detalle, «Usar las salidas de este dispositivo» permite reemplazarla expresamente, con advertencia, y establece el nuevo origen local. Es una protección de uso, no una certificación del archivo ni un permiso adicional del servidor. El archivo importado no se certifica independientemente: competición basada en confianza.

El servicio recibe solo el valor del marcador, no los nombres, ids, fechas ni tracks de las salidas. El marcador se recalcula al abrir/reanudar, recuperar conexión y escribir actividades/tracks, incluidas importaciones por Worker. Las pantallas consultan cada 30 segundos y permiten actualizar/reintentar. Cuando la app está cerrada no envía resultados.

Segmento/subida usa las subidas detectadas del historial (las últimas 50 salidas con track para elegir). Firma SHA-256 orientada de inicio, punto medio y final en celdas de 100 m de Mercator y longitud a 100 m; no se envían esas celdas ni geometría. Una variación de GPS en el borde de celda puede impedir reconocer el esfuerzo. No es una medición homologada ni un catálogo de segmentos públicos; no hay editor de tramos arbitrarios. Si Casa está configurada, el selector excluye subidas con extremos a menos de 1 km. La firma opaca no debe tratarse como anonimización criptográfica de ubicaciones de baja entropía.

Mejor media busca la ventana más rápida de la distancia indicada, con interpolación de tiempo y tiempo transcurrido, incluidas paradas. No concatena salidas; rechaza huecos mayores de 120 s, saltos mayores de 1.000 m, tiempos invertidos y velocidades mayores de 35 m/s. Sin track suficiente no hay registro.

Avisos internos paginados de invitaciones, aceptación/rechazo, amistades y cierre, con estado leído. El aviso de cierre se materializa al consultar los avisos; no necesita cron. No se envían emails ni mensajes externos.

## Seguridad

Migración nueva `202611160003_community_open.sql`, reservadas 202611160001/2 para el otro equipo. Perfiles públicos con lectura por columnas y RLS; solo el dueño conserva edición propia. El servidor consulta el registro real de Auth para excluir cuentas anónimas. RPC antiguas protegidas y helpers internos sin permiso RPC.

Cuota compartida de 20 destinatarios de amistades/invitaciones por ventana de 24 horas. Grupos consumen una unidad por invitado; retirar solicitudes no devuelve cuota. Contadores bajo bloqueo de fila; bloqueos e invitaciones serializados mediante advisory lock de transacción para impedir carreras en ambos sentidos.

Bloquear retira la amistad e impide nuevas interacciones, oculta perfiles, publicaciones, avatar y avisos. Si un reto contiene a alguien bloqueado, el reto completo deja de verse para las partes afectadas; los otros participantes conservan su vista. Desbloquear no restablece la amistad. Lista de bloqueados propia accesible desde Ciclistas.

Denuncias privadas con motivo de 5–500 caracteres y límite de 20 por 24 h. Lectura propia para el denunciante y de servicio para revisión manual; el denunciado no lee motivos. Sin sanciones automáticas ni panel de moderación en este lote.

## Pasos para publicar (pendientes de autorización)

1. Revisar el diff y el modelo en `docs/superpowers/plans/2026-11-16-comunidad-abierta.md`. Coordinar con el otro equipo el añadido al final de `scripts/test-account-sql.mjs`; conservar ambas suites sin sobrescribir cambios de biblioteca.
2. Actualizar la base de integración con `main`. Confirmar que 202611160003 continúa libre; si otro lote lo ha ocupado, renumerar esta migración y su referencia en el runner. No modificar 202611160001/2.
3. Repetir `npm run test:db`, `npx vitest run`, `npx tsc --noEmit`, `npm run build` y los escenarios Playwright de comunidad, perfiles y retos anteriores sobre la integración.
4. Tras el OK explícito para publicar, hacer copia de seguridad y aplicar **solo** la migración nueva en Supabase `btmsakyhkxrndvscmxqs`, después de sus predecesoras. Este lote no necesita secretos nuevos ni funciones Edge. El SQL está en una transacción; si falla, no continuar con frontend. Evitar `supabase db push` indiscriminado porque hay migraciones de otro equipo.
5. Probar con dos cuentas registradas y una anónima: directorio, perfil ajeno, cuotas, aceptar/rechazar, bloqueo en ambos sentidos por RPC directa, privacidad de zona, importar, ganador y lectura de avisos. PostgreSQL embebido simula Auth/Storage; no sustituye esa verificación del servicio real. Revisar denuncias manualmente con acceso de administración, sin trasladar credenciales al cliente.
6. Con autorización explícita de commit/push, integrar y publicar frontend; el push a main ejecuta pruebas y Pages. No publicar primero el cliente nuevo: depende de las RPC de la migración. Confirmar el workflow y repetir el flujo en móvil real a 390 px.

Mensaje de commit propuesto:

`feat: abrir comunidad y renovar retos con grupos, marcadores y protección anti-spam`

## Verificación local

Resultado final: `npm run test:db` correcto (13 bloques, PostgreSQL embebido); `npx vitest run --maxWorkers=4 --minWorkers=1` 1.909/1.909 en 150 ficheros; `npx tsc --noEmit` limpio; `npm run build` correcto y Vite repetido después del pulido visual; escáner de secretos limpio. Playwright: 62/62 escenarios de comunidad/perfil/navegación/retos anteriores; repetición final 26/26 de comunidad después de corregir la colisión CSS del marcador y el foco al enviar una denuncia. Último ajuste de compatibilidad de enlaces de biblioteca comprobado con 27/27 unitarias focalizadas y una nueva pasada del formulario de ruta, además de repetir `npm run build`. Incluye una importación GPX real por Worker, deduplicación y protección del marcador frente a un dispositivo vacío. Capturas reales revisadas en 360/390/412/430 px, ambos temas y apaisado. Selección versionable en [capturas](design/comunidad-abierta/README.md). Los avisos de bundle grande y anotaciones de Zod siguen siendo no bloqueantes. Las pruebas y capturas usan exclusivamente datos sintéticos. No se ha accedido al ZIP real ni a las credenciales de servicio.

## Correcciones de revisión sobre 5427d91 — 2026-11-16

La migración sigue siendo `202611160003_community_open.sql`, aún sin aplicar. `submit_community_score` rechaza cifras superiores a 400 km, 6.000 m o 4 salidas por día de participación; la media no supera 60 km/h. Un día es un bloque de 24 horas iniciado desde `accepted_at` (`ceil`, mínimo 1, máximo 30), independiente de medianoche y de los días anteriores a la aceptación. El exceso se rechaza y conserva el snapshot anterior; no se recorta.

El aviso de cierre solo se materializa para miembros aceptados. El listado de retos y el cierre perezoso parten de `community_challenge_members` filtrada por `user_id=auth.uid()`, con el índice existente, antes de unir retos.

`community_registered(uuid)` y `community_visible(uuid)` quedan sin EXECUTE de authenticated/anon/PUBLIC. Para conservar RLS se usan envoltorios definer sin argumentos, ligados a la sesión actual: comprobación de cuenta propia e IDs de perfiles visibles. No permiten sondear un UUID arbitrario. Las funciones definer internas conservan el uso de los predicados privados.

La sincronización del marcador recuerda el usuario y el reto de la pasada activa: peticiones para otro reto esperan y ejecutan una nueva pasada. Las repetidas para el mismo reto se agrupan y una pasada fallida no atasca las siguientes.

Verificación de la revisión: `npm run test:db` 13 bloques correctos; Vitest completo 1.911/1.911 en 150 ficheros; tipos, build y escáner de secretos correctos. Dos nuevas pruebas unitarias cubren la cola concurrente y su recuperación tras error. El usuario autoriza un commit local nuevo; no se hace push ni se aplica la migración remota.

## Reto de ruta (2026-11-16, migración 202611160004)

Tipo `route` dentro de los retos de la comunidad: mismas reglas de invitados, bloqueo, anónimos, plazo de 1 a 30 días y cuota de 20 destinatarios por 24 h. La ruta sale de la biblioteca común cercana a Casa (la consulta `route-sources` existente; el cliente ya recibe la línea), de una salida propia o de un GPX/TCX. El cliente recorta 500 m de cada extremo, simplifica a 2.000 puntos como mucho y envía esa geometría con su distancia (`create_route_challenge`). Solo la leen los participantes (`community_route_challenges`, RLS con `community_challenge_visible`).

**El cálculo es del cliente.** En el dispositivo se busca, entre las salidas guardadas desde la aceptación hasta el cierre, la pasada más rápida que pisa al menos el 90 % de las celdas de 200 m de la ruta, en su sentido (controles cada 5 % en orden), con media ≤ 60 km/h. El tiempo es en movimiento entre el punto más cercano al inicio y el más cercano al final. Se envía solo tiempo, cobertura, momento de paso e id local de la salida (`submit_route_result`); nunca el track. El servidor comprueba rangos (tiempo ≥ distancia a 60 km/h, cobertura 0,9–1, momento desde la aceptación y antes del cierre) y guarda el mejor tiempo de cada participante. No puede verificar el track: el reto se basa en la confianza. Un dispositivo vacío no borra nada; borrar la salida local no retira el resultado enviado.
