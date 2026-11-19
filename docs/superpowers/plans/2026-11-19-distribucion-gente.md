# Distribución con pestaña «Gente»: plan de implementación

> **Para quien lo ejecute:** una tarea cada vez, con TDD, y `git status --short` antes de tocar cada fichero. Las casillas (`- [ ]`) sirven para seguir el avance.

**Objetivo:** que lo social (Chats, Amigos, Retos y Ciclistas) viva junto en una pestaña «Gente», que el Inicio enseñe lo que la gente espera de ti, y que Importar, Ajustes y la copia de seguridad estén a un toque de tu foto.

**Arquitectura:** solo cambia el armazón y la composición de pantallas; ni base de datos ni RPC nuevas. Las cuatro partes de «Gente» conservan sus direcciones (`#/chat`, `#/perfil/amigos`, `#/retos`, `#/ciclistas`) y comparten una navegación segmentada. Los contadores salen de los clientes que ya existen.

**Pila:** React 18, HashRouter, tokens de «Libro de ruta». Sin dependencias nuevas.

**Lámina aprobada (2026-11-19):** `docs/design/2026-11-19-distribucion/lamina.html` y su `README.md`. Manda la lámina en composición, textos y orden; los estilos de sus pantallas están en `<style id="distribucion-css">`.

## Decisiones cerradas por el usuario (2026-11-19, no se reabren)

- Barra inferior con cuenta registrada: `Inicio · Salidas · Rutas · Plan · Gente`.
- «Historial» pasa a llamarse «Salidas» (rótulo y título; las direcciones `#/historial…` no cambian).
- «Gente» reúne Chats, Amigos, Retos y Ciclistas. El icono de chat de la barra superior desaparece.
- Al tocar «Gente» se abre la parte que tenga algo pendiente; si no hay nada, Chats.
- La foto de perfil («Tú») lleva a perfil, Importar salidas, Ajustes, Copia de seguridad y Privacidad. «Más» desaparece para quien tiene cuenta.
- El Inicio gana «Hoy» y «Tu gente» antes de las cifras de la semana.
- Aspecto: el publicado. Sin tokens ni colores nuevos.

## Restricciones globales

- Móvil primero: cada pantalla se valida a 360, 390 y 430 px con capturas reales, y a 1440 px.
- Repositorio público: datos sintéticos en pruebas y capturas.
- Árbol compartido con otra sesión: `git status --short` y `git diff -- <fichero>` antes de editar. Si un fichero a tocar tiene cambios ajenos sin commit, parar y preguntar. No tocar `docs/design/2026-11-10-paleta` ni `2026-11-19-carretera`, `-etapa`, `-exploracion`, `-relieve`.
- Sin commit ni push sin el sí del usuario. Nada contra Supabase real.
- Rendimiento del PC: nunca vitest y Playwright a la vez; Playwright con `--workers=2` y solo las specs de la tarea. La suite completa de Playwright, solo si el usuario la pide.
- Modo local (sin cuenta o con cuenta anónima): no hay comunidad. La quinta pestaña sigue siendo «Más» y nada de «Gente» ni «Tu gente» se pinta.
- Los ficheros del árbol son CRLF.

## Foco de revisión

1. Un aviso push abre `#/chat/<id>`, `#/retos/comunidad/<id>` o `#/perfil/amigos`: tiene que seguir cayendo en su pantalla, con «Gente» marcada en el muelle.
2. Cuenta anónima o sin cuenta: ni pestaña «Gente», ni llamadas RPC de comunidad, ni bloque «Tu gente»; `#/mas` sigue funcionando.
3. Un fallo de red al contar pendientes deja los contadores a cero y no rompe el Inicio ni el muelle.
4. Nombres largos, 99+ pendientes y los cuatro segmentos con contador a 360 px: nada desborda ni baja de 44 px.
5. Enlaces antiguos (`#/mas`, `#/amigos`, favoritos al «Historial») siguen llevando a algún sitio útil.

---

## Lote 1. Armazón: muelle, «Gente» y «Tú»

### Tarea 1: contadores de lo pendiente

**Ficheros:** crear `src/ui/shell/useFriendRequests.ts`, `src/ui/shell/GentePendingContext.tsx`; modificar `src/ui/shell/AppShell.tsx`; borrar `src/ui/shell/ChatUnreadContext.tsx` (lo sustituye el contexto nuevo). Pruebas: `tests/gentePending.test.tsx`.

**Interfaces que produce:**

```ts
// src/ui/shell/GentePendingContext.tsx
export type GentePending = { chats: number; amigos: number; retos: number; total: number };
export function GentePendingProvider(props: { value: GentePending; children: ReactNode }): JSX.Element;
export const useGentePending: () => GentePending;
/** Parte de «Gente» que se abre: la primera con pendientes en este orden; sin nada, Chats. */
export function genteStart(p: GentePending): '/chat' | '/retos' | '/perfil/amigos';   // orden: chats, retos, amigos

// src/ui/shell/useFriendRequests.ts — solicitudes recibidas sin responder
export function useFriendRequests(account: Account | null, reloadKey?: unknown): number;
```

- `amigos` cuenta las filas de `listFriends` con `status === 'pending'` y `direction === 'received'`. Mismo patrón que `useCommunityBadge`: solo cuenta registrada, relee con `reloadKey`, `visibilitychange` y `COMMUNITY_CHANGED_EVENT`, cero si falla.
- `chats` es `useChatUnread`; `retos` es `useCommunityBadge`. `total` es la suma.
- `AppShell` calcula los tres una vez y envuelve `children` con `GentePendingProvider`.

- [ ] Pruebas: suma de los tres; `genteStart` con cada combinación; cuenta anónima da ceros sin llamar; fallo de red da cero.
- [ ] Implementar y pasar `npx vitest run tests/gentePending.test.tsx tests/chatUnread.test.tsx`.

### Tarea 2: muelle, carril y nombres

**Ficheros:** `src/ui/shell/screens.ts`, `src/ui/shell/TabBar.tsx`, `src/ui/components/AppBar.tsx`, `src/ui/styles/shell.css`, `src/App.tsx`; borrar `src/ui/shell/ChatButton.tsx` y la regla `.appbar-chat`. Pruebas: `tests/shell.test.tsx`, `tests/chatUnread.test.tsx` (quitar lo del botón), `e2e/comunidad-nav.spec.ts`.

- `TabId` gana `'gente'`. `tabOf`: `/gente`, `/chat…`, `/retos…`, `/ciclistas…`, `/perfil/amigos` y `/personas/…` dan `'gente'`; `/perfil` (lo demás), `/mas`, `/importar`, `/ajustes`, `/compartido` y `/zona` dan `'mas'`.
- `NAMES['/historial'] = 'Salidas'`. El título de la pantalla `Historial` y cualquier texto de interfaz que nombre la pestaña pasan a «Salidas».
- Muelle del móvil con cuenta registrada: `Inicio · Salidas · Rutas · Plan · Gente`. «Gente» enlaza a `/gente`, icono `Users`, insignia `total` («9+» por encima de nueve) y `aria-label` «Gente, N pendientes». Sin cuenta registrada: la quinta sigue siendo «Más», como hoy.
- Con `tabOf === 'mas'` y cuenta registrada no se marca ninguna pestaña del muelle: quien está marcado es el botón de la foto (`aria-current="page"`).
- Ruta `/gente`: componente `GenteIndex` que hace `<Navigate replace to={genteStart(useGentePending())} />`. Sin cuenta registrada, a `/mas`.
- Carril de escritorio: `Inicio, Salidas, Rutas, Plan`; grupo «Gente» con `Chats, Amigos, Retos, Ciclistas` y la insignia de cada uno; «Tú» abajo, a `/perfil`. «Más» solo en modo local.
- `AppBar`: fuera `ChatButton`. El botón de la foto se queda solo.

- [ ] Pruebas de `tabOf`, `screenName`, muelle con y sin cuenta, insignia y carril; fallan.
- [ ] Implementar; pasan `npx vitest run tests/shell.test.tsx tests/chatUnread.test.tsx` y `npx tsc --noEmit`.

### Tarea 3: navegación segmentada de «Gente»

**Ficheros:** crear `src/ui/gente/GenteNav.tsx` y `src/ui/styles/gente.css`; modificar `src/ui/pages/Chats.tsx`, `Amigos.tsx`, `CommunityRetos.tsx`, `Ciclistas.tsx`, `Chat.tsx` (columna de la lista en escritorio). Pruebas: `tests/genteNav.test.tsx`.

```tsx
/** Cuatro enlaces: Chats, Amigos, Retos, Ciclistas. El de la pantalla actual lleva aria-current="page". */
export function GenteNav(): JSX.Element;   // <nav aria-label="Gente">; lee los contadores de useGentePending()
```

- Las cuatro pantallas son raíz (`Page` sin `back`), con título «Gente» y `GenteNav` debajo. El título del documento sigue nombrando la parte («Chat», «Amigos», «Retos», «Ciclistas»).
- Contador rojo junto al rótulo de Chats, Amigos y Retos cuando es mayor que cero, con texto para lector de pantalla («Chats, 2 pendientes»).
- Desde 900 px `GenteNav` no se pinta: el carril ya lleva las cuatro entradas.
- A 360 px los cuatro rótulos caben en una línea con sus contadores; cada enlace mide 44 px de alto.
- «Nuevo chat» sigue en las acciones de `Chats`.

- [ ] Pruebas: los cuatro enlaces y sus destinos, `aria-current` según la ruta, contadores, nada con cuenta anónima.
- [ ] Implementar; `e2e/comunidad-nav.spec.ts` actualizado pasa a 360, 390 y 430 px.

### Tarea 4: «Tú» en lugar de «Más»

**Ficheros:** `src/ui/pages/Perfil.tsx`, `src/ui/pages/Mas.tsx`, `src/App.tsx`, `src/ui/shell/OwnProfileButton.tsx`, `src/ui/styles/profile.css` o `mas.css`. Pruebas: `tests/perfil.test.tsx`, `tests/mas.test.tsx`, `e2e/perfil.spec.ts`.

- `Perfil` (título «Tú») pinta arriba, antes de la ficha, una lista con: «Importar salidas» (meta: última importación), «Ajustes» («Zona, punto de salida y tema»), «Copia de seguridad» (con el aviso de cambios sin copiar que hoy enseña «Más») y «Privacidad». Los datos salen de donde los saca `Mas`; extraer a un componente compartido `src/ui/perfil/DatosYAjustes.tsx` si evita duplicar.
- La tarjeta «Empieza por tu archivo de Strava» de una cuenta sin salidas pasa también a `Perfil`.
- El enlace de `Perfil` a `/mas` desaparece. El botón de tema de «Más» no se traslada: el tema está en Ajustes.
- Con cuenta registrada, `/mas` redirige a `/perfil`. En modo local `Mas` sigue igual, sin las filas de comunidad.
- El botón de la foto: `aria-label` «Tú: perfil y ajustes».

- [ ] Pruebas: las cuatro filas y sus destinos, aviso de copia, redirección de `/mas` con cuenta, `Mas` intacta en modo local.
- [ ] Implementar; pasan las pruebas, `npx tsc --noEmit` y `e2e/perfil.spec.ts`.

### Tarea 5: verificación del lote 1

- [ ] `npx vitest run` completo, `npx tsc --noEmit`, `npm run build`.
- [ ] Playwright, solo las specs tocadas más `e2e/chat.spec.ts` y `e2e/navegacion-teclado.spec.ts`, con `--workers=2`. Capturas a 360, 390, 430 y 1440 px miradas una a una contra la lámina.
- [ ] Anotar el resultado en `docs/ESTADO.md` y proponer el commit al usuario.

---

## Lote 2. Inicio: «Hoy» y «Tu gente»

### Tarea 6: lo pendiente, como lista

**Ficheros:** crear `src/social/pending.ts`. Pruebas: `tests/pending.test.ts`.

```ts
export type PendingItem = {
  kind: 'chat' | 'challenge' | 'friend';
  id: string;            // conversación, reto o amistad
  personId: string | null;
  name: string;          // quién
  text: string;          // «¿Quedamos a las 8:15 mejor?», «Te reta: más kilómetros esta semana», «Quiere ser tu amigo»
  at: string | null;     // ISO, para ordenar y para la hora
  unread: number;        // solo chats
  to: string;            // #/chat/<id>, #/retos/comunidad/<id>, #/perfil/amigos
};
/** De más reciente a más antiguo; lo que no tiene fecha, al final. */
export function pendingItems(conversations: Conversation[], challenges: CommunityChallenge[], friends: FriendRow[], myId: string, now: number): PendingItem[];
```

- Chats: `visibleConversations` con `unread > 0`; el texto es `previewLine`. Retos: los que cuenta `pendingChallenges`. Amigos: solicitudes recibidas pendientes.

- [ ] Pruebas con las tres fuentes mezcladas, orden, vacío y un chat con el último mensaje borrado.

### Tarea 7: Inicio recompuesto

**Ficheros:** `src/ui/pages/Inicio.tsx`, `src/ui/inicio/Hero.tsx`, crear `src/ui/inicio/TuGente.tsx`, `src/ui/styles/inicio.css`. Pruebas: `tests/inicio.test.tsx`, `tests/tuGente.test.tsx`, `e2e/inicio.spec.ts`.

- En el móvil el saludo con su escena baja a unos 247 px a 390 de ancho (hoy, 367): mismo contenido, menos aire. En escritorio no cambia.
- Orden: saludo, «Hoy» (`NextWorkout`, que sube aquí con su acceso «Ruta y GPX»), «Tu gente», semana, y después lo de hoy sin cambios (última salida, objetivo, tendencia, carga, tus datos).
- `TuGente`: hasta 3 `PendingItem` y «Ver todo» a `/gente`. Sin pendientes, una fila «Tu gente · Todo al día» a `/gente`. Mientras carga no ocupa sitio; si falla, tampoco. Solo con cuenta registrada.
- Otra sesión explora la escena del saludo (`docs/design/2026-11-19-carretera` y `-relieve`): antes de tocar `Hero.tsx` e `inicio.css`, `git status` y `git diff`.

- [ ] Pruebas: orden de los bloques, las dos variantes de «Tu gente», nada en modo local.
- [ ] Capturas a 360, 390 y 430 px: en 390 × 844 se ven saludo, «Hoy», «Tu gente» y el arranque de la semana.

### Tarea 8: verificación del lote 2

- [ ] Igual que la tarea 5, con `e2e/inicio.spec.ts`.

---

## Lote 3. Dentro de «Gente», según la lámina

### Tarea 9: Amigos, Retos y Ciclistas

**Ficheros:** `src/ui/pages/Amigos.tsx`, `Persona.tsx`, `CommunityRetos.tsx`, `Ciclistas.tsx` y sus estilos y pruebas.

- Amigos: solicitudes recibidas arriba; cada amigo lleva «Escribir» y «Retar» en su renglón. «Quitar» pasa a su perfil (`Persona`), con la misma confirmación.
- Retos: sus tres vistas pasan a filtros pequeños bajo «¿A quién retas?», para que no haya dos controles segmentados iguales uno encima de otro.
- Ciclistas: pierde su filtro «Amigos».

- [ ] Pruebas de cada cambio y capturas a 360 y 390 px contra los marcos D, E y F.

### Tarea 10: verificación final y revisión con el usuario

- [ ] Suite de vitest, tipos, build y las specs tocadas. Playwright completo, solo si el usuario lo pide.
- [ ] `docs/ESTADO.md`, propuesta de commit y prueba en su teléfono.

## Dependencias

| Tarea | Necesita |
|---|---|
| 2 | 1 |
| 3 | 1 y 2 |
| 4 | 2 |
| 7 | 1, 3 y 6 |
| 9 | 3 |
