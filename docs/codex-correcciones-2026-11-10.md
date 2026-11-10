# Correcciones pedidas a Codex (2026-11-10)

Resultado de la revisión de las dos ramas de Codex, hecha con agentes de solo lectura. Un prompt por rama, listo para pegar en Codex. Cuando Codex haga commit en cada rama: rebase sobre `main`, revisión rápida del diff, fusión, CI y push.

## Rama `codex/pwa-compartir` (worktree `C:\testTrain-codex`)

Veredicto: mergeable con correcciones menores. Manifest conforme a la especificación de Web Share Target, service worker con 303 a `#/compartido?envio=<uuid>`, `skipWaiting` y `clients.claim`, sin caché de GET. Reutiliza el importador existente.

```
Rama codex/pwa-compartir (C:\testTrain-codex). Revisión hecha; corrige esto y haz commit en la rama:

1. git rebase sobre main: en main ya no existe el acceso con Google. Quita toda mención a Google en AuthScreen.tsx, en el comentario de src/auth/AccountBoundary.tsx:27 y en docs/pwa-compartir.md. En docs/ESTADO.md conserva la versión de main y añade solo una línea en la sección de Codex con el estado de la PWA; no reescribas secciones.
2. public/manifest.webmanifest: "id": "./" se resuelve contra el origen, no contra /FBikeTrain/; ponlo relativo a la base (por ejemplo "/FBikeTrain/" o el valor de start_url). En share_target.params.files.accept añade "text/xml" y "application/xml" además de los que hay.
3. Añade un icono maskable (192 y 512, con margen seguro) y decláralo con "purpose": "maskable" en entradas separadas.
4. src/pwa/sharedFiles.ts: readSharedFiles borra el envío al leerlo. Bórralo solo cuando la importación haya terminado (correcta o con duplicados); si el usuario recarga antes de importar, los ficheros deben seguir ahí.
5. src/auth/AccountBoundary.tsx: la restauración del hash del envío tras el login debe tener prioridad sobre cualquier redirección posterior al login (pronto habrá una a #/zona). Deja un comentario y un test que lo asegure.
6. Tests que faltan: SW con base /FBikeTrain/ (la URL del 303), los errores ?error=size|empty|storage en Compartido.tsx, datos extremos (break-ui: 0 ficheros, 20 ficheros, nombre de 120 caracteres, fichero vacío) y reintento tras un fallo parcial.
7. Al terminar: npx vitest run, npx tsc --noEmit, npm run build y npx playwright test e2e/compartido.spec.ts con PLAYWRIGHT_PORT=4176 (el 4173 lo reutiliza Playwright de main). Cierra tus vite preview y dev cuando acabes.
```

## Rama `codex/escritorio` (worktree `C:\testTrain-codex-escritorio`)

Veredicto: mergeable con correcciones. El móvil queda intacto (todo bajo `min-width: 1024px`, JSX solo con `useDesktopLayout`), pero hay tres regresiones en PC. `escritorio.local/` está ignorado por git y no debe ir al repositorio.

```
Rama codex/escritorio (C:\testTrain-codex-escritorio). Revisión hecha; el móvil queda intacto, pero hay tres regresiones en PC. Corrige y haz commit en la rama:

1. Rutas en PC: src/ui/styles/escritorio.css:38 oculta el selector de punto de salida y el panel lateral solo lo muestra en fase empty (src/ui/pages/Rutas.tsx:332). El usuario tiene que poder cambiar el punto de salida también con resultados en pantalla.
2. Calendario en PC: escritorio.css:44-45 oculta la tira semanal, su resumen y la leyenda, y los botones de src/ui/pages/Calendario.tsx:369 y :461 que abrían la hoja del mes ya no hacen nada. O mantén esos controles visibles en PC o dales un destino.
3. src/ui/components/Page.tsx:43-48: cuando desktopMap pasa de undefined a definido, el árbol de hijos se remonta y se pierden foco, scroll y estado local (ocurre al llegar resultados en Rutas y en Rutas IA). Mantén la misma estructura de DOM en ambos casos (reserva el hueco del mapa) para que los hijos no se remonten.
4. Menores: useDesktopLayout se resuscribe en cada render (memoriza el MediaQueryList y el listener); los umbrales 1024 y 1280 están repetidos como literales en CSS y TS, defínelos una vez (custom property + constante exportada); HistoryWorkspace monta dos Page (doble h1 y doble lectura de Dexie), que sea un solo Page con dos columnas; docs/escritorio.md tiene una ruta absoluta de tu máquina y el resultado final sin completar.
5. Prueba reproducible desde el repo de que el móvil no cambia: en e2e/escritorio.spec.ts añade capturas a 390 px de Inicio, Rutas, Calendario e Historial y compáralas con main (toHaveScreenshot con una baseline generada en main, sin depender de escritorio.local ni de APIs internas de playwright-core). Las dos capturas que te salieron distintas (360-light/inicio.png y 390-light/inicio.png) hay que explicarlas o corregirlas.
6. Rebase sobre main. En src/ui/pages/RutasIa.tsx main ha cambiado hoy (lote de IA, commit 031a5c4): limita tu cambio a las dos líneas actuales (import de RideMap y prop desktopMap) para que el conflicto sea trivial.
7. Al terminar: npx vitest run, npx tsc --noEmit, npm run build, npx playwright test e2e/escritorio.spec.ts con PLAYWRIGHT_PORT=4177, y cierra tus vite (puertos 4173, 4184 y el baseline).
```
