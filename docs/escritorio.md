# Adaptación de escritorio

Rama `codex/escritorio`, creada desde `origin/main` (`684a295`) el 2026-11-10 en `C:\testTrain-codex-escritorio`. El worktree PWA de `C:\testTrain-codex` se conserva intacto. Sin push ni despliegue.

Las reglas nuevas están en `src/ui/styles/escritorio.css`, dentro de `@media (min-width: 1024px)`, y se importan al final de `main.tsx`. No se han editado los CSS anteriores ni los tokens de la paleta A. El carril compacto de tableta desde 900 px ya existía y se conserva.

- Navegación lateral fija con los cinco destinos y la marca B Trazado; contenido centrado hasta 1180 px.
- Inicio: KPI y tendencia a la izquierda, objetivos y próximos entrenos a la derecha.
- Historial y salida juntos desde 1280 px; en anchos menores se mantiene la navegación entre pantallas. La lista tiene desplazamiento propio.
- `Page.desktopMap` coloca el mapa junto a los controles de Rutas y las propuestas de Rutas con IA. Solo monta el panel en escritorio. En Rutas con IA, el usuario autorizó expresamente las dos líneas de importación y prop; no se modificó su lógica ni los otros archivos reservados.
- Calendario mensual en línea, con navegación de meses y selección de día; Ajustes en una columna de hasta 720 px.
- Mapas y gráficas principales de al menos 480 px. `RideMap` y `StartPointCanvas` ya usan `ResizeObserver` e `invalidateSize`; las gráficas actuales son SVG, sin instancias ECharts. La tendencia recalcula su geometría al cambiar de tamaño.
- Hojas centradas, hasta 560 px, con desplazamiento interno y sin arrastre en PC. Hover y foco usan los tokens existentes.

## Verificación reproducible

`e2e/escritorio.spec.ts` usa datos sintéticos, fecha fija, movimiento reducido y servicios simulados. La prueba normal utiliza 1280×800 e incluye cambio entre paneles y móvil, continuidad de la salida, redimensionado de Leaflet y foco visible.

Para generar la matriz, establecer `ESCRITORIO_CAPTURAS=movil` (360, 390, 430) o `pc` (1024, 1280, 1440, 1920), y `ESCRITORIO_FASE=antes` o `despues`. Se capturan ambos temas: 18 vistas/estados en móvil; en PC, las ocho pantallas solicitadas, los filtros y los resultados de ambas rutas. `ESCRITORIO_VISTAS=inicio,plan,login` permite repetir solo las vistas indicadas. Las teselas se sustituyen por imágenes transparentes: se verifica el trazado y la disposición sin depender de un proveedor externo.

Las capturas y los informes locales están en `escritorio.local/` (ignorado por Git). La referencia móvil corresponde al commit de partida `684a295`, sin cambios; la referencia remota `origin/main` avanzó durante el lote. No se han incorporado esos cambios ajenos a esta rama.

Comparación exacta de píxeles PNG:

```powershell
node scripts/compare-escritorio-mobile.mjs
```

El resultado se guarda en `escritorio.local/comparacion-movil.json`. Cada carpeta de PC contiene `contraste.json`: auditoría del texto con umbral 4,5:1. Las pruebas también comprueban el desbordamiento horizontal y el centrado de las hojas.

La auditoría preexistente de bienvenida mantiene el reloj detenido mientras mide su distribución: la escena real dura 1,8 segundos y podía desaparecer durante la captura con la máquina cargada. Este ajuste solo afecta al test.

## Ficheros del lote

- `src/ui/styles/escritorio.css`, `src/main.tsx`: estilos y carga final.
- `src/ui/hooks/useDesktopLayout.ts`, `src/ui/components/Page.tsx`: composición según el ancho y panel de mapa.
- `src/App.tsx`, `src/ui/historial/HistoryWorkspace.tsx`: historial y detalle juntos.
- `src/ui/pages/Rutas.tsx`, `src/ui/pages/RutasIa.tsx`: conexión del mapa lateral.
- `src/ui/pages/Calendario.tsx`: calendario mensual en línea.
- `src/ui/inicio/TrendCard.tsx`: geometría de la gráfica en PC.
- `src/ui/components/Sheet.tsx`: arrastre limitado al móvil.
- `e2e/escritorio.spec.ts`, `e2e/break-ui-empalmar.spec.ts`: auditoría y reloj de la bienvenida.
- `scripts/compare-escritorio-mobile.mjs`: comparación de píxeles.
- `docs/escritorio.md`: alcance, reproducción y resultados.

## Resultados finales, 2026-11-10

| Comprobación | Resultado |
|---|---|
| `npx vitest run --maxWorkers=2 --minWorkers=1` | 98 ficheros, 1.228 pruebas en verde |
| `npx tsc --noEmit` | Sin errores |
| `npm run build` | Correcto; también se construyó para la regresión de producción |
| Playwright completo, 2 workers y timeout de 90 s | 106/106 en verde en una pasada completa |
| Matriz móvil: 360/390/430, claro y oscuro | 108/108 capturas idénticas píxel a píxel |
| Matriz PC: 1024/1280/1440/1920, claro y oscuro | 8/8 combinaciones en verde; Login comprobado en su viewport correspondiente |
| Desbordamiento horizontal | Ninguno en las vistas y anchos auditados |
| Contraste de texto, umbral 4,5:1 | 0 fallos y 0 textos sin comprobar en los informes de PC |

Capturas: `C:\testTrain-codex-escritorio\escritorio.local\antes\` y `C:\testTrain-codex-escritorio\escritorio.local\despues\`.

Informes: `comparacion-movil.json`, `contraste-resumen.json` y los `contraste.json` de cada ancho/tema. Logs finales: `vitest.log`, `tipos-cierre.log`, `build.log`, `playwright-final.log`, `pc-definitivo.log`, `pc-login.log` y `comparacion-definitiva.log`, dentro de `escritorio.local/`.

La regresión completa se ejecutó con `PLAYWRIGHT_PORT=4186` y `--config=escritorio.local/playwright.config.ts --workers=2 --timeout=90000`: el config local solo amplía el tiempo de arranque del build, mantiene el resto del proyecto y evita ocupar el puerto del otro lote. Las capturas comparadas también se verificaron con las fuentes autoalojadas cargadas. Revisión visual de Inicio, paneles de Historial/Salida, Rutas, Rutas con IA, calendario mensual y Login, además de las aserciones de las ocho pantallas solicitadas.
