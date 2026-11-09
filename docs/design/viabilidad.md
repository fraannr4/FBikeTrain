# Viabilidad técnica del rediseño

Fecha: 6 de noviembre de 2026. Base: código de F1 tal como está en `src/` (sin tocarlo).

Comprobado contra el código instalado (`node_modules`: echarts 5.6.0, zrender, leaflet 1.9.4) y contra los paquetes publicados en npm (descargados aparte para medirlos). context7 no estaba disponible en esta sesión (pide autenticación), así que las afirmaciones sobre APIs salen de leer el código fuente de cada librería, no de su web.

Conclusión: el rediseño cabe en la pila actual sin cambiar de versión ni ECharts ni Leaflet. Solo hacen falta dos dependencias nuevas: `lucide-react` y una familia de `@fontsource-variable`. Los riesgos están en las pruebas, no en las librerías: varias pruebas de Testing Library y de Playwright dependen de textos exactos, nombres de región y clases CSS. La sección 4 los enumera.

---

## 1. Notas técnicas

### 1.1 ECharts 5 (área con degradado, curvas suaves y burbuja en el último punto)

Todo lo necesario existe en 5.6.0. No hay que actualizar a la 6: es la versión mayor siguiente, cambia la API y el resumen del encargo fija ECharts 5.

- **Módulos.** `src/ui/components/echarts.ts` registra ahora `BarChart`, `GridComponent`, `TooltipComponent` y `SVGRenderer`. Para el rediseño hay que añadir `LineChart` (de `echarts/charts`) y `MarkPointComponent` (de `echarts/components`). Si la burbuja se resuelve con `endLabel`, no hace falta `MarkPointComponent`: `endLabel` forma parte de `LineChart` desde la 5.0 (`echarts/lib/chart/line/LineView.js`). El fichero sigue cargándose con `import()` dinámico, así que no pesa en la carga inicial.
- **Degradado.** No hace falta importar `graphic.LinearGradient`. Basta un objeto literal, que el renderizador SVG convierte en un `<linearGradient>`:
  ```ts
  areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [{ offset: 0, color: areaTop }, { offset: 1, color: areaBottom }] } }
  ```
- **Formato de color que entiende ECharts.** El analizador de color de zrender (`zrender/lib/tool/color.js`) acepta `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, nombres CSS, `rgb()`/`rgba()` y `hsl()`/`hsla()` **solo con comas**. No entiende `oklch()`, `color-mix()`, `rgb(42 120 214 / .3)` (sintaxis con espacios) ni `var(--x)`. `getComputedStyle(el).getPropertyValue('--token')` devuelve el valor tal como está escrito, sin convertirlo. Por eso los tokens que leen las gráficas (`--color-series-*`, `--chart-area-top`, `--chart-area-bottom`, `--chart-grid`, etc.) tienen que escribirse en hexadecimal (`#2a78d659` vale para el alfa) o en `rgba(r, g, b, a)` con comas. El resto de tokens del sistema pueden usar `oklch()`.
- **Curvas suaves.** `smooth: 0.3` con `smoothMonotone: 'x'` y `yAxis.min: 0`. Con `smooth: true` a secas, una curva entre un mes con cero kilómetros y otro con muchos puede bajar de cero y sugerir algo que no ha pasado. Hay que comprobarlo en las capturas, con un mes vacío en medio.
- **Burbuja de valor en el último punto.** Hay dos formas válidas:
  1. **`markPoint`** con `data: [{ coord: [ultimoIndice, ultimoValor] }]`, `symbol: 'circle'`, `symbolSize: 10` y `label: { show: true, position: 'top', formatter, backgroundColor, borderColor, borderRadius, padding }`. Un mismo mecanismo pinta el punto y la burbuja. Recomendado.
  2. **`endLabel`** en la serie (`show`, `formatter`, `backgroundColor`, `borderRadius`, `padding`, `offset`), más un punto aparte. `showSymbol: false` oculta todos los puntos y un dato suelto no puede anularlo, así que el punto tendría que salir de `markPoint` igualmente.
  - Descartado: `graphic` con `convertToPixel`, porque obliga a recolocar la burbuja a mano en cada redimensionado.
  - El `formatter` tiene que usar `formatKm` / `formatMeters` de `src/ui/format.ts`, para que salga «1.240 m» y no «1,240». Hay una prueba de Playwright que lo vigila (sección 4).
  - El último periodo suele ser el mes o la semana en curso, todavía incompletos. La burbuja o el texto alternativo deberían decirlo («noviembre, en curso»).
- **Tema oscuro y claro.** En 5.6.0, `ECharts#setTheme()` es un método vacío con el aviso «DEPRECATED in ECharts 3.0» (`echarts/lib/core/echarts.js`, línea 429). `registerTheme` existe, pero el tema se fija en `init()`: cambiarlo obliga a hacer `dispose()` y `init()` otra vez. La opción más simple ya está en el código: `buildOption()` lee los tokens CSS con `token(el, '--…')`. Basta con que el efecto que llama a `setOption` dependa también del tema resuelto (`[chart, periods, theme]`), así se vuelve a ejecutar al cambiar de tema. No hace falta ni `registerTheme` ni reinicializar.
- **Tipografía en las gráficas.** Hoy está `textStyle: { fontFamily: 'inherit' }`. Con el renderizador SVG se ve bien, porque el `<text>` hereda, pero ECharts mide el texto con `measureText` de canvas y `'inherit'` no es una fuente válida allí: mide con la de por defecto y las etiquetas pueden solaparse o recortarse con una fuente propia más ancha. Hay que pasar la familia real (`getComputedStyle(el).fontFamily`) y llamar a `chart.resize()` tras `document.fonts.ready`.
- **Dos ejes, no uno.** La inspiración pinta distancia y desnivel en un solo eje Y, mezclando km y m. El código actual usa dos rejillas apiladas, cada una con su eje. Hay que conservarlas y convertir cada una en área: mezclar unidades en un eje engaña y la skill dataviz lo desaconseja. Además, la prueba de ejes busca el texto «Desnivel (m)» dentro de `.chart-canvas`.
- **Movimiento.** Hoy está `animation: false`. Si el rediseño lo activa, tiene que ser `animation: !prefersReducedMotion`.
- **Minigráficas de las tarjetas KPI.** La inspiración pone una minigráfica bajo cada KPI. No conviene hacerlas con cuatro instancias de ECharts: obligaría a cargar ECharts antes de pintar Inicio y la prueba de «5.000 salidas en menos de 3 s» va justa. Mejor un SVG en línea, como el `AltitudeProfile` que ya existe, con `aggregate(acts, 'week', desde, now)` de las últimas 8 a 12 semanas. Esa función ya existe y no hace falta métrica nueva. Cada minigráfica lleva `aria-hidden` porque es decorativa: el dato está en el texto de la tarjeta.

### 1.2 Leaflet con CyclOSM (modo oscuro y trazado luminoso)

- **Paneles.** `Map.js` crea `mapPane` y, dentro, `tilePane`, `overlayPane`, `shadowPane`, etc., como hermanos. Un `filter` CSS sobre `.leaflet-tile-pane` oscurece solo las teselas. La polilínea vive en `.leaflet-overlay-pane` y los controles, la atribución incluida, en `.leaflet-control-container`, así que no les afecta.
  ```css
  :root[data-theme='dark'] .ride-map .leaflet-tile-pane {
    filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6);
  }
  ```
  `invert` más `hue-rotate(180deg)` mantiene más o menos los tonos de CyclOSM (carriles bici, pendientes) y oscurece el fondo. Los valores finales se ajustan con capturas reales. Hay que dar estilo oscuro también a `.leaflet-control-attribution` y a `.leaflet-bar`. La atribución tiene que seguir legible, con un contraste AA.
- **Trazado luminoso.** Dos polilíneas con las mismas coordenadas, las dos con `interactive: false`:
  - halo: `weight: 10`, `opacity: 0.35`, `className: 'route-halo'`;
  - núcleo: `weight: 3`, `className: 'route-core'`.
  Leaflet pone el color como atributo de presentación (`path.setAttribute('stroke', …)` en `SVG.js`). Una regla CSS sobre `.route-core { stroke: var(--route-core) }` tiene prioridad sobre ese atributo, así que **el trazado cambia de tema solo con CSS**, sin volver a leer tokens en JavaScript. El `color` que se lee hoy con `getComputedStyle` deja de hacer falta.
  - Resplandor extra opcional: `filter: drop-shadow(0 0 6px var(--route-glow))` sobre `.ride-map .leaflet-overlay-pane svg`, que es la raíz SVG y en cualquier navegador es una caja CSS. No conviene ponerlo en el `<path>`: el soporte de los filtros CSS en elementos SVG hijos es irregular entre navegadores. Activarlo solo en oscuro.
  - Las dos polilíneas hacen falta igualmente: el doble trazo es lo que se ve en la inspiración y funciona sin filtros.
- **Inicio y fin.** `circleMarker` (SVG puro). Nada de `L.marker` con el icono por defecto: con Vite, las imágenes de ese icono dan 404 si no se configuran a mano.
- **Controles.** El zoom de Leaflet ya viene incluido. La pantalla completa se puede hacer con la Fullscreen API sobre el contenedor más `map.invalidateSize()`, sin complemento. Es opcional.
- **Movimiento reducido.** Leaflet no respeta `prefers-reduced-motion` por sí mismo. Si está activo, hay que pasar `zoomAnimation: false`, `fadeAnimation: false` y `markerZoomAnimation: false`.
- **Pruebas.** `tests/inicio.test.tsx` ya simula `createSVGRect` para jsdom. Las dos polilíneas y `circleMarker` usan el mismo renderizador SVG, así que no hacen falta más simulaciones.

### 1.3 Tarjetas de ruta: forma y perfil por pendiente, sin fotos

- **Forma.** Un SVG con un `path` que proyecta lat/lng de forma equirectangular (x = lng·cos(latMedia), y = −lat) y se ajusta a un `viewBox`. Antes hay que reducir el track a unos 150 o 200 puntos: los tracks reales tienen miles. Con la clase `route-core` y su halo, reutiliza el estilo luminoso del mapa.
- **Perfil coloreado por pendiente.** Un solo `path` de área cuyo relleno es un `<linearGradient>` horizontal, con un par de `stop` en cada cambio de tramo de pendiente (por ejemplo < 3 %, 3–6 %, 6–9 %, > 9 %). Sale mucho más barato que un `path` por segmento. La escala de color necesita una leyenda en texto y un `aria-label` con el resumen: el color no puede ser la única pista.
- **Identificadores de degradado.** Cada SVG que defina degradados necesita identificadores únicos: con `useId()`, quitando los dos puntos (`useId().replace(/:/g, '')`), porque van dentro de `url(#…)`.
- **Datos.** En F1 solo existe la última salida con su track. Las tarjetas de ruta (rutas repetidas en F2, generadas en F4, con IA en F5) llegan después. El componente se puede diseñar ya con el track de la última salida.

### 1.4 Paisajes en SVG propio (sin fotos)

- Un componente `Landscape` con capas de montaña (`path` rellenos con `linearGradient`), cielo con un degradado de atardecer o de noche y, si se quiere, curvas de nivel como `path` con trazo fino y opacidad baja. Lleva `aria-hidden="true"` y `focusable="false"`, y `preserveAspectRatio="xMidYMax slice"` para que llene el hero a cualquier ancho.
- Los colores salen de tokens CSS (`stop-color: var(--sky-top)` en una regla CSS, no en un atributo), así que cambian con el tema sin JavaScript.
- Coste: unos pocos KB de SVG en línea, sin peticiones extra.
- A 320 px no puede provocar desplazamiento horizontal. El SVG va con `position: absolute; inset: 0` dentro de un contenedor con `overflow: hidden`.

### 1.5 Tema con `data-theme` y `prefers-color-scheme`, sin parpadeo

- La preferencia admite tres valores: `dark` (por defecto), `light` y `system`. Se guarda en `localStorage`, porque los ajustes viven en IndexedDB (Dexie), que es asíncrono: no se puede leer antes del primer pintado. No es una clave ni un dato sensible, así que no choca con la regla de «claves solo en Ajustes, en IndexedDB». Ajustes puede mostrar el selector y escribir en los dos sitios si se quiere incluir en la copia de seguridad.
- Script clásico en línea en el `<head>` de `index.html`, antes del `<script type="module">`. Vite deja los scripts clásicos en línea tal cual en la build, y GitHub Pages no pone CSP:
  ```html
  <meta name="color-scheme" content="dark light" />
  <script>
    (function () {
      var t = 'dark';
      try {
        var s = localStorage.getItem('fbiketrain-theme');
        if (s === 'light' || s === 'dark') t = s;
        else if (s === 'system' && window.matchMedia)
          t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      } catch (e) {}
      document.documentElement.setAttribute('data-theme', t);
    })();
  </script>
  <style>html{background:#0b1020}html[data-theme='light']{background:#f6f7f9}</style>
  ```
  El `<style>` mínimo evita el destello blanco en `npm run dev`, donde Vite inyecta el CSS con JavaScript después del primer pintado. En la build, el CSS va en un `<link>` y el destello no existe, pero no estorba. Los dos colores tienen que coincidir con `--color-bg`.
- **CSS.** Se escribe primero el tema oscuro, con `:root, :root[data-theme='dark'] { … }` y `color-scheme: dark`, y después `:root[data-theme='light'] { … }` con `color-scheme: light`. En jsdom no se ejecuta `index.html`, así que no hay atributo y se aplica el oscuro: las pruebas no notan la diferencia.
- **En React.** Un módulo `theme.ts` pequeño con `get`, `set` y `subscribe`, que se lee con `useSyncExternalStore`. Expone el tema resuelto (`dark` o `light`), que es lo que necesitan ECharts y el `<meta name="theme-color">`. Con `system`, se escuchan los cambios de `matchMedia('(prefers-color-scheme: light)')`.
- **Cuidado en las pruebas.** jsdom no implementa `window.matchMedia` ni `ResizeObserver`. Cualquier código que los use al montarse rompe todas las pruebas de `App`. Hay que protegerlo con `typeof window.matchMedia === 'function'`, o añadir un sustituto en `tests/setup.ts` (en la fase de implementación, no ahora). Pasa lo mismo con `prefers-reduced-motion` leído desde JavaScript y con un `ResizeObserver` que sustituya al `resize` de `window` en `ProgressChart`.

### 1.6 Iconos con lucide-react

- Versión comprobada: 1.60.0 (20 de octubre de 2026). Tiene `sideEffects: false` y una exportación por icono (`lucide-react/icons/*`, con tipos `dist/lucide-icon.d.mts`). Como peer dependency admite React `^18`.
- **Tamaño.** Cada icono ESM ocupa entre 0,3 y 1 KB sin comprimir (`bike` 695 B, `mountain` 502 B, `history` 260 B, `sparkles` 967 B). La base común (`Icon`, `createLucideIcon`, el contexto y las utilidades) ronda los 3 a 4 KB. Unos 20 iconos suman unos 15 KB sin comprimir, unos 5 KB con gzip.
- **Cómo importar.** `import { Bike } from 'lucide-react'` se queda en la build solo con lo que se usa (Rollup más `sideEffects: false`). Aun así, recomiendo importar por icono, `import Bike from 'lucide-react/icons/bike'`, por Vitest: el barril carga los 4.334 iconos en cada fichero de prueba que monte `App`. Con `moduleResolution: "bundler"` (el del `tsconfig.json`), la ruta por icono tiene tipos.
  - Hay que confirmarlo en la implementación con `npx tsc --noEmit`. Si los tipos por icono dan guerra, el barril también sirve.
- **Nombres en la 1.x.** Existen `house` (no `home`), `chart-line`, `chart-area`, `chart-no-axes-column`, `calendar-days`, `route`, `map`, `map-pin`, `bike`, `mountain`, `mountain-snow`, `timer`, `clock`, `gauge`, `circle-gauge`, `trending-up`, `trending-down`, `trophy`, `target`, `bell`, `search`, `settings`, `sun`, `moon`, `upload`, `sparkles`, `wand-sparkles`, `bot`, `navigation`, `menu`, `panel-left` y `ellipsis`. No usar `flame` para calorías: no hay calorías.
- **Accesibilidad.** Sin `aria-label`, `title` ni hijos, el componente pone `aria-hidden="true"` solo. Así que los iconos junto a un texto no cambian el nombre accesible de los enlaces y los botones, y `getByRole('link', { name: 'Inicio' })` sigue funcionando. Un botón que solo tenga icono (tema, búsqueda) necesita `aria-label` en el `<button>`.
- `LucideProvider` permite fijar `size` y `strokeWidth` de todos los iconos en un solo sitio.

### 1.7 Fuentes con @fontsource-variable (autoalojadas)

Todas las familias están en la versión 5.3.0, publicada el 19 de julio de 2026. Ejes y tamaño del woff2 `latin` con el eje `wght`, que es el único fichero que descarga una interfaz en castellano:

| Paquete | Ejes | latin wght |
|---|---|---|
| `@fontsource-variable/inter` | wght 100–900, opsz 14–32, ital | 48 KB (con opsz: 73 KB) |
| `@fontsource-variable/inter-tight` | wght 100–900, ital | 45 KB |
| `@fontsource-variable/geist` | wght 100–900, ital | 29 KB |
| `@fontsource-variable/manrope` | wght 200–800 | 25 KB |
| `@fontsource-variable/space-grotesk` | wght 300–700 | 22 KB |
| `@fontsource-variable/archivo` | wght 100–900, wdth 62–125, ital | 35 KB (con wdth: 90 KB) |
| `@fontsource-variable/jetbrains-mono` | wght 100–800, ital | 40 KB |
| `@fontsource-variable/outfit`, `figtree`, `sora`, `dm-sans`, `onest` (5.3.1), `plus-jakarta-sans`, `bricolage-grotesque`, `instrument-sans` | wght | sin medir |

`@fontsource-variable/barlow` no existe: Barlow no es variable.

- **Importación.** En `main.tsx` va `import '@fontsource-variable/<familia>/wght.css'` (o `index.css`). No hay CSS por subconjunto en los paquetes variables: cada CSS declara todos los subconjuntos con `unicode-range`. Vite copia todos los woff2 a `dist/` (unos cientos de KB en disco), pero el navegador solo descarga los que use la página. El subconjunto `latin` incluye `U+2212`, el signo menos tipográfico de `formatDeltaPct`, y `U+2000-206F` (comillas y rayas).
- La familia se llama `'<Nombre> Variable'`, por ejemplo `'Inter Variable'`. La pila de fuentes debe terminar en `system-ui, sans-serif`.
- Las cifras tienen que ir con `font-variant-numeric: tabular-nums`. Inter, Geist y Manrope tienen cifras tabulares. Space Grotesk y Archivo hay que comprobarlas en las capturas.
- Rutas: las URL de las fuentes salen del CSS y Vite les aplica `base`, así que funcionan con `BASE_PATH` en GitHub Pages.
- Para no cargar dos familias variables, las cifras grandes pueden usar la misma familia con más `wght` (o `opsz` en Inter) en vez de una segunda fuente.

### 1.8 Navegación: menú lateral en escritorio y barra inferior en móvil

- Mejor **un solo `<nav aria-label="Menú principal">`** al que el CSS da forma de menú lateral (≥ 64 rem, por ejemplo) o de barra fija abajo (móvil) que dos navegaciones en el DOM. jsdom no aplica las media queries, y además en las pruebas `App` se monta sin `styles.css`: dos `nav` aparecerían las dos a la vez y duplicarían los enlaces.
- **Pestañas.** La inspiración tiene cinco (Inicio, Historial, Rutas, IA, Más), pero hoy solo existen tres rutas: `/`, `/importar` y `/ajustes`. `tests/app.test.tsx` comprueba que los enlaces del menú son exactamente `['Inicio', 'Importar', 'Ajustes']`. Propuesta:
  - En F1, la barra inferior muestra esas tres.
  - Historial, Rutas e IA se añaden cuando lleguen sus fases (F2, F4 y F5), y la prueba se actualiza en cada una.
  - «Más» aparece cuando haya más de cinco destinos. Será un `<button aria-expanded>` que abre una hoja con Importar y Ajustes, no un enlace.
  - Un enlace a una pantalla vacía o «próximamente» sería peor.
- En la barra inferior hacen falta `padding-bottom: env(safe-area-inset-bottom)` y un `padding-bottom` en `.content` equivalente a la altura de la barra, para que no tape el último contenido. Hace falta también `<meta name="viewport" content="…, viewport-fit=cover">`.
- `NavLink` ya pone `aria-current="page"` y la clase `active`. El estilo activo puede colgar de cualquiera de los dos.

### 1.9 Búsqueda y notificaciones locales

- **Búsqueda.** Basta con filtrar por nombre las salidas que `listActivities()` ya trae a memoria. Con 5.000 salidas va bien sin índice. Si el campo se queda vacío, es mejor no mostrarlo en F1: hoy solo hay nombres de salidas que buscar.
- **Notificaciones.** Hoy la única es el aviso «Última importación hace N días», que se calcula en `Inicio`. La campana puede repetirlo con un contador. **El aviso tiene que seguir visible en Inicio**: Playwright comprueba `getByText('Última importación hace 9 días')` con `toBeVisible()`, y moverlo dentro de un desplegable lo rompe.

### 1.10 Nombre de la aplicación

- «FBikeTrain» puede ir en el `<title>`, en la marca del menú y en el `aria-label` del logotipo.
- **No hay que renombrar la base de datos IndexedDB `ciclismo`.** Se perderían las salidas importadas de los usuarios, y Playwright abre `indexedDB.open('ciclismo')` para sembrar los datos de prueba.
- El fichero de copia (`ciclismo-copia-AAAA-MM-DD.json`) puede quedarse como está.

### 1.11 Accesibilidad y movimiento

- **Variaciones.** Ya llevan signo («+5 %», «−8 %»). La flecha de lucide y el verde o el rojo se suman al signo, no lo sustituyen.
- **Contraste.** Verde y rojo sobre fondo oscuro tienen que llegar a 4,5:1 para el texto pequeño.
- **Foco.** El `:focus-visible` actual sirve, pero tiene que verse bien en los dos temas, también encima del hero con paisaje.
- **Movimiento.** `@media (prefers-reduced-motion: reduce)` anula transiciones y animaciones. ECharts y Leaflet necesitan el valor en JavaScript (1.1 y 1.2).

---

## 2. Dependencias que hay que añadir

| Paquete | Versión | Motivo |
|---|---|---|
| `lucide-react` | `1.60.0` | Iconos. Publicada el 20 de octubre de 2026, más de dos semanas antes de hoy. La última, 1.70.0, salió hoy. |
| `@fontsource-variable/<familia elegida>` | `5.3.0` | Fuente variable autoalojada. La familia la elige `cycling-ui-designer`; Inter, Geist o Manrope son las opciones más ligeras con cifras tabulares. |

Instalación, en la fase de implementación y no ahora: `npm install --save-exact lucide-react@1.60.0 @fontsource-variable/<familia>@5.3.0`.

Lo que **no** hay que añadir ni actualizar:

- `echarts`: se queda en 5.6.0. La 6.1.0 es una versión mayor y el encargo fija ECharts 5.
- `leaflet`: se queda en 1.9.4. La 2.0 sigue en beta.
- Nada de bibliotecas de animación, Tailwind, componentes ni complementos de Leaflet. Todo lo de arriba se hace con CSS, SVG en línea y las APIs que ya existen.

---

## 3. UI actual (lo que hay que superar)

- **Armazón.** `App.tsx` tiene `HashRouter`, `div.layout`, `nav.sidebar` con `aria-label="Menú principal"` y tres `NavLink` (Inicio, Importar, Ajustes), y `main.content` con las rutas `/`, `/importar` y `/ajustes`. Por debajo de 40 rem, el menú lateral pasa a ser una fila de enlaces arriba.
- **Estilos.** `styles.css` es plano, solo con tema claro. Tokens: `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-border`, `--color-accent`, `--color-focus`, `--color-series-1`, `--color-series-2` y `--space`. Fuente `system-ui`. Clases: `.card`, `.kpis`, `.kpi`, `.kpi-label`, `.kpi-value`, `.kpi-note`, `.segmented`, `.chart`, `.chart-canvas`, `.ride-name`, `.stats`, `.ride-map`, `.profile`, `.profile-area`, `.profile-line`, `.notice`, `.muted`, `.dropzone`, `.dropzone-over`, `.file-name`, `.settings-form` y `.field`.
- **Inicio** (`ui/pages/Inicio.tsx`):
  - `h1` «Inicio» y «Hola, {nombre}.».
  - Aviso `.notice` si la última importación tiene más de 7 días.
  - Tarjeta «Esta semana» con cuatro `KpiTile`: Distancia, Desnivel y Tiempo en bici, con la nota «±N % vs tu media», y Velocidad media, con la nota «4 semanas anteriores».
  - Tarjeta «Tu progresión» con un grupo de botones `aria-pressed` (12 meses, 6 meses, 3 meses, 30 días) y `ProgressChart`: barras ECharts en dos rejillas, distancia y desnivel, renderizador SVG, carga diferida, `role="img"` con texto alternativo y una tabla en `<details>` «Ver los datos de la gráfica».
  - `LastRide`: nombre, fecha larga, `<dl>` de estadísticas (pulso y potencia solo si hay datos), mapa Leaflet CyclOSM con `role="region"` y el nombre «Mapa de la última salida», y perfil de altitud en SVG con `role="img"`.
  - Estado vacío: «Aún no hay salidas.» con un enlace a Importar.
- **Importar.** `h1` «Importar salidas», `Dropzone` (una `section` con el nombre «Ficheros para importar», el texto de ayuda y un `input file` con la etiqueta «Elegir ficheros»), el enlace a la ayuda de Strava, el progreso en `role="status"`, `ImportReportView` y el error en `role="alert"`.
- **Ajustes.** `h1` «Ajustes», un formulario con etiquetas (Nombre, Clave de OpenRouteService, URL base de la IA, Clave de la IA, Modelo de la IA), los botones «Probar conexión» con su `aria-label`, «Guardar», y la sección «Copia de seguridad» con la casilla «Incluir claves», «Exportar copia», «Restaurar» y el campo oculto «Fichero de copia».

---

## 4. Contratos con las pruebas que el rediseño debe conservar

Si alguno se cambia a propósito, la prueba se actualiza en la misma tarea y con TDD: primero la prueba nueva, luego el cambio.

### 4.1 Testing Library (`tests/*.test.tsx`)

**`app.test.tsx`**
- `navigation` con el nombre «Menú principal», cuyos enlaces son exactamente `['Inicio', 'Importar', 'Ajustes']`, comparando el `textContent`. Si el icono lleva texto, o si se añade una marca o un enlace dentro del `nav`, la prueba falla: la marca tiene que quedar fuera del `<nav>`.
- `h1` «Inicio» en `/` y `h1` «Ajustes» en `#/ajustes`.

**`inicio.test.tsx`**
- `h1` «Inicio». El saludo grande de la inspiración («¡Hola Fran!») no puede sustituirlo: «Inicio» puede quedarse como `h1` visualmente oculto, o el saludo puede ser otro elemento.
- Texto exacto «Hola, Ana.». «¡Hola, Ana!» rompe esta prueba y la de Playwright.
- Texto «Aún no hay salidas» y enlace «Importar salidas» que apunta a `#/importar`.
- Región «Esta semana», el nombre del `h2` por `aria-labelledby`, que puede estar oculto visualmente. Dentro, `getByText('88 km')`, `'1.240 m'`, `'3 h 42 min'` y `'24,6 km/h'`.
  - **Riesgo importante.** `getByText` solo compara los nodos de texto propios de cada elemento. Separar cifra y unidad en dos `<span>` para poner la unidad más pequeña (`<span>88</span> <span>km</span>`) rompe estas cuatro comprobaciones y las de «Tu última salida». Hay dos salidas:
    - mantener el valor en un solo nodo de texto;
    - o cambiar las pruebas a un comparador por `textContent` sobre `.kpi-value`.
  - Lo decide `cycling-ui-designer` y lo aplica el implementador con TDD.
- Textos exactos «−8 % vs tu media», «+5 % vs tu media» y «−5 % vs tu media», y que no aparezca «vs tu media» sin historial. Una flecha `<svg>` junto al texto no molesta. Acortar la nota a «−8 %» sí rompe la prueba.
- Texto `/Última importación hace 9 días/`.
- Región «Tu última salida» con el nombre de la salida, «48,0 km», `/no tiene mapa/`, región «Mapa de la última salida», texto `/CyclOSM/` y `/OpenStreetMap/` (la atribución), «142 ppm» solo si hay pulso y nada de «Potencia media» sin potencia.
- `img` con el nombre exacto «Perfil de altitud: mínima 120 m, máxima 410 m». Si el perfil pasa a colorearse por pendiente, el `aria-label` tiene que conservar este formato.
- Región «Tu progresión», botones «12 meses», «6 meses», «3 meses» y «30 días» con `aria-pressed`, y `rowheader` de la tabla con las etiquetas de los periodos (`dic 2025`, `5 oct`…). Si el selector pasa a pestañas (`role="tab"`), la prueba se rompe: hay que mantener los botones con `aria-pressed`.
- **Simulaciones de ECharts.** `vi.mock('echarts/charts', () => ({ BarChart: {} }))` y `vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {} }))`. Si `echarts.ts` importa `LineChart` o `MarkPointComponent`, Vitest lanza «No "LineChart" export is defined on the mock» dentro del `import()` dinámico, y la ejecución falla. Las simulaciones se amplían en la misma tarea.

**`importar.test.tsx`**
- `h1` «Importar salidas».
- Texto exacto «Arrastra aquí el archivo de “Descargar tu cuenta” de Strava, o ficheros FIT, GPX o TCX.», en un único nodo de texto.
- Enlace `/pedir el archivo en Strava/`, la etiqueta «Elegir ficheros» con `accept=".zip,.fit,.gpx,.tcx,.gz"`, la región «Ficheros para importar» (recibe `drop`), `progressbar`, «3 de 10», «5 salidas nuevas», «1.240 salidas nuevas», «2 ya estaban», «0 ya estaban», «1 salida nueva», `corrupt.fit` y el `alert` «No se ha podido completar la importación».

**`ajustes.test.tsx`**
- Etiquetas «Nombre», «Clave de OpenRouteService», «URL base de la IA», «Clave de la IA», «Modelo de la IA» y «Fichero de copia».
- Botones «Guardar», «Probar conexión con OpenRouteService», «Exportar copia» y «Restaurar», y la casilla «Incluir claves».
- Textos «Ajustes guardados.», «Copia restaurada.», «La clave no es válida.», «Quien tenga el fichero podrá usar tus claves.», «El fichero no es una copia de esta aplicación.», «Cargando ajustes…» y los mensajes de almacenamiento.

### 4.2 Playwright (`e2e/*.spec.ts`)

**Clases CSS que usan los localizadores**
- `.kpi` (filtrada por «Distancia», «Desnivel» y «Tiempo en bici»), `.kpi-value`, `.chart tbody tr`, `.chart-canvas`, `.ride-name` y `.file-name`. Si se renombran, hay que actualizar `e2e/` en la misma tarea.
- `.kpi-value` se compara con `toHaveText(/^\d{1,3}(\.\d{3})* km$/)`, que usa el `textContent` completo. Ahí separar en `<span>` sí funciona, siempre que quede un espacio entre cifra y unidad y no haya más texto dentro de `.kpi-value`.

**Textos visibles**
- «Hola, {nombre largo}.», «Última importación hace 9 días», «Ver los datos de la gráfica» (clicable), `img` `/Distancia y desnivel por mes, 12 periodos/` y `/…por semana/`, «Esta salida no tiene GPS, así que no tiene mapa.», «400,0 km», «5.870 m» y «14 h 25 min».

**Ejes de la gráfica**
- `.chart-canvas` tiene que contener «Desnivel (m)» y un número con punto de miles, y ningún número con coma de miles. Las etiquetas de los ejes, la burbuja y el tooltip tienen que pasar por `formatCount`, `formatKm` o `formatMeters`.

**Sin desplazamiento horizontal a 320 px**
- Lo comprueban el estado vacío, 5.000 salidas, un nombre de usuario que parece un correo, nombres en otros alfabetos y el informe de importación. El hero, la barra inferior y las tarjetas tienen que llevar `min-width: 0` y `overflow-wrap: anywhere`.
- El bug conocido de la tabla de 30 días (`test.fail`): al rediseñar las tarjetas con `grid-template-columns: minmax(0, 1fr)` y `overflow-x: auto` en `.chart details`, la prueba pasará. Entonces hay que quitar `test.fail`, o Playwright lo marcará como fallo.

**Rendimiento**
- Inicio tiene que pintarse en menos de 3 s con 5.000 salidas. Por eso las minigráficas van en SVG y ECharts sigue en carga diferida.

**Teselas**
- `page.route(/tile-cyclosm/, abort)`: la URL de las teselas tiene que seguir conteniendo `tile-cyclosm`.

**Base de datos**
- `indexedDB.open('ciclismo')`, con los almacenes `activities`, `settings` y `meta`: no se renombran.
