# Plataforma de ciclismo personal

Web estática en Vite + React + TypeScript, publicada en GitHub Pages y sin servidor:
- lee las salidas exportadas de Strava;
- muestra la progresión de cada usuario medida contra su propio nivel;
- genera rutas de bici de carretera en GPX para el iGPSPORT BSC200S.

## Documentos de referencia

- Especificación: `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md`
- Propuesta y maquetas: `docs/propuesta-ciclismo.html`, y la referencia de interfaz en `docs/referencia-ui.png`
- Planes, uno por fase: `docs/superpowers/plans/`
- Comprobaciones con datos reales: `docs/verificaciones.md`
- **Estado actual y pendientes: `docs/ESTADO.md`. Léelo primero al retomar.**
- Planes del 2026-11-10: `docs/superpowers/plans/2026-11-10-ia-empalmes-objetivo-biblioteca.md`, `2026-11-10-zona-buscador-amigos.md` y `2026-11-10-retos.md`; solicitud Garmin Starter en `docs/garmin-solicitud-starter.md`.
- **Últimas decisiones aprobadas (2026-11-09):** login B Cartografía con animación sutil, ciclista tras login y en cargas, IA compartida a coste cero y búsqueda/composición de rutas externas. Brief y lámina: `docs/design/2026-11-09-acceso-ciclista-ia.md` y `docs/design/2026-11-09-opciones-login.png` (columna B). Plan de continuación: `docs/superpowers/plans/2026-11-09-login-cartografia-carga-rutas-ia.md`. La IA y ORS compartidos y las referencias de rutas ya están desplegados (2026-11-10); Wikiloc no ofrece API pública y su web está bloqueada por Cloudflare, así que no se automatiza.

## Reglas del proyecto

- **Marca aprobada (2026-11-09): B Trazado para toda la web.** Implementación SVG en `src/ui/shell/BrandMark.tsx`, favicon en `public/brand-mark.svg`. Mantener la forma compartida y adaptar colores a las superficies con los tokens de la app; el login B Cartografía no obliga a rediseñar la paleta global. Brief y variantes: `docs/design/2026-11-09-logo-propuestas.md`.

- Repositorio público en GitHub: ni claves, ni archivos de Strava, ni tracks reales en el repositorio. Los fixtures son sintéticos.
- Control de versiones: git con remoto en GitHub, porque GitHub Pages lo exige. Es una excepción a la norma de SVN. Cada commit necesita la confirmación explícita del usuario; los agentes nunca hacen commit.
- La API y el MCP de Strava no se usan: los dos exigen suscripción y el usuario no la tiene.
- **Mobile-first, con prioridad absoluta.** La app se usa sobre todo en el smartphone. Cualquier pantalla se diseña y se valida primero en el móvil, con capturas reales a 360-430 px. Requisito completo: `docs/requisito-mobile-first.md`.
- La IA solo interviene en las rutas. Le llegan cifras resumidas, nunca tracks GPS ni la dirección de «Casa».

## Flujo de trabajo por fase

1. **Decidir.** Si hay decisiones abiertas, usa la skill `grilling`; si la fase es nueva, `superpowers:brainstorming`.
2. **Planificar.** Escribe el plan de la fase con `superpowers:writing-plans` y guárdalo en `docs/superpowers/plans/`.
3. **Comprobar con el usuario.** Haz primero los pasos que solo puede hacer él (cuentas, claves, archivo real, dispositivo) y anota los resultados en `docs/verificaciones.md`.
4. **Ejecutar por lotes con el workflow `develop-phase`** (`.claude/workflows/develop-phase.js`). Para cada tarea:
   - un agente especialista la implementa con TDD;
   - dos revisores trabajan en paralelo: `cycling-reviewer` comprueba que cumple el plan y `feature-dev:code-reviewer` la calidad;
   - si hay problemas, se corrigen, con un máximo de 2 rondas;
   - `cycling-qa` la verifica.
   Al final del lote:
   - `code-simplifier` simplifica el código;
   - se hacen la verificación final y la revisión global;
   - se propone un mensaje de commit.
   El lote se detiene en la primera tarea bloqueada o que falle.
5. **Revisar el resultado** con el usuario: pendientes del usuario, problemas abiertos y propuesta de commit.
6. **Hacer commit** solo con la confirmación del usuario.
7. **Documentar la fase cerrada** con `/documentar-noted` en Noted, si el usuario lo pide, y anotar las horas con `facturar-horas`.

## Agentes especialistas (`.claude/agents/`)

| Agente | Sección |
|---|---|
| `cycling-data-engineer` | lectores FIT, GPX y TCX, archivo de Strava, importación, Dexie, Worker, copia de seguridad |
| `cycling-metrics-analyst` | totales, agregación, referencia de nivel, subidas, VAM, repetidas, etiquetas de dificultad, puntuación |
| `cycling-frontend-dev` | React, routing, ECharts, Leaflet con CyclOSM, pantallas, despliegue en Pages |
| `cycling-routes-engineer` | OpenRouteService, GPX, cliente de IA, prompts y zod, preguntas guiadas (F4 y F5) |
| `cycling-ui-designer` | rediseño visual con identidad propia (plan propio) |
| `cycling-qa` | pruebas, tipos, build, Playwright, break-ui, web-design-guidelines |
| `cycling-reviewer` | cumplimiento del plan y de la especificación (solo lee) |

## Lotes de F1 (plan `2026-11-06-f0-f1-base-importacion-panel.md`)

La tarea 1 es manual y se hace con el usuario. Pide el archivo de Strava el primer día, porque tarda horas en llegar.

**Lote A.** No depende del archivo de Strava:

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f0-f1-base-importacion-panel.md', ui: true, tasks: [
  { n: 2, agent: 'cycling-frontend-dev' }, { n: 3, agent: 'cycling-metrics-analyst' },
  { n: 4, agent: 'cycling-data-engineer' }, { n: 5, agent: 'cycling-data-engineer' },
  { n: 8, agent: 'cycling-metrics-analyst' } ] } })
```

**Lote B.** Necesita `docs/verificaciones.md` con las columnas reales del CSV:

```
Workflow({ name: 'develop-phase', args: { plan: 'docs/superpowers/plans/2026-11-06-f0-f1-base-importacion-panel.md', ui: true, tasks: [
  { n: 6, agent: 'cycling-data-engineer' }, { n: 7, agent: 'cycling-data-engineer' },
  { n: 9, agent: 'cycling-frontend-dev' }, { n: 10, agent: 'cycling-frontend-dev' },
  { n: 11, agent: 'cycling-data-engineer' }, { n: 12, agent: 'cycling-qa' } ] } })
```

## Comandos

- Pruebas: `npx vitest run`
- Tipos: `npx tsc --noEmit`
- Build: `npm run build`
- Extremo a extremo: `npx playwright test`
- Local: `npm run dev`, en http://localhost:5173
