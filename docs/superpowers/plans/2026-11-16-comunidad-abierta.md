# Comunidad abierta y retos — 2026-11-16

## Modelo propuesto antes de implementar

Worktree `C:/testTrain-comunidad-abierta`, rama `codex/comunidad-abierta`, desde main e6e6c50. No modificar biblioteca, route-sources, rwgps ni migraciones 202611160001/2. No aplicar migraciones, commit, push ni deploy.

- Ciclistas: directorio paginado de todas las cuentas registradas (incluye la propia), búsqueda literal por nombre/username; actividad reciente por día, desempate estable por id. Sin email, celda ni distancia precisa. Los bloqueados quedan fuera. Mantener buscador cercano con bandas 5/10/25/50.
- Retos nuevos independientes de los antiguos: `community_challenges`, `community_challenge_members`, `community_challenge_scores`; tipos `distance`, `elevation`, `rides`, `segment`, `speed`. 1–30 días desde creación, 2–20 participantes, creador aceptado e invitados pendientes. Ventana de cada participante desde aceptación hasta deadline (no prorrateo). Invitar es consentimiento pendiente, no publica sus cifras.
- Objetivo opcional en la unidad SI del tipo; gana el mayor total (distance/elevation/rides), menor tiempo (segment), mayor velocidad (speed). Solo aceptados y con resultado >0 pueden ganar; empates compartidos; sin resultados no hay ganador. Ranking provisional antes del plazo, definitivo después. Sin al menos dos aceptaciones no hay ganador. Los invitados que no contestan caducan. No hay cron obligatorio.
- Marcador: snapshot de cifras derivadas localmente de las salidas importadas, reemplazable/idempotente hasta deadline. Apertura/reanudación/importación actualiza; consultar cada 30 s en pantallas sociales. Sin red conserva error/reintento y última fecha; no prometer sincronía cuando la app esté cerrada. Después del plazo se congela: importar tarde no altera el ganador. No sincroniza historial completo, tracks, nombres de salida ni Casa. Un dispositivo nuevo o con origen desactualizado no sustituye automáticamente una cifra remota positiva; el detalle permite reemplazarla de forma explícita y advertida.
- Segmento/subida: referencia opaca SHA-256 de extremos cuantizados y longitud de una subida detectada del historial; cotejo y tiempo en dispositivo. Solo código, nombre y longitud compartidos; nunca geometría. Tolerancia documentada, no es clasificación homologada. Mejor media: ventana continua de distancia fija en track con tiempo transcurrido (incluye paradas), sin interpolar huecos grandes ni GPS inválido.
- Avisos internos privados: invitación, respuesta, cierre. Acceso desde Retos con no leídos, marcar leído; paginación.
- Seguridad: helper registrado consulta auth.users.is_anonymous en servidor. RLS y RPC rechazan invitados/anónimos y filtran bloqueos bidireccionales. Perfiles ajenos de solo lectura, edición propia conservada. Anti-spam atómico 20 destinatarios amistad+retos en ventana 24 h; grupos consumen por destinatario, borrar no devuelve cuota. Denuncias con motivo acotado, privadas al denunciante y servicio; no hay sanción automática. Bloquear retira amistad, corta nuevas interacciones y oculta perfiles/avisos.
- Retos anteriores conservan lectura por ruta propia; asegurar que sus RPC tampoco permiten saltarse anonimato, bloqueo o cuota.

## Contrato compartido

RPC `list_cyclists(query_text text default '', page_offset integer default 0)` -> filas `{id,username,display_name,bio,riding_style,avatar_version,locality,distance_km,last_active_at}` (50 por página; distance_km null).
`touch_community_activity()` void; `block_cyclist(target_id uuid, blocked boolean)` void; `list_blocked_cyclists()` -> `{id,username,display_name}`; `report_cyclist(target_id uuid,reason text)` void.
`create_community_challenge(title text,kind text,duration_days integer,invited_ids uuid[],target_value double precision default null,distance_m integer default null,segment_key text default null)` -> uuid.
`respond_community_challenge(challenge_id uuid,accept boolean)` void.
`list_community_challenges(page_offset integer default 0)` -> jsonb[] / SETOF jsonb, cada objeto `{id,title,kind,created_at,deadline,creator_id,target_value,distance_m,segment_key,status,members:[{id,username,display_name,status,accepted_at,score,updated_at}],winner_ids:[]}`; status `active` o `finished`; members status `pending/accepted/declined`. Score null sin resultado, cero nunca ganador.
`get_community_challenge(challenge_id uuid)` -> mismo jsonb o null (también retos más antiguos que página 50).
`submit_community_score(challenge_id uuid,score double precision)` void: reemplaza solo cifra propia aceptada durante plazo; valores finitos, acotados por tipo. Snapshot recalculado de actividades locales; no hay verificación independiente de dispositivo (explicar).
`list_community_notifications(page_offset integer default 0)` -> `{id,kind,challenge_id,actor_id,created_at,read_at}`; `read_community_notification(notification_id uuid)` void.

Cliente `src/social/communityChallenges.ts` exporta CommunityChallenge, CommunityMember, ChallengeKind con las propiedades snake_case del contrato; listCommunityChallenges/getCommunityChallenge/createCommunityChallenge/respondCommunityChallenge/submitCommunityScore/listCommunityNotifications/readCommunityNotification, errores legibles. `src/social/community.ts` directorio/bloqueo/denuncia/touch.
Root implementa `src/social/challengeScoring.ts`: `scoreCommunityChallenge(challenge, userId, activities, getTrack)` -> Promise<number>; `segmentOptions()` -> Promise<{key,name,distanceM}[]> para selector (subidas y tramos), `syncCommunityScores(client,userId)`.
Rutas: /ciclistas; /retos (nuevo), /retos/nuevo (nuevo), /retos/comunidad/:id (detalle nuevo); /retos/anteriores (lista previa), /retos/:id (detalle previo), /retos/anterior/nuevo (creación previa opcional sin promoción).

## Validación y publicación

SQL embebido con usuarios, outsider y anónimo, cuota, bloqueos, privacidad, carrera de respuesta/score, snapshots, empates y plazos. Vitest, tsc, build y Playwright con backend sintético, capturas reales 360/390/412/430, ambos temas y apaisado. Revisión de cumplimiento y seguridad independiente. Entregar pasos de migración y frontend, pendientes reales y mensaje de commit. Numeración nueva a partir de 202611160003, comprobada frente a main al cierre.
