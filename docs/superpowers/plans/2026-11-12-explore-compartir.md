# Fase D (parte 1): Explore de Ride with GPS, Compartir y pegar enlaces. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el usuario busque a mano en Ride with GPS Explore, mande la ruta a FBikeTrain con «Compartir» o pegando el enlace, y la app la adapte para salir y volver a su inicio.

**Architecture:** una función pura construye la URL de Explore con los filtros puestos; la PWA recibe `title`/`text`/`url` en el `share_target` y su service worker redirige a `#/rutas/compartida?enlaces=…`; la pantalla nueva lee las rutas por id con la función `rwgps` que ya existe y las adapta con `adaptCandidates` (modo `mi-inicio`, espera por el límite por minuto de ORS).

**Tech Stack:** Vite + React + TypeScript, vitest, Playwright, service worker propio (`public/sw.js`).

**Spec:** `docs/ESTADO.md`, «Retomar aquí (2026-11-12, noche)», decisiones 4, 7 (fase D) y 8.

## Global Constraints

- La app nunca llama a ridewithgps.com: Explore solo se abre en una pestaña del usuario, en el mismo gesto (`window.open(url, '_blank', 'noopener,noreferrer')`). Nada de scraping ni de automatizar Explore.
- Lecturas por id solo por la Edge Function `rwgps` (`fetchRwgpsRoute`, `fetchRwgpsCollection`), con su cuota de 300 lecturas al día por persona.
- La IA no interviene. No se tocan `src/ui/pages/Catalogo.tsx`, `src/routes/nearby.ts`, `waypointEngine.ts`, `diversity.ts` ni `src/ai/*`.
- Mobile-first: validado a 360 y 430 px, sin scroll horizontal y con botones de 44 px o más.
- Textos en castellano. Fixtures sintéticos.

## Formato de la URL de Explore (supuesto documentado)

Ride with GPS no documenta los parámetros de `/explore`, y la web contesta 418 a peticiones automáticas. El formato sale de su propio código cliente (`exploreQuerySlice-*.js`, publicado en `cdn.ridewithgps.com/rwgps-javascripts/prod/assets/`, leído una vez el 2026-11-12 a partir de la página de Explore archivada en la Wayback Machine del 2026-11-02). Las funciones `parseParams`/`formatState` admiten estas claves: `q, b, p, length, ele, s, m, g, c, r, o, i, u, a`.

| Clave | Formato | Uso aquí |
|---|---|---|
| `b` | `p!{lng}!{lat}~{radio}km` (punto con radio) | inicio redondeado a 0,01° (~1 km, como `nearby`) y radio de 15 km (el radio por defecto de RWGPS en km) |
| `length` | `{min}*{max}km`, enteros | km pedidos −10 % (hacia abajo) y +10 % (hacia arriba) |
| `ele` | `{min}*{max}m` (RWGPS lo redondea a 100) | solo si se pide desnivel: ±25 %, redondeado a 100 m, mínimo 100 |
| `s` | tipos de firme separados por `!` (`paved`, `mostly_paved`…) | `paved` |
| `m` | `routes` y/o `rides` | `routes` |
| `a` | tipos de actividad separados por `!` (`cycling:road`…) | `cycling:road` |

Si Ride with GPS cambia el formato, Explore ignora la clave y se abre igual con lo demás: el riesgo es perder un filtro, no romper el flujo.

Ejemplo (60 km, 800 m, inicio 41,63 / 2,16): `https://ridewithgps.com/explore?b=p!2.16!41.63~15km&length=54*66km&ele=600*1000m&s=paved&m=routes&a=cycling%3Aroad`

## Review Focus

1. Compartir un texto sin enlace de Ride with GPS y sin ficheros: sigue llevando a `#/compartido?error=empty`, como hoy.
2. Compartir ficheros y un enlace a la vez: los ficheros siguen su camino (`#/compartido?envio=…`).
3. Enlace de ruta privada: mensaje claro y el resto de la pantalla sigue usable.
4. Límite por minuto de ORS: cuenta atrás visible y «Cancelar» detiene la espera sin dejar la pantalla bloqueada.
5. Colección con muchas rutas: lista legible a 360 px sin scroll horizontal y una sola lectura (la de la colección) hasta que el usuario elige.

---

### Task 1: URL de Explore y adaptación de un enlace compartido (lógica pura)

**Files:**
- Create: `src/routes/sources/rwgpsExplore.ts`
- Modify: `src/routes/sources/rwgpsProposals.ts` (exportar `toReferenceRoute`, sin otro cambio)
- Test: `tests/rwgpsExplore.test.ts`

**Interfaces:**
- Consumes: `fetchRwgpsRoute`, `fetchRwgpsCollection`, `RwgpsAccess`, `RwgpsLink` (`rwgpsImport.ts`); `adaptCandidates`, `RecommendDeps`, `RecommendTarget`, `Proposal` (`catalog/recommend.ts`); `toReferenceRoute` (`rwgpsProposals.ts`).
- Produces:
  - `RWGPS_EXPLORE_URL = 'https://ridewithgps.com/explore'`
  - `rwgpsExploreUrl(ask: { start: LatLng; distanceKm: number; elevGainM: number | null }): string`
  - `type RwgpsChoice = { id: string; label: string }`
  - `listRwgpsChoices(links: RwgpsLink[], access: RwgpsAccess, signal?: AbortSignal): Promise<{ choices: RwgpsChoice[]; failed: string[] }>` — rutas tal cual («Ruta {id}»); cada colección se lee una vez y sus rutas salen como «{nombre} · {n} de {total}». Sin duplicados. Un error no fatal de colección va a `failed`; uno fatal se lanza.
  - `adaptRwgpsChoice(choice: RwgpsChoice, target: RecommendTarget, deps: RecommendDeps & { rwgps: RwgpsAccess }): Promise<{ proposal: Proposal } | { rejected: string }>` — una sola candidata por `adaptCandidates` (`want: 1, maxAttempts: 1`): hereda la espera de 60 s por `rate_minute` (avisa con `{ kind: 'waiting', seconds: 60 }`) y lanza sesión, cuota y cancelación.

- [ ] **Step 1: pruebas que fallan** — `rwgpsExploreUrl` da exactamente el ejemplo de arriba; sin desnivel no lleva `ele`; redondea el inicio a 0,01°; `listRwgpsChoices` expande una colección (fetch simulado con la forma real `{ data: { collection: { name, routes: [{id}] } } }`) y quita duplicados; colección privada (403 `not_visible`) va a `failed`; `adaptRwgpsChoice` devuelve la propuesta (adapt simulado), devuelve `rejected` con el mensaje de privada, espera 60 000 ms y reintenta tras `OrsError('rate_minute')`, y lanza `RwgpsError` fatal sin sesión.
- [ ] **Step 2:** `npx vitest run tests/rwgpsExplore.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run tests/rwgpsExplore.test.ts tests/rwgpsProposals.test.ts` → PASS.

### Task 2: share_target con `title`, `text` y `url`

**Files:**
- Modify: `public/manifest.webmanifest` (`params.title`, `params.text`, `params.url`, sin tocar `files`)
- Modify: `public/sw.js`
- Modify: `docs/pwa-compartir.md` (una línea)
- Test: `e2e/compartida.spec.ts` (envío real de un formulario multipart al `share-target` con el SW activo)

El SW, sin ficheros: busca en `url`, `text` y `title` enlaces `https://(www.)ridewithgps.com/(routes|collections)/{id}…` (20 como mucho) y redirige con 303 a `#/rutas/compartida?enlaces={enlaces unidos por \n}`. Sin ficheros ni enlaces: `#/compartido?error=empty`, como hoy. Con ficheros: igual que hoy.

- [ ] **Step 1:** prueba e2e: con el SW controlando la página, enviar un `<form method=post enctype=multipart/form-data action=share-target>` con `text="Mira esta ruta https://ridewithgps.com/routes/501 en Ride with GPS"` → la URL acaba en `#/rutas/compartida?enlaces=…501` y el campo de enlaces lo muestra. Otro envío solo con texto sin enlace → `#/compartido?error=empty`.
- [ ] **Step 2:** FAIL (redirige a `error=empty`).
- [ ] **Step 3:** implementar manifest y SW.
- [ ] **Step 4:** PASS (junto con Task 3).

### Task 3: pantalla `#/rutas/compartida` y entrada en Rutas

**Files:**
- Create: `src/ui/pages/RutaCompartida.tsx`, `src/ui/styles/compartida.css` (si hace falta)
- Modify: `src/App.tsx` (ruta `/rutas/compartida`), `src/ui/pages/Rutas.tsx` (una `ListRow` más tras las existentes)
- Test: `e2e/compartida.spec.ts`

Contenido, de arriba abajo: km (obligatorio) y desnivel opcional, `StartChoice`; tarjeta «Buscar en Ride with GPS Explore» (abre `rwgpsExploreUrl`); campo «Enlaces de Ride with GPS» (rellenado con `?enlaces=`, con aviso «Recibido desde Compartir»); botón «Adaptar». Una ruta sola se adapta directamente; varias rutas o una colección dan una lista con un botón «Adaptar» por ruta y «Ver en Ride with GPS» (enlace). Durante la espera por ORS: «El motor de rutas admite pocas consultas por minuto. Sigo en N s…» con «Cancelar». Resultado con `ProposalCard`. Errores: los mensajes de `RwgpsError`/`OrsError`, el motivo de rechazo, «Pega un enlace de una ruta o colección de Ride with GPS.», sin sesión («Inicia sesión…») y sin clave de ORS (como el catálogo).

- [ ] **Step 1:** spec e2e a 360 y 430 px (PLAYWRIGHT_PORT=4517, función `rwgps` simulada, ridewithgps.com bloqueado y comprobado sin llamadas): ruta compartida → adaptar → tarjeta con «Guardar en la biblioteca»; colección → lista → elegir una → tarjeta; ruta privada → mensaje; ORS 429 → cuenta atrás y «Cancelar»; Explore abre la URL esperada (popup interceptado); sin scroll horizontal; botones ≥ 44 px; capturas en `test-results/compartida/`. Fila «Ruta de Ride with GPS Explore» en `#/rutas`.
- [ ] **Step 2:** FAIL (ruta no existe).
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `PLAYWRIGHT_PORT=4517 npx playwright test e2e/compartida.spec.ts` → PASS; `npx tsc --noEmit`; `npx vitest run tests/rutas.test.tsx`.

### Verificación final

`npx tsc --noEmit`, `npx vitest run`, `npm run build`, la spec nueva y `e2e/compartido.spec.ts` (el SW cambia). Sin commit: el usuario lo confirma.

**Pendiente del usuario:** con la PWA instalada en su Android, «Compartir → FBikeTrain» desde la app y desde la web de Ride with GPS; anotar en `docs/verificaciones.md` qué llega en `url`/`text` (por si la app usa enlaces cortos que no son `ridewithgps.com/routes/…`).
