# Chat entre ciclistas: diseño

Fecha: 2026-11-19. Estado: aprobado por el usuario (grilling del 2026-11-19). Plan de implementación: `docs/superpowers/plans/2026-11-19-chat.md`.

**Petición del usuario:** «crear un chat en la app para poder enviar salidas, proponer salidas, hablar con los usuarios y aumentar la interacción, un chat que permita hablar, pasar rutas de la biblioteca o tuyas en gpx, enviar solicitud de ruta conjunta, enviar fotos».

**Objetivo:** que dos o más usuarios de FBikeTrain hablen dentro de la app, se envíen salidas y rutas, y queden para salir juntos. Las fotos quedan fuera por decisión del usuario.

## 1. Decisiones del usuario (cerradas, no se reabren)

| Tema | Decisión |
|---|---|
| Quién escribe a quién | Solo amigos aceptados |
| Dónde vive en el móvil | Icono con insignia en la barra superior. La barra inferior no cambia: Retos sigue |
| Aviso push | Nombre y texto del mensaje, sin interruptor para ocultarlo |
| Cifrado | Sin extremo a extremo. RLS, y se declara en Privacidad que quien administra el proyecto podría leer los mensajes |
| Fotos | Sin fotos por ahora |
| Enviar una salida | Cifras y forma recortada 500 m por extremo. Nunca el trazado completo |
| Grupos | Hasta 20 personas, en el lote 3. Solo quien crea el grupo añade y quita; cualquiera puede salirse |
| Mensaje enviado | Cada uno borra los suyos, para todos; queda «Mensaje borrado». Sin editar |
| «Visto» | Sí, en las conversaciones de dos. En grupos no |
| Denuncias | El usuario las consulta en el panel de Supabase. Sin pantalla de moderación |
| Propuesta de salida | «Me apunto» y «No puedo». Apuntarse la pasa sola al Plan, con «Deshacer»; cambiar a «No puedo» la quita |
| Recordatorio | Ninguno fuera de la app: basta con que la salida esté en el Calendario del Plan |
| Sin cobertura | Mensaje marcado «No enviado» con «Reintentar». Leer exige red |
| Estilo visual | El publicado el 2026-11-19 («Libro de ruta»). Lámina aprobada por el usuario el 2026-11-19: `docs/design/2026-11-19-chat/` |
| Insignia del icono de chat | Roja, la misma `.tab-badge` de Retos. El contador de cada conversación va en azul |
| Empezar una conversación | Botón «Nuevo chat» en la barra de la lista de chats, que abre la lista de amigos; además de «Escribir» en Amigos y en el perfil |
| Prueba real | El usuario prueba con una segunda cuenta suya en otro dispositivo o navegador |

Valores que pone este diseño; el usuario los vio el 2026-11-19 y no vetó ninguno:

- Al dejar de ser amigos, la conversación queda en solo lectura; con bloqueo, deja de verse.
- El historial no caduca.
- Texto de hasta 2000 caracteres; 30 mensajes por minuto y 600 al día por usuario.
- En escritorio, «Chat» entra en el carril, dentro de «Comunidad».
- El aviso de una salida, una ruta o una propuesta dice el tipo y el día, nunca el lugar ni el trazado. El texto que escribe el usuario sí viaja en el aviso.
- Denunciar un mensaje bloquea a su autor en el mismo paso.

## 2. Qué hay ya y se reutiliza

Análisis del 2026-11-19 sobre `main` `6e8f46d`.

| Pieza | Dónde | Uso en el chat |
|---|---|---|
| Amistades por RPC, estados `pending` y `accepted` | `supabase/migrations/202611090001_profiles_friendships.sql`, `202611160003_community_open.sql` | Decide quién puede abrir una conversación y quién puede escribir |
| Bloqueo y denuncia: `community_blocks`, `community_reports`, `block_cyclist`, `report_cyclist`, `community_visible()` | `202611160003_community_open.sql` | El chat respeta el bloqueo en los dos sentidos; la denuncia gana el mensaje denunciado |
| Serialización por usuario con `community_rate_limits ... for update` | misma migración | Mismo patrón para el límite de mensajes |
| Push: trigger → `net.http_post` → función `push` → `src/push/service.ts` → `public/sw.js` | `202611170004_push_trigger.sql`, `202611170005_push_actor_name.sql` | Trigger y tipo de mensaje nuevos. Hoy la función solo acepta `table='community_notifications'` |
| Ruta de un reto: `route_points` jsonb de 2 a 2000 puntos, validados en SQL | `202611130002_retos.sql` | Mismo formato para una ruta enviada |
| Recorte de 500 m en cada extremo antes de publicar un trazado | `src/social/routeChallenge.ts` | Protege «Casa» al enviar una salida |
| Cifras de una salida para el cuaderno | `src/social/journal.ts` (`rideSnapshot`) | Tarjeta de salida |
| Mis rutas en Dexie, importar y exportar GPX | `src/routes/library.ts`, `src/routes/gpx.ts`, `src/ui/routes/gpxExport.tsx` | Elegir una ruta para enviar; guardar y exportar la recibida |
| Entreno planificado y `saveWorkout` | `src/domain/types.ts`, `src/calendar/calendarRepo.ts` | Una propuesta aceptada pasa al Plan |
| `AppBar` con `OwnProfileButton`, `ListRow`, `Sheet`, `Page`, `EmptyState`, `StateView`, `CyclingLoader`, `ProfileAvatar`, `useCommunityBadge` | `src/ui/` | Icono de la barra, lista, hojas e insignia |
| Pruebas SQL con PGlite y dobles de `auth` y `net.http_post` | `scripts/test-account-sql.mjs`, `supabase/tests/` | `supabase/tests/chat.sql` |
| Sesión sintética y Supabase respondido por ruta en Playwright | `e2e/accountFixture.ts`, `e2e/avisos.spec.ts` | `e2e/chat.spec.ts` |

Lo que no existe:

- **Tiempo real.** La app no usa Supabase Realtime; retos y avisos se refrescan por sondeo de 30 s y al volver a la app.
- **Envío sin red.** No hay cola de salida en la parte social: el error se enseña. El chat hace lo mismo, con «Reintentar».
- **Vínculo entre un entreno del Plan y una ruta.**

## 3. Límites del plan gratuito de Supabase

Leídos en https://supabase.com/pricing el 2026-11-19. El proyecto ya comparte la base de 500 MB con la sincronización entre dispositivos.

| Recurso | Límite | Consecuencia |
|---|---|---|
| Base de datos | 500 MB | Un mensaje de texto ocupa unos cientos de bytes: caben cientos de miles. Una ruta enviada pesa hasta unos 60 kB: va en tabla aparte |
| Storage | 1 GB | Sin uso: el chat sale sin fotos |
| Realtime | 200 conexiones a la vez, 2 millones de mensajes al mes, 256 kB por mensaje | Solo abre conexión quien tiene una conversación a la vista |
| Edge Functions | 500 000 llamadas al mes | Un aviso por mensaje y destinatario, con freno de 20 s por conversación |
| Pausa | Tras 1 semana sin actividad | Ya ocurre hoy; sin cambio |

Realtime, según https://supabase.com/docs/guides/realtime/postgres-changes: cada cambio se autoriza contra cada suscriptor con sus políticas RLS; la tabla debe estar en la publicación `supabase_realtime`; los `DELETE` no pasan por RLS; por encima de unos 3000 suscriptores a los mismos cambios recomiendan Broadcast. Para esta comunidad basta con cambios de Postgres filtrados por conversación.

## 4. Modelo de datos

```sql
chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group')),
  title text,                         -- solo grupos, de 1 a 60 caracteres
  direct_key text unique,             -- 'uuid_menor:uuid_mayor' en las de dos; null en grupos
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
)
chat_members (
  conversation_id uuid references chat_conversations on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'member',   -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  last_notified_at timestamptz,
  muted boolean not null default false,
  left_at timestamptz,
  primary key (conversation_id, user_id)
)
chat_messages (
  id uuid primary key,                -- lo genera el cliente: reintentar no duplica
  conversation_id uuid not null references chat_conversations on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),   -- siempre la hora del servidor
  kind text not null,                 -- 'text' | 'ride' | 'route' | 'library_route' | 'proposal' | 'system'
  body text not null default '',      -- hasta 2000 caracteres
  payload jsonb not null default '{}',
  deleted_at timestamptz
)
```

- Borrar un mensaje lo vacía (`body = ''`, `payload = '{}'`) y marca `deleted_at`. No se elimina la fila: los `DELETE` de Realtime no pasan por RLS.
- RLS: solo `chat_messages` se lee directamente (lo necesita Realtime), y solo si `chat_is_member(conversation_id)`: miembro que no se ha ido y, en una conversación de dos, con la otra persona visible (`community_visible`). `chat_conversations` y `chat_members` no se leen directamente, salen por RPC: así nadie puede mirar si la otra persona le ha silenciado ni cuándo se le avisó. Nadie inserta ni actualiza directamente; todo pasa por RPC `security definer`.
- `chat_messages` entra en la publicación `supabase_realtime`.
- Lote 2 añade `chat_routes` (puntos de una ruta enviada, fuera de la fila del mensaje). Lote 3 añade `chat_proposals` y `chat_proposal_replies`.

## 5. Reglas del servidor

- **Abrir conversación de dos:** amistad aceptada y persona visible. Si ya existe, se devuelve la misma.
- **Enviar:** miembro activo; en una de dos, amistad aceptada y sin bloqueo. Texto de 1 a 2000 caracteres. 30 mensajes por minuto y 600 al día. Repetir el mismo `id` devuelve el mensaje ya guardado.
- **Leer:** `chat_mark_read` anota `last_read_at`. La otra persona lo ve como «Visto» (solo de dos).
- **Sin leer:** número de conversaciones no silenciadas con mensajes ajenos posteriores a `last_read_at`.
- **Borrar:** solo el autor.
- **Denunciar un mensaje:** guarda en `community_reports` el autor, el motivo, el mensaje y una copia de su texto, y bloquea al autor. Mismas cuotas que `report_cyclist`.

## 6. Avisos push

Trigger `AFTER INSERT` en `chat_messages`. Por cada miembro que no sea el autor, no haya silenciado, no se haya ido y sea visible para el autor: llama a la función `push`, salvo que ese miembro haya recibido un aviso de esa conversación en los últimos 20 s. Una propuesta de salida avisa siempre. Un fallo al avisar nunca impide guardar el mensaje.

| Tipo de mensaje | Título | Cuerpo |
|---|---|---|
| `text`, de dos | Nombre público | Primeros 120 caracteres del texto |
| `text`, grupo | Nombre del grupo | «Ana: » y el texto |
| `ride` | Nombre o grupo | De dos: «Te ha enviado una salida.». En grupo: «Ana ha enviado una salida.» |
| `route`, `library_route` | Nombre o grupo | De dos: «Te ha enviado una ruta.». En grupo: «Ana ha enviado una ruta.» |
| `proposal` | Nombre o grupo | «Propone una salida el sábado 22.» (el día llega con el lote 3) |
| `system` | sin aviso | |

Si el nombre público no se puede enseñar, el título es «Mensaje nuevo» y la frase pasa a plural impersonal («Te han enviado una salida.»).

Dirección `#/chat/<id>` y etiqueta `chat`: el filtro de `public/sw.js` ya las admite y un aviso nuevo sustituye al anterior. Un nombre con pinta de enlace no se enseña (regla existente de `cleanActorName`).

## 7. Tiempo real y refresco

- **Conversación abierta:** canal de cambios de Postgres sobre `chat_messages` (`INSERT` y `UPDATE`), filtro `conversation_id=eq.<id>`. El canal solo avisa de que hay algo nuevo; el cliente vuelve a pedir la última página por RPC y funde por `id`. Así el nombre del autor y las reglas de visibilidad salen siempre del servidor.
- Si el canal no conecta o se cae, sondeo cada 10 s mientras la conversación está a la vista.
- **Lista:** se relee al entrar, al volver a la app y cada 30 s mientras está a la vista.
- **Insignia:** `chat_unread_count()` al navegar, al volver a la app, tras leer una conversación y cada 60 s con la app a la vista.

## 8. Privacidad

- Una salida enviada lleva cifras y la forma recortada 500 m por extremo. «Casa» no sale del dispositivo.
- Una ruta propia que empieza a menos de 500 m de «Casa» pregunta antes de enviarse y propone recortar el inicio.
- El punto de encuentro de una propuesta es texto que escribe el usuario; no se rellena solo.
- La pantalla de privacidad explica qué se guarda, quién lo lee, que no hay cifrado de extremo a extremo y que el texto de un mensaje viaja en el aviso push.
- Borrar la cuenta borra sus mensajes.
- La IA no interviene en el chat.

## 9. Interfaz (móvil primero)

- **Entrada:** icono de chat con insignia en la barra superior de las pantallas raíz del móvil, junto a la foto de perfil. En escritorio, «Chat» en el carril, dentro de «Comunidad». La barra inferior no cambia.
- **`#/chat`:** lista de conversaciones. Renglones con avatar, nombre, última línea y hora; sin leer en azul («ahora»). Vacío con una acción: «Escribe a un amigo».
- **`#/chat/:id`:** mensajes propios a la derecha y ajenos a la izquierda, agrupados por día. Campo de texto fijo abajo, por encima del teclado, con el muelle inferior oculto. «Visto» bajo tu último mensaje (solo de dos). Un mensaje que no sale queda «No enviado» con «Reintentar». En solo lectura, el campo se sustituye por una línea que lo explica.
- **Botón «+»:** hoja con «Salida», «Ruta» y «Proponer salida»; cada una aparece con su lote.
- **Tarjetas:** salida (forma, cifras); ruta (perfil, cifras, «Guardar en Mis rutas», «Descargar GPX»); propuesta (día, hora, lugar, quién va, «Me apunto», «No puedo»).
- **«Escribir»** en el perfil de un amigo y en la lista de amigos. **«Enviar por chat»** en una salida, en una ruta de Mis rutas, en una ruta de la biblioteca común y en un reto (lote 2).
- **Escritorio desde 1280 px:** lista a la izquierda y conversación a la derecha, como Historial.
- **Antes de implantar:** lámina con la lista, la conversación, la hoja de adjuntos y las tarjetas a 390 px en los dos temas. El usuario la aprueba. El rediseño del 2026-11-19 se implantó sin enseñarlo antes y no cumplió su expectativa.

## 10. Riesgos

- **Realtime con la sesión real.** Nunca se ha usado en este proyecto. Se comprueba en producción con dos cuentas antes de dar el lote 1 por bueno.
- **Push en un móvil real.** Sigue sin probar desde el 2026-11-17. El chat depende de ello más que los retos.
- **Texto en el aviso push.** Lo que escribe un usuario aparece en la pantalla bloqueada de quien lo recibe, y este no puede ocultarlo. Decisión del usuario.
- **Moderación.** Hay bloqueo y denuncia, y el usuario lee `community_reports` en el panel de Supabase. No hay aviso cuando entra una denuncia.
- **Teclado en iPhone.** Que el campo de texto quede a la vista con el teclado abierto solo se confirma en un teléfono real.

## 11. Fuera de alcance

Fotos, llamadas de voz o vídeo, mensajes de voz, vídeos, reacciones, indicador de «escribiendo», «Visto» en grupos, editar mensajes, leer o enviar sin red, recordatorios, calendario del móvil, pantalla de moderación, cifrado de extremo a extremo, chat con desconocidos, canales públicos.
