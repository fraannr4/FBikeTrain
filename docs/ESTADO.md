# Estado del proyecto FBikeTrain

Última actualización: 2026-11-09. Próxima sesión: viernes 2026-11-13.

## Resumen

La app está terminada, verificada y publicada (2026-11-09).

- Repositorio público: https://github.com/fraannr4/FBikeTrain (rama `main`, autor de los commits `fraannr4@users.noreply.github.com`).
- App en GitHub Pages: https://fraannr4.github.io/FBikeTrain/
- Cada push a `main` ejecuta los tests, genera el build y despliega (`.github/workflows/deploy.yml`).
- Cada commit sigue necesitando el OK explícito del usuario.
- 2026-11-09: el primer despliegue falló en CI por un test del calendario. Un foco diferido al título del día robaba el foco del formulario mientras se escribía. Corregido en `src/ui/pages/Calendario.tsx`.

## Verificación final (2026-11-07)

| Comprobación | Resultado |
|---|---|
| `npx vitest run` | 76 ficheros, 932 tests en verde |
| `npx tsc --noEmit` | sin errores |
| `npm run build` | correcto (aviso de chunk > 500 kB, ver limitaciones) |
| `npx playwright test` | 47 en verde (móvil 390x844, break-ui, 5.000 salidas < 3 s, privacidad IA, GPX) |
| ZIP real de Strava a 390 px | 7 salidas importadas, 1 descartada por corta, 39 no ciclistas; 0 errores de consola, 0 desbordamientos, ningún NaN |
| Revisión final de código | sin críticos; el único medio (cancelar IA no abortaba peticiones) está corregido |
| Barrido de secretos y datos reales | limpio; solo fixtures sintéticos en `tests/fixtures` |

## Qué está hecho

### Funcionalidad (fases F1 a F5)

- **F1, importación y panel.**
  - Lee el ZIP «Descargar tu cuenta» de Strava: CSV con cabeceras en castellano y ficheros FIT, GPX y TCX, incluidos los comprimidos.
  - Trabaja en un Web Worker y guarda en Dexie/IndexedDB.
  - Descarta duplicados, actividades no ciclistas, salidas basura y picos de velocidad del GPS.
  - Regla `isTooShort` en `src/import/summary.ts`: una salida es demasiado corta si tiene menos de 60 s en movimiento, o menos de 200 m y menos de 10 min. Así se conservan las sesiones de rodillo.
- **F2, historial.** Lista con búsqueda, orden y filtros en una hoja inferior, guardados en la URL. Detalle de cada salida con mapa CyclOSM y perfil. Subidas con pasadas, VAM y dificultad. Repetidas.
- **F3, plan.** Calendario de entrenos y objetivos de volumen y de evento. La copia de seguridad incluye calendario y objetivos.
- **F4, rutas.**
  - Rutas circulares con OpenRouteService (`cycling-road`, filtros de asfalto y tipo de vía).
  - Puntuación frente al historial del usuario.
  - Exportación GPX 1.1 para el iGPSPORT BSC200S.
- **F5, rutas con IA.**
  - Preguntas guiadas a un modelo compatible con OpenAI, Groq por defecto, con validación zod.
  - La IA recibe solo cifras resumidas, nunca tracks ni «Casa». Lo cubre el test e2e `e2e/rutas-ia.spec.ts`.
  - Cancelar aborta las peticiones a ORS y a la IA (`src/ai/abort.ts`).

### Diseño, mobile-first

- Identidad «Relieve grabado», de montaña. Tema oscuro por defecto y claro completo. Tokens en `src/ui/styles/tokens.css`.
- La referencia de interfaz es el prototipo móvil `docs/design/prototipo-movil/`, que manda sobre `prototipo-final` y sobre los detalles de UI de los planes.
- Navegación con 5 pestañas abajo: Inicio, Historial, Rutas, Plan y Más.
  - Historial tiene un segmentado Salidas / Subidas / Repetidas.
  - Plan tiene un segmentado Calendario / Objetivos.
- Kit propio en `src/ui/components/`: Sheet (hoja inferior), SegmentedControl, Stepper, Toast, StateView, Skeleton, etc. Gráficas SVG en `src/ui/charts/`.
- Zonas táctiles de 44 px o más. Las pestañas miden 48 px.
- Al volver atrás se conservan el desplazamiento, los filtros y las filas cargadas en Inicio, Historial y Subidas.
- Cada pantalla pasó 2 rondas de auditoría con capturas a 360x780, 390x844, 412x915 y 430x932, en apaisado y en los dos temas.

### Extras fuera del plan

- Datos de ejemplo (`src/demo/demoData.ts`). «Ver con datos de ejemplo» está en Inicio vacío y «Quitar datos de ejemplo» en Más. Al quitarlos solo se borran las filas `demo-`.
- Contador de uso de ORS y de IA.
- Aviso de Plan en la pestaña.

### Rutas de la app (HashRouter)

`/`, `/historial`, `/historial/:id`, `/historial/subidas`, `/historial/repetidas`, `/rutas`, `/rutas/ia`, `/plan`, `/plan/objetivos`, `/mas`, `/importar`, `/ajustes`.

## Pendiente

### 1. Publicar: HECHO el 2026-11-09 (se conserva para referencia)

1. El usuario ejecuta `! gh auth login`.
2. Hecho el 2026-11-09: `git init -b main` y `.gitignore` ampliado.
   - Se excluyen `.playwright-mcp`, `tsconfig.tsbuildinfo` y `.impeccable/hook.cache.json`.
   - Se excluye `docs/design/prototipo-movil/capturas/`: 5.299 PNG, unos 940 MB, que se regeneran con `shots.mjs`.
   - Entrarían 467 ficheros, unos 32 MB.
   - Aún no hay ningún commit.
   - `gh` no tiene sesión iniciada.
3. Revisar `git status` antes del primer commit: ningún dato real, ninguna clave, nada de `test-results/` ni `.playwright-mcp/`.
4. Crear el repositorio público `FBikeTrain` con `gh repo create`. Activar GitHub Pages con origen GitHub Actions; el workflow `.github/workflows/deploy.yml` ya existe y usa `BASE_PATH`.
5. Enseñar el commit propuesto y esperar el OK. Mensaje propuesto:

```
Initial release of FBikeTrain: Strava import, progress, routes and AI planner

Static Vite + React + TypeScript app for GitHub Pages, mobile-first.
- Import: Strava account ZIP (CSV + FIT/GPX/TCX), de-duplication and junk/spike filters.
- Inicio, Historial (rides, climbs, repeated routes), Plan (calendar, goals), Más.
- Routes: OpenRouteService round trips scored against history, GPX export for iGPSPORT.
- AI routes (Groq, OpenAI-compatible): summarised figures only, no tracks or home address.
- Mobile-first design system with dark/light themes and demo data.
- 932 unit tests, 47 Playwright e2e tests; synthetic fixtures only.
```

6. Tras desplegar, abrir la URL de Pages en el móvil y comprobar que carga con la base `/FBikeTrain/`.

### 2. Comprobaciones del usuario

- Conseguir las claves de OpenRouteService y Groq, meterlas en Ajustes y probar una ruta real y una ruta con IA. Sin claves, Rutas y Rutas con IA solo muestran la pantalla que pide la clave.
- Comparar un mes real con Strava (distancia, desnivel, tiempo) y anotar el resultado en `docs/verificaciones.md`.
- Confirmar si la salida descartada por corta del ZIP real es basura de verdad.

### 3. Mejoras opcionales (no bloquean)

- Dividir el bundle con `import()` por pantalla. Ahora el JS principal pesa 795 kB (250 kB comprimido) y el worker 785 kB.
- Leer el ZIP de Strava en streaming. JSZip lo carga entero en memoria.
- Que los saltos del GPS no sumen metros a la distancia total. Ahora solo se filtran en la velocidad máxima.
- Añadir los nombres en castellano que falten en `CYCLING_TYPES`, cuando aparezcan en un export: bicicleta virtual, eléctrica, gravel y montaña.
- Reducir los avisos de la región viva durante la importación.
- Añadir una prueba e2e de la copia de seguridad (F3 tarea 7) y una prueba de interfaz de que Cancelar en Rutas con IA aborta.
- Unificar en un helper la restauración del desplazamiento de Inicio, Historial y Subidas.
- Las fuentes emiten `.woff` además de `.woff2`.

## Límites conocidos

- El BSC200S no se detecta por USB. Se probó con el dock, con un puerto directo y con 2 cables. El GPX se pasa con la app de iGPSPORT.
- No se usan la API ni el MCP de Strava: piden suscripción.

## Datos útiles

- ZIP real: `C:\Users\Fran.Romano\Downloads\export_180782712.zip`. Nunca va al repositorio.
- Servidor de desarrollo para el móvil: `npx vite --host 0.0.0.0 --port 5173 --strictPort`, en http://192.168.1.141:5173.
- Playwright usa el puerto 4173 con reutilización; ese puerto debe quedar libre.
- El prototipo móvil se sirve sin caché con `node docs/design/prototipo-movil/servir.mjs` en el puerto 5174. Después de tocar su CSS o su JS hay que ejecutar `version.mjs`.
- Presupuesto: el usuario pide no pasar de un 60 % del límite semanal de tokens. Se usan agentes Sonnet, la verificación la hace la sesión principal con comandos y no se lanzan workflows grandes.
