# Zona del usuario, buscador de usuarios y página Amigos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tras iniciar sesión, el usuario indica su pueblo (zona aproximada) y eso fija «Casa» si no la tenía; cualquier usuario puede buscar a otros por nombre o cerca de su zona y gestionar amistades desde una página Amigos.

**Architecture:** Una migración añade al perfil la localidad y una celda aproximada (coordenadas redondeadas a 2 decimales, unos 1-5 km) más un interruptor de visibilidad, y tres RPC `security definer` para buscar por nombre, buscar cerca y listar amistades. Una pantalla «Tu zona» se muestra una vez tras el login; la búsqueda de pueblo usa Nominatim desde el navegador. La página Amigos usa solo las RPC y las de amistad ya existentes.

**Tech Stack:** Vite + React + TypeScript, Supabase (Postgres, RLS, RPC), Nominatim (OSM) para geocodificar, Vitest, Playwright, PGlite (`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md` y el plan `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md` (perfil y amistades). Decisiones del usuario del 2026-11-10:
- Después del login se pide la ubicación, «al menos el pueblo para no ser invasivo». Es importante que «Casa» quede configurada para Rutas con IA.
- Buscador por nombre de usuario y nombre visible, 3 letras como mínimo; cualquiera con cuenta puede aparecer. La zona solo se ve si el usuario la muestra.
- Búsqueda cerca: 25 o 50 km alrededor de la zona del propio usuario.

## Global Constraints

- «Casa» exacta nunca sale del móvil ni se muestra (`tests/ajustes.test.tsx:170`). Al servidor solo va la localidad y la celda redondeada a 2 decimales.
- Repositorio público: ninguna clave. Nominatim se usa sin clave, como mucho 1 petición por segundo, con `Referer` del navegador y sin autocompletar por tecla (espera de 400 ms y 3 letras mínimas).
- Mobile-first: capturas reales a 360-430 px de cada pantalla nueva, en claro y oscuro.
- Textos en castellano. RLS: nadie lee ni escribe perfiles ajenos fuera de las RPC.
- Verificación: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run test:db`, Playwright de las pantallas tocadas. Ningún agente hace commit.
- No tocar `src/ai/`, `src/routes/splice.ts`, `Empalmar.tsx`, `RutasIa.tsx`: los cambia otro lote.

## Review Focus

1. Nombre buscado con `%`, `_` o comillas: la RPC escapa el patrón y no devuelve todos los perfiles. Test SQL en la Task 1.
2. Usuario sin zona que pulsa «Cerca de mí»: mensaje «Indica tu zona en Ajustes para buscar cerca.» y ninguna llamada. Test en la Task 3.
3. Nominatim caído o sin resultados: la pantalla lo dice y deja «Ahora no»; nunca bloquea la app. Test en la Task 2.
4. Solicitud de amistad a uno mismo o duplicada: la RPC existente falla y la página muestra el error traducido, sin quedarse cargando. Test en la Task 3.
5. Perfil con `show_area = false`: no aparece en la búsqueda cercana y su localidad sale como `null` en la búsqueda por nombre. Test SQL en la Task 1.

---

### Task 1: Migración de zona y RPC de búsqueda y amistades

**Files:**
- Create: `supabase/migrations/202611100005_profile_area_search.sql`
- Create: `supabase/tests/profile_search.sql`
- Modify: `scripts/test-account-sql.mjs` (registrar la suite)
- Modify: `supabase/functions/ai-routes/README.md` solo si documenta el esquema de perfiles

**Interfaces:**
- Consumes: `public.profiles`, `public.friendships` y las RPC `request_friendship`, `accept_friendship`, `remove_friendship` de `202611090001_profiles_friendships.sql`.
- Produces:
  - Columnas en `profiles`: `locality text check (locality is null or char_length(locality) between 1 and 80)`, `area_lat double precision`, `area_lng double precision` con checks de rango y de redondeo (`area_lat = round(area_lat::numeric, 2)`), `show_area boolean not null default true`. La política `profiles_edit` permite actualizar también estas cuatro columnas, solo al dueño.
  - Tipo `public.profile_card as (id uuid, username text, display_name text, locality text, distance_km double precision)`.
  - `search_profiles(q text) returns setof profile_card`: requiere `auth.uid()`, `q` de 3 a 60 caracteres (si no, `raise exception 'Escribe al menos 3 letras'` con errcode `22023`), `ilike` sobre `username` y `display_name` con `%`, `_` y `\` escapados, excluye al propio usuario, `locality` solo si `show_area`, `distance_km` null, orden por `username`, límite 20.
  - `search_profiles_near(radius_km integer) returns setof profile_card`: `radius_km` en {25, 50}; usa la zona del llamante (si es null, `raise exception 'Sin zona configurada'` errcode `22023`); haversine sobre `area_lat/area_lng`; solo perfiles con `show_area` y zona; excluye al llamante; orden por distancia; límite 50.
  - `list_friends() returns table (friendship_id uuid, status text, direction text, profile profile_card)`: `direction` es `'sent'` si el llamante es `requester_id`, si no `'received'`; `locality` según `show_area` del otro.
  - Las tres funciones: `security definer`, `set search_path = ''`, `revoke all from public, anon`, `grant execute to authenticated`.

- [ ] **Step 1: Escribir `supabase/tests/profile_search.sql`** siguiendo el patrón de `supabase/tests/profiles_friendships.sql` (dos usuarios simulados con `set local role` y `request.jwt.claims`): zona a 10 km se encuentra con 25; a 40 km solo con 50; `show_area=false` no aparece y su `locality` es null por nombre; `search_profiles('a%')` no devuelve todo; `search_profiles('ab')` falla con «Escribe al menos 3 letras»; `list_friends` marca `sent`/`received`.
- [ ] **Step 2: Registrar la suite en `scripts/test-account-sql.mjs` y ejecutar `npm run test:db`; ver fallar**
- [ ] **Step 3: Escribir la migración** con las columnas, el tipo, las RPC y las políticas descritas.
- [ ] **Step 4: `npm run test:db` en verde (6 suites)**

---

### Task 2: Pantalla «Tu zona» tras el login y ajuste en Ajustes

**Files:**
- Create: `src/social/geocode.ts` (puro + fetch), `src/social/profileArea.ts`, `src/ui/pages/Zona.tsx`
- Modify: `src/auth/AccountBoundary.tsx` (mostrar Zona cuando el perfil no tiene `locality`), `src/App.tsx` (ruta `/zona`), `src/ui/pages/Ajustes.tsx` (sección «Tu zona»), `src/ui/shell/screens.ts`
- Modify: estilos en `src/ui/styles/account.css` o uno nuevo `src/ui/styles/social.css`
- Test: `tests/geocode.test.ts`, `tests/zona.test.tsx`, `tests/accountBoundary.test.tsx`, `tests/ajustes.test.tsx`, `e2e/zona.spec.ts`

**Interfaces:**
- Consumes: `useAccount()` de `src/auth/AccountBoundary.tsx`; `loadSettings`/`saveSettings` de `src/settings/settings.ts`; `Settings.home: LatLng | null`.
- Produces:
  - `export type Place = { name: string; lat: number; lng: number }`
  - `export async function searchPlaces(q: string, fetchImpl = fetch, signal?: AbortSignal): Promise<Place[]>` en `src/social/geocode.ts`: `GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=…`; `name` es `display_name` recortado a 80 caracteres; con menos de 3 letras devuelve `[]` sin llamar; errores de red lanzan `Error('No se ha podido buscar el pueblo.')`.
  - `export function areaCell(p: LatLng): { area_lat: number; area_lng: number }` en `src/social/profileArea.ts`: redondeo a 2 decimales.
  - `export async function saveArea(account: Account, place: Place): Promise<void>`: `update profiles set locality, area_lat, area_lng` del propio id; después, si `loadSettings().home === null`, `saveSettings({ ...settings, home: { lat, lng } })`.
  - `export function zonaSkippedRecently(now: number): boolean` con `localStorage['fbt-zona-skip']` (7 días).
  - `Zona.tsx`: campo «¿Desde qué pueblo sales a rodar?», resultados tras 400 ms y 3 letras, botón «Guardar» y «Ahora no». Texto de ayuda: «Solo guardamos el nombre del pueblo y una zona aproximada. Tu dirección exacta no sale del móvil.»
  - `AccountBoundary`: tras la bienvenida, si el perfil tiene `locality` null y no se saltó hace menos de 7 días, navega a `/zona`.
  - Ajustes, sección «Tu zona»: localidad actual, botón «Cambiar» (abre `/zona`), interruptor «Mostrar mi zona a otros usuarios» (`show_area`).

- [ ] **Step 1: `tests/geocode.test.ts`**: menos de 3 letras no llama; mapea `display_name`/`lat`/`lon` a `Place`; error de red da el mensaje. Ver fallar, implementar, ver pasar.
- [ ] **Step 2: `tests/zona.test.tsx`**: con cliente falso (`from('profiles').update(...).eq(...)`), elegir un resultado guarda localidad y celda redondeada; con `home` ya fijada no la cambia; con `home` null la fija; «Ahora no» escribe la marca y navega a `/`; Nominatim caído muestra el aviso y deja «Ahora no». Ver fallar, implementar `Zona.tsx` y `profileArea.ts`, ver pasar.
- [ ] **Step 3: `tests/accountBoundary.test.tsx`**: perfil sin `locality` lleva a `/zona` una vez; con marca reciente no. Ver fallar, implementar, ver pasar.
- [ ] **Step 4: `tests/ajustes.test.tsx`**: la sección muestra la localidad y el interruptor actualiza `show_area`; sigue sin mostrarse «Casa». Ver fallar, implementar, ver pasar.
- [ ] **Step 5: `e2e/zona.spec.ts`** a 390x844: Nominatim y Supabase simulados con `page.route`; flujo completo y capturas a 360 y 430 en claro y oscuro.
- [ ] **Step 6: `npx vitest run`, `npx tsc --noEmit`, `npm run build`**

---

### Task 3: Página Amigos con buscador y solicitudes

**Files:**
- Create: `src/social/friends.ts` (llamadas RPC tipadas), `src/ui/pages/Amigos.tsx`
- Modify: `src/App.tsx` (ruta `/amigos`), `src/ui/pages/Mas.tsx` (fila «Amigos», solo con cuenta), `src/ui/shell/screens.ts` (`tabOf`, `NAMES`), estilos
- Test: `tests/friends.test.ts`, `tests/amigos.test.tsx`, `e2e/amigos.spec.ts`

**Interfaces:**
- Consumes: RPC de la Task 1 y `request_friendship`, `accept_friendship`, `remove_friendship`; `useAccount()`.
- Produces:
  - `export type ProfileCard = { id: string; username: string; display_name: string; locality: string | null; distance_km: number | null }`
  - `export type FriendRow = { friendship_id: string; status: 'pending' | 'accepted'; direction: 'sent' | 'received'; profile: ProfileCard }`
  - En `src/social/friends.ts`: `searchProfiles(client, q)`, `searchProfilesNear(client, radiusKm: 25 | 50)`, `listFriends(client)`, `requestFriendship(client, targetId)`, `acceptFriendship(client, friendshipId)`, `removeFriendship(client, friendshipId)`; cada una traduce `error.message` a castellano con una tabla corta (`'Sin zona configurada'` → «Indica tu zona en Ajustes para buscar cerca.»).
  - `Amigos.tsx`: pestañas «Buscar» y «Amigos». Buscar: campo de texto (3 letras, botón «Buscar») y botones «Cerca de mí: 25 km / 50 km»; cada resultado con nombre, @usuario, localidad si existe, distancia si existe y botón «Solicitar amistad» (o estado «Pendiente»/«Amigos»). Amigos: solicitudes recibidas (botón «Aceptar» y «Rechazar»), enviadas («Cancelar») y amigos aceptados («Quitar»). Estado vacío: «Todavía no tienes amigos. Busca a alguien por su nombre o cerca de ti.»

- [ ] **Step 1: `tests/friends.test.ts`**: cada función llama `client.rpc` con el nombre y los parámetros exactos; traduce los errores conocidos. Ver fallar, implementar, ver pasar.
- [ ] **Step 2: `tests/amigos.test.tsx`** con `client.rpc` falso: búsqueda con 2 letras no llama y muestra el aviso; resultados y botón de solicitud; «Cerca de mí» sin zona muestra el mensaje; aceptar y quitar refrescan la lista; error duplicado se muestra sin bloquear. Ver fallar, implementar, ver pasar.
- [ ] **Step 3: Navegación**: fila en Más, ruta y `screens.ts`. Test en `tests/amigos.test.tsx` o el existente de Más.
- [ ] **Step 4: `e2e/amigos.spec.ts`** a 390x844 con `page.route` sobre `**/rest/v1/rpc/*`; capturas a 360 y 430, claro y oscuro, con nombres largos y 0 resultados.
- [ ] **Step 5: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run test:db`**

---

## Comprobaciones del usuario (anotar en `docs/verificaciones.md`)

1. Claude aplica la migración `202611100005` en remoto tras el lote.
2. Con dos cuentas reales: fijar la zona en cada una, buscar por nombre y cerca, enviar y aceptar una solicitud.
