# FBikeTrain: sistema de diseño «Relieve grabado»

Versión final del rediseño. Parte de la dirección ganadora, b-identidad («Relieve grabado»), y le añade dos piezas. De a-fiel toma la densidad y la composición del panel de la inspiración: hero con paisaje, cuatro KPI de vidrio y tres filas de tarjetas. De c-datos toma la semántica de las gráficas: la discontinua es siempre «tu media» o «el periodo anterior», cada gráfica tiene vista de tabla y hay una frase resumen.

- Prototipo navegable: `docs/design/prototipo-final/` (abre `inicio.html` directamente con `file://`).
- Tokens: `docs/design/tokens.css`, listo para copiar a `src/ui/styles/tokens.css`.
- Recursos SVG: `docs/design/assets/`.
- Capturas: `docs/design/prototipo-final/capturas/` (las regenera `node docs/design/tools/shots-final.mjs`).
- Exportación de SVG: `node docs/design/tools/export-assets.mjs`.

Variantes del prototipo, por URL:

| Parámetro | Efecto |
|---|---|
| `?theme=light` o `?theme=dark` | Fuerza el tema (si no, se usa `localStorage` `fbt-theme` y, sin él, oscuro) |
| `?fase=1` | Solo lo que existe en F1: menú con Inicio, Importar y Ajustes; tercera fila con «Tu última salida» y «Tus datos»; el anillo mide la semana frente a tu media |
| `?estado=vacio` | Inicio sin salidas: el hero invita a importar y debajo aparecen los tres pasos para pedir el archivo |
| `rutas.html?modo=ia` | Rutas con IA (F5): explicación por ruta y aviso de qué datos ha visto la IA |
| `importar.html?estado=progreso` | Importación en curso |

## 1. Principios

1. **El paisaje es tu salida.** La cresta del hero se dibuja con el perfil real de tu última salida, y su cima lleva el vértice geodésico con la altitud. No hay fotos: el resto del paisaje (picos violetas, cielo y bruma) es decorado procedimental y hace de fondo.
2. **La luz solo va en el dato.** En oscuro brillan el trazado del mapa, la línea de la progresión, la cresta y el arco del objetivo, y nada más. Tarjetas, botones y menú usan sombras neutras. En claro no brilla nada: `--glow: 0` y `--thread: 0`.
3. **Te mides contra ti.** Cada cifra se compara con tu media o con tu periodo anterior. Subir va en verde con flecha y signo. Bajar va en tinta 2 con flecha, porque bajar no es un error, y nunca va en rojo. El rojo queda para los errores reales.
4. **Un solo momento orquestado.** Al cargar, el horizonte y la línea de progresión se dibujan en 900 ms. Después aparecen la burbuja del último punto y el rótulo de la cima. El resto de la interfaz no se anima al entrar.
5. **Cifras de dorsal.** Barlow Semi Condensed 700 para las cifras. La cursiva («dorsal») se reserva a la cifra titular de cada pieza.
6. **Nada inventado.** Solo aparecen los datos que tenemos: km, desnivel, tiempo en movimiento, velocidad media y máxima, cadencia, número de salidas y la variación frente a tu media. No hay calorías, ni frecuencia cardiaca, ni potencia. Lo que falta se pide (sección 12).

## 2. Tokens

Todos están en `tokens.css`. Los componentes no llevan hex sueltos. Los tokens marcados con [chart] los lee ECharts, así que van en hex o en `rgba()` con comas.

| Grupo | Tokens | Notas |
|---|---|---|
| Superficies | `--bg`, `--side`, `--surface`, `--surface-2`, `--surface-3`, `--glass`, `--glass-strong`, `--scrim` | De atrás hacia delante. El vidrio solo va sobre el paisaje (KPI) y en piezas flotantes (barra inferior, placa del mapa, barra de guardar) |
| Bordes | `--line`, `--line-strong` | `--line` para la rejilla y los separadores; `--line-strong` para los controles y el vidrio |
| Tinta | `--ink` (15,2:1), `--ink-2` (8,5:1), `--ink-3` (6,1:1) | Contraste sobre `--surface` en oscuro. En claro: 17,4, 8,9 y 5,9 |
| Acción y estado | `--action`, `--action-hover`, `--on-action`, `--focus`, `--link`, `--good(-bg)`, `--warning(-bg)`, `--critical(-bg)`, `--badge` | `--critical` solo para errores |
| Métricas | `--acc-dist`, `--acc-elev`, `--acc-time`, `--acc-speed`, `--trace` | Un acento por métrica en todo el producto: icono, pastilla, chispa y línea |
| Pendiente | `--g0` … `--g5` | Escala ordinal del libro de ruta: llano o bajada; 1–4 %; 4–7 %; 7–10 %; 10–16 %; 16 % o más |
| Dificultad | `--easy-*`, `--mid-*`, `--hard-*` | Texto sobre su fondo, AA |
| Paisaje | `--sky-0` … `--sky-4`, `--haze`, `--orb`, `--orb-glow`, `--stars`, `--star`, `--ridge-1` … `--ridge-4` (y sus alias `--ridge-far`, `--ridge-mid`), `--ridge-near`, `--ridge-line`, `--mist`, `--road`, `--road-edge`, `--road-dash`, `--hero-scrim`, `--contour` | Noche con luna, estrellas y horizonte malva en oscuro; amanecer saturado melocotón y oro, con sol, en claro. `--stars` es 1 en oscuro y 0 en claro. Las crestas van de la más lejana (`--ridge-1`, la más clara) a la más cercana: perspectiva atmosférica |
| Logotipo | `--hito`, `--hito-stroke`, `--hito-band`, `--hito-ink` | Hito kilométrico |
| Luz y sombra | `--glow`, `--thread`, `--shadow-card`, `--shadow-float`, `--shadow-sheet` | `--glow` multiplica los halos; `--thread` es el hilo blanco del trazado |
| Mapa | `--map-filter`, `--map-tint`, `--map-under` | El filtro va solo sobre `.leaflet-tile-pane`; el tinte multiplica encima de las teselas (sección 6) |
| Marcas | `--track` | Carril de anillos y barras: 3:1 sobre `--surface` en los dos temas (#5B6B8C da 3,24:1 en oscuro; #8290A8, 3,23:1 en claro), WCAG 1.4.11 |
| Tipografía | `--font-ui`, `--font-fig`, `--fs-*` | Ver sección 3 |
| Espacio | `--s-1` … `--s-10` (base 4), `--gap` 12, `--pad` 20 (16 en móvil) | |
| Radios | `--r-xl` 22, `--r-lg` 16, `--r-md` 12, `--r-sm` 8, `--r-pill` | Por jerarquía: hero y tarjetas, KPI y mapa, controles, chips |
| Medidas | `--side-w` 232, `--side-w-rail` 84, `--tabbar-h` 64, `--target` 44, `--target-tab` 48 | |
| Movimiento | `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--dur-press` 160, `--dur-fast` 200, `--dur-ui` 240, `--dur-sheet` 320, `--dur-draw` 900, `--dur-bubble` 260 | |

### Tema

Un script en línea en `<head>`, antes de las hojas de estilo, pone `data-theme` en `<html>` y así evita el destello. Orden de prioridad: el parámetro `?theme=`, luego `localStorage` `fbt-theme`, y si no hay nada, `dark`. El conmutador está en el menú lateral, en la hoja «Más» del móvil y en Ajustes, y avisa a quien lo escuche (ECharts, Leaflet y el hero se vuelven a pintar).

**Decisión abierta:** una tercera opción, «Sistema», que siga `prefers-color-scheme`. El prototipo no la incluye porque el oscuro es la identidad. Si se añade, el script previo solo cambia en el último paso.

## 3. Tipografía

Fuentes autoalojadas con `@fontsource` (dependencias por pedir, sin instalar): `@fontsource/barlow` (400, 500, 600) y `@fontsource/barlow-semi-condensed` (600, 700 y 700 italic). El prototipo carga los mismos woff2 desde `prototipo-final/fonts/`.

| Uso | Familia y peso | Tamaño |
|---|---|---|
| Saludo del hero | Semi Condensed 700 | `--fs-hello`, clamp(34–56 px) |
| Título de página | Semi Condensed 700 | `--fs-page`, clamp(30–40 px) |
| Cifra KPI | Semi Condensed 700 italic | 32 px (26 en móvil), unidad a 17 px en 600 |
| Cifra de lista (Rendimiento) | Semi Condensed 700 | 26 px |
| Nombre de ruta | Semi Condensed 600 | 19 px |
| Título de tarjeta | Barlow 600 | 17 px |
| Texto | Barlow 400 | 15 px |
| Metadatos y ayudas | Barlow 500 | 13,5 px |
| Ejes, leyendas y chips | Barlow 500 o 600 | 12 px como mínimo |

Reglas:
- Nada por debajo de 12 px. El script de capturas lo comprueba.
- Cifras con `font-variant-numeric: tabular-nums`.
- Formato `es-ES`: punto de miles, coma decimal y espacio fino antes de `%` y de las unidades.
- El signo menos es U+2212.
- Sin mayúsculas sostenidas en las etiquetas.
- La cursiva va solo en la cifra titular de cada pieza: el KPI, la burbuja, el anillo, la cima del hero, el bloque de fecha y la primera ruta.

## 4. Iconos (lucide)

`lucide-react` (por pedir), con trazo de 2 px y tamaños de 20, 16 y 15 px. Si el icono acompaña a un texto lleva `aria-hidden`; si va solo, el botón lleva `aria-label`.

| Concepto | Icono |
|---|---|
| Inicio | `house` |
| Historial | `chart-column` |
| Subidas | `mountain` |
| Calendario y próximas salidas | `calendar` |
| Rutas | `route` |
| Rutas con IA | `sparkles` |
| Importar y restaurar | `upload` |
| Ajustes | `sliders-horizontal` |
| Avisos | `bell` |
| Buscar | `search` |
| Más | `ellipsis` |
| Distancia | `bike` |
| Desnivel | `mountain` |
| Tiempo | `timer` |
| Velocidad | `gauge` |
| Cadencia | `rotate-cw` |
| Salida más larga | `milestone` |
| Rendimiento | `activity` |
| Progresión | `trending-up` |
| Objetivo | `target` |
| Editar | `pencil` |
| Última salida | `map-pin` |
| Pantalla completa | `maximize` |
| Acercar y alejar | `plus` y `minus` |
| Sube y baja | `arrow-up` y `arrow-down` |
| Descargar GPX o copia | `download` |
| Copia de seguridad | `archive` |
| Fichero | `file-text` |
| Borrar | `trash-2` |
| Clave | `key-round` |
| Mostrar clave | `eye` |
| Privacidad | `shield-check` |
| Aviso | `triangle-alert` |
| Error | `circle-alert` |
| Información | `info` |
| Hecho | `circle-check` |
| Cargando | `loader-circle` |
| Perfil | `user` |
| Apariencia | `palette` |
| Tema oscuro y claro | `moon` y `sun` |
| Ordenar | `arrow-up-down` |
| Circular | `repeat` |
| Ida y vuelta | `arrow-left-right` |
| Ver como tabla | `table` |
| Resumen de la semana | `flag` |
| Importaciones anteriores | `refresh-cw` |

La dificultad se marca con tres barras propias (`bars1` a `bars3`, de una a tres llenas), no con un icono de lucide. Así no depende solo del color.

## 5. Componentes

Cada componente se describe con su anatomía, sus estados y dónde está en el prototipo.

### AppShell

- **Anatomía:** `Sidebar` (232 px; carril de 84 px entre 900 y 1279 px), contenido con un máximo de 1400 px y, en móvil, `BottomTabBar`.
- **Fase:** los nodos con `data-f="N"` aparecen a partir de la fase N (lo hace `shell.js`). En React será una prop o una comprobación de la fase activa.
- **Atajo:** «/» lleva el foco al buscador visible.
- **Prototipo:** `shell.js`.

### Sidebar

- **Anatomía:** logotipo (hito y «FBikeTrain»); navegación de 8 entradas con un separador antes de Importar; tarjeta de importación con curvas de nivel («Importaste hace 3 días», «13 salidas nuevas desde Strava» y el botón Importar; sin salidas, «Aún no has importado salidas», «Sube el archivo que te envía Strava.» y «Importar salidas»); `ThemeToggle`; versión.
- **Estados de entrada:** reposo en tinta 2; hover sobre `--surface-2`; actual en `--action` con texto blanco y `aria-current="page"`, sin halo de color; foco con el anillo `--focus`.
- **Etiqueta «IA»:** la lleva «Rutas con IA».
- **En Importar:** la tarjeta de importación se oculta.
- **En F1:** solo aparecen Inicio, Importar y Ajustes.

### BottomTabBar

- **Cuándo:** por debajo de 900 px.
- **Anatomía:** 5 pestañas de 48 px como mínimo: Inicio, Historial, Rutas, IA y Más. En F1 son Inicio, Importar y Más.
- **Pestaña actual:** pastilla de `--action` al 18 % y texto `--link`.
- **«Más»:** abre un `dialog.sheet` desde abajo (320 ms, `--ease-drawer`) con Subidas, Calendario, Importar, Ajustes y el tema.
- **Estilo:** vidrio fuerte y `env(safe-area-inset-bottom)`.

### ThemeToggle

Control segmentado de dos opciones, Oscuro y Claro, con icono y texto, cada una con `aria-pressed`. Persiste en `localStorage`. Mismo componente en el menú, en la hoja «Más» y en Ajustes.

### Hero con SceneSvg

- **A sangre:** la escena ocupa todo el hero, detrás del saludo, la barra superior y las KPI. Un velo radial `--hero-scrim` detrás del texto garantiza el contraste AA.
- **Anatomía (de atrás hacia delante):**
  1. Cielo en degradado `--sky-0`…`--sky-4` hasta el horizonte y bruma cálida `--haze`.
  2. Estrellas (solo en oscuro, con la opacidad `--stars`).
  3. **Luna o sol** (`--orb`) con su halo (`--orb-glow`), justo detrás de la cima.
  4. **Cuatro crestas** de fondo con perspectiva atmosférica (`--ridge-1` … `--ridge-4`, cada una más oscura y más baja), cada una con una bruma `--mist` que se come su base.
  5. **Cresta cercana**, que es el perfil real de la última salida suavizado, con curvas de nivel grabadas (`--contour`).
  6. **Carretera** en primer plano que sube en zigzag hasta la cima: una curva de herradura por cada subida del perfil (`climbs`), así que el zigzag cuenta la salida. Borde `--road-edge`, firme `--road` y línea discontinua `--road-dash`; se estrecha con la distancia.
  7. **Línea de luz** en tres capas: halo `--ridge-line` × `--glow`, núcleo e hilo blanco × `--thread`.
- **Texto:** fecha, «Hola, Fran» y una frase con la cifra en negrita.
- **Rótulo de la cima:** vértice geodésico (triángulo), cota en cifra de dorsal y «cima de tu última salida, km N». Se coloca a la izquierda o a la derecha de la cima según dónde no choque con el texto ni con la barra superior. En anchos medios la cima baja lo justo para que el rótulo quepa.
- **Barra superior:** buscador local (F2), avisos y avatar. La campana solo aparece si hay avisos y se llama «Avisos, N avisos». Los avisos de F1 son locales: importación con más de 7 días («Última importación hace N días.», «Importar salidas nuevas») y copia más antigua que la última importación («Tienes salidas importadas después de tu última copia, de hace 12 días.», «Hacer copia»). Con los datos de ejemplo solo salta el de la copia.
- **KPI:** 4 `KpiCard` de vidrio apoyadas en el pie del paisaje.
- **Estados:** con datos; F1 (sin búsqueda); vacío (sin rótulo, KPI ni campana, con el botón «Importar salidas» y un perfil fijo de decorado; la ilustración se mantiene entera, y en el móvil el hero vacío mide al menos 560 px); claro (amanecer melocotón y oro, sol, sin estrellas, línea sólida sin halo).
- **Móvil:** el hero sangra hasta los bordes, la marca va arriba a la izquierda, la cresta se dibuja bajo el texto y las KPI forman una cuadrícula de 2 x 2.
- **Recursos:** `assets/hero-oscuro.svg`, `hero-claro.svg`, `fondo-movil-oscuro.svg` y `fondo-movil-claro.svg`, exportados con los tokens ya resueltos. En la app la escena se genera en vivo con el perfil de cada salida, y los SVG sirven de respaldo y para documentación.

### KpiCard con Sparkline

- **Es un botón** (`aria-pressed`, `aria-controls` hacia «Tu progresión»): las KPI eligen la métrica de la gráfica. La seleccionada lleva el borde y un halo interior de su acento y un icono de tendencia; las demás muestran ese borde al pasar el puntero.
- **Anatomía:**
  - icono en una pastilla del acento al 18 %;
  - etiqueta;
  - cifra de dorsal y unidad;
  - `delta`: flecha, signo, porcentaje y «vs tu media» (texto oculto a la vista por debajo de 1280 px; los lectores de pantalla lo siguen leyendo);
  - chispa de 8 semanas con el área en degradado, la media en discontinua `--ink-3` y el último punto con anillo.
- **Estados:** sube (`--good`); baja (`--ink-2`); sin referencia («Sin referencia aún», sin flecha); semana a 0 («0 km», con la chispa visible).
- **Datos:** `currentWeekVsAverage` y `aggregate(acts, 'week', 8)`. La velocidad necesita D1.

### Panel (tarjeta)

- **Anatomía:** `card-h` (icono del acento, `h2` de 17 px sin salto de línea y una acción a la derecha: «Ver detalle», «Todas» o editar), `card-sub` opcional que dice una sola vez frente a qué se compara, y el cuerpo.
- **Estilo:** `--surface`, borde `--line`, `--r-xl`, `--shadow-card` y relleno `--pad`.
- **Variante:** `.danger-zone` con el borde teñido de `--critical`.

### SegmentedControl

- **Anatomía:** `div[role=group]` con botones `aria-pressed` y un indicador `.ind` que se desplaza con `transform` en 240 ms `--ease-out`.
- **Variantes:** `.ranges` (12 meses, 6 meses, 3 meses y 30 días; en Historial, 3 meses, 12 meses y Todo) y `.seg` (tema).
- **Foco:** contorno y halo de `--focus` al 22 %.
- **Evento:** `segchange`.

### ProgressChart (Tu progresión)

- **Anatomía:**
  - título y, a su derecha, los rangos (en el móvil, una sola fila con desplazamiento horizontal);
  - una línea con la frase resumen («**Distancia.** 6.677 km en 12 meses, un 15 % más que en los 12 anteriores.») y la leyenda en línea: continua «12 meses» y discontinua «Los 12 anteriores»;
  - gráfica ECharts de 268 px (220 en el móvil);
  - «Ver como tabla», que despliega una tabla con periodo, actual, anterior y diferencia.
- **Métrica:** no hay pastillas. La eligen las `KpiCard` del hero, y la gráfica toma el color de su acento.
- **Nota del periodo** («Meses completos. Noviembre va en tus cifras de la semana.»): va al pie del tooltip y en el `caption` de la tabla, no como texto suelto.
- **Reglas:** solo periodos completos. 12 meses va por meses; 6 y 3 meses, por semanas completas; 30 días, acumulado diario.
- **Burbuja:** el último punto lleva una burbuja con la cifra en cursiva y una línea de caída punteada.
- **Tooltip:** periodo, actual, anterior y porcentaje.
- **Estados:** cargando (la línea se dibuja en 900 ms); cambio de rango o de métrica (280 ms, sin redibujar); menos de 2 periodos («Con 2 meses de salidas verás tu tendencia», con la gráfica en gris); movimiento reducido (sin animación).

### PerformanceCard (Tu rendimiento)

- **Anatomía:** `card-sub` con «Últimos 30 días. La barra es tu rango de 12 meses.» y 4 filas.
- **Cada fila:** icono del acento, etiqueta, delta o contexto («en 5 de 13 salidas», «el 18 de octubre»), cifra y una **barra de rango** (`RangeBar`):
  - la barra, de 4 px en el acento al 100 %, es tu rango de 12 meses;
  - tu media es una marca de 3 × 14 px en `--ink` con anillo `--surface`;
  - los últimos 30 días, un punto de 12 px en `--ink` con anillo del acento;
  - todas pasan 3:1 (WCAG 1.4.11).
- **Etiquetas en línea**, sin leyenda aparte: debajo de la barra, a 12 px, el mínimo, «media 820 m» anclada a su marca y el máximo. Si la media está por debajo del 22 % se oculta el mínimo; por encima del 78 %, el máximo.
- **Filas:** velocidad media, desnivel por salida, cadencia media y salida más larga.
- **Cadencia:** la fila se oculta si ninguna salida tiene cadencia. Datos: D3.

### WeekBar (Tu semana, F1)

- **Por qué:** en F1 no hay objetivos, y un anillo «frente a tu media» pasaba del 100 % sin poder dibujarlo. Una barra sí puede rebasar la marca.
- **Anatomía:** `Panel` «Tu semana» con el icono de bici en `--acc-dist` y **sin lápiz**; subtítulo «Distancia de esta semana frente a tu semana media»; cifra en dorsal cursiva («214 km»); «de una semana media de 191 km»; barra de 8 px con carril `--track`, relleno `--acc-dist`, marca de la media (3 × 22 px, `--ink`) y marca del ritmo esperado (más corta, `--ink-3`); etiquetas en línea «media 191» y «a estas alturas, 136»; y dos líneas: «Un 12 % por encima de tu semana media» (`--good`) y «Quedan 2 días de semana».
- **Escala:** llega a `max(hecho, media) × 1,12`.
- **Accesibilidad:** la barra es `role="img"` con todo en su nombre.
- **Prototipo:** `inicio.html?fase=1` (`renderWeek`).

### GoalRing (Tu objetivo, desde F3)

- **Anatomía:**
  - anillo de 192 px (R 76) con el carril en `--track` (3:1), curvas de nivel concéntricas, el arco en `--good` con halo × `--glow` y una muesca en el ritmo esperado;
  - en el centro, **en HTML superpuesto** (no texto del SVG, para que no encoja con el anillo): el porcentaje en dorsal a 40 px y «214 de 800 km» a 13 px;
  - el título y tres líneas: el estado («Vas 7 puntos por delante del ritmo»), el ritmo esperado y los días que quedan.
- **Estados:** por delante (`--good`, `trending-up`); por detrás (`--ink-2`, sin rojo); conseguido (arco completo y `circle-check`).
- **Móvil:** la tarjeta va a todo el ancho, con el anillo de 168 px a la izquierda y el título y **las tres líneas** a la derecha.

### UpcomingList (Próximas salidas, F3)

- **Anatomía de cada fila:** bloque de fecha con forma de **hito kilométrico** (banda azul con el día de la semana, número en dorsal y mes), título, km, m, chip de dificultad y mini forma de la ruta (si no hay ruta enlazada, un icono de calendario).
- **Pie:** «Próximos 7 días: 3 salidas, 206 km. Un 8 % más que tu semana media.»
- **Móvil:** solo la próxima, con «Mañana, sábado 7» y el mapa de la forma más grande.
- **Antes de F3:** la tarjeta no aparece.
- **Datos:** la forma necesita D6.

### RideMapCard con perfil (Tu última salida)

- **Anatomía:**
  - cabecera con la fecha relativa («Ayer, jueves 5 de noviembre») y «Ver detalle»;
  - mapa Leaflet con CyclOSM;
  - **placa de vidrio** con km, m, tiempo y km/h, cada cifra con el icono de su acento (en móvil va bajo el mapa);
  - controles para acercar, alejar y pantalla completa (44 px);
  - insignia de dificultad (F4, D5);
  - perfil por pendiente a todo el ancho, con ejes en km, la cota máxima y una leyenda que solo muestra las clases presentes.
- **Estados:** cargando teselas (`--map-under` y una textura de carreteras SVG); sin GPS («Esta salida no tiene GPS, así que no tiene mapa», con las cifras y sin perfil); sin salidas (la tarjeta no aparece).

### RouteCard

- **Anatomía:**
  - **miniatura de la forma**: el trazado luminoso de la ruta sobre curvas de nivel, con un punto de salida; 148 px en Rutas y 100 % de ancho en móvil. La forma sale del trazado, proyectado, ajustado a la caja y simplificado con **Douglas-Peucker**, así que es la misma geometría que el mapa: la miniatura de «Montseny por Seva» en Historial es el lazo con cola de «Tu última salida». Cada ruta tiene la suya (lazo con cola, ida y vuelta con los dos sentidos separados, ocho, costa alargada, triángulo...);
  - título en Semi Condensed 600 y metadatos con km, m y tiempo a tu ritmo;
  - chips: dificultad para ti y «74 % carretera nueva»;
  - en F5, el porqué en una nota violeta (`--acc-elev`);
  - **perfil coloreado por pendiente** con la cota máxima;
  - acciones: «Descargar GPX» y «Ver ruta» o «Ver en el mapa».
- **La mejor:** borde `--action` al 50 %, chip «La que mejor encaja», cifra en cursiva y botón principal.
- **En Inicio (variante `feature`):**
  - una franja visual de 176 px: la forma grande sobre curvas de nivel en la mitad derecha y, a la izquierda sobre un velo, el chip de dificultad, el nombre, km, m, tiempo y una línea de por qué;
  - «Descargar GPX» como botón de icono de 40 px en la esquina de la franja («Descargar GPX de Circular por el Montseny»);
  - el perfil por pendiente a todo el ancho (la leyenda queda para lectores de pantalla);
  - **una sola acción principal**, «Ver ruta», a todo el ancho;
  - dos alternativas compactas: forma de 36 px, nombre, km, m y la dificultad como texto con sus barras, sin chip, y un chevrón.
- **Sin fotos de stock, nunca.**
- **Datos:** `GeneratedRoute`. En Inicio necesita D6.

### EmptyState

- **Anatomía:** icono en una caja de 44 px, título, una frase que dice qué hacer y la acción.
- **Tono:** en la voz de la interfaz, sin disculpas.
- **Casos:**
  - Inicio sin salidas: el hero con «Importar salidas» y la tarjeta «Cómo conseguir tu archivo de Strava», con 3 pasos numerados (aquí sí son una secuencia).
  - Historial sin coincidencias: «Ninguna salida coincide con la búsqueda.»
  - Rutas sin clave: «Configura tu clave de rutas en Ajustes».

### Dropzone

- **Anatomía:** `label` que envuelve un `input[type=file]` accesible con teclado. Lleva un icono de subida de 64 px, el título «Suelta aquí tu archivo de Strava», la ayuda, los chips de formato (.zip, .fit, .gpx, .tcx, .gz) y el botón «Elegir archivo». El botón es la alternativa de un solo toque al arrastre (WCAG 2.5.7).
- **Fondo:** curvas de nivel tenues.
- **Estados:** reposo (borde discontinuo `--line-strong`); arrastrando (`data-over="true"`: borde continuo `--focus` y fondo con `--action` al 9 %); foco (contorno de 2 px); leyendo («Leyendo tu archivo. Puedes soltar más ficheros: entrarán cuando acabe este.»).
- **Móvil:** una columna y el botón a todo el ancho.

### ImportReport

- **En curso:**
  - fila del fichero (nombre, tamaño y Cancelar);
  - porcentaje en dorsal y «812 de 1.310 actividades»;
  - barra `role=progressbar` con `aria-valuenow`;
  - pasos: hecho, actual (`aria-current="step"`) y pendiente.
- **Terminado:**
  - resumen en 4 cifras: `added` («salidas nuevas», en verde y cursiva), `duplicates` («ya estaban, no se duplican»), `notCycling` y `tooShort`;
  - lista de incidencias, cada una con icono, causa y acción: `triangle-alert` en `--warning`, `circle-alert` en `--critical` e `info` en tinta 3;
  - acciones: «Ver las N salidas nuevas» e «Ir a Inicio».
- **Al lado:** cómo conseguir el archivo e importaciones anteriores.
- **Datos:** `ImportReport` (`added`, `duplicates`, `notCycling`, `tooShort`, `skipped[]`) cubre el resumen y los ficheros sin leer. Los avisos «sin GPS», el de cadencia y los pasos con fase necesitan D8.

### Formulario de Ajustes

- **Anatomía:** índice de secciones fijo (oculto por debajo de 1024 px) con la sección actual marcada (`aria-current`). Secciones: Perfil, Apariencia, Rutas (F4), Copia de seguridad y Borrar datos.
- **Campos:**
  - cada campo tiene una etiqueta visible y una ayuda debajo; el error va junto al campo, con icono y `aria-invalid` y `aria-describedby`;
  - la clave tiene botón para mostrarla u ocultarla con `aria-pressed`;
  - los interruptores son `role=switch`;
  - Casa se muestra como «Punto de salida guardado», nunca la dirección, y el texto dice que no se envía a la IA.
- **Copia de seguridad:** dos bloques, «Descargar copia» (un .json sin claves) y «Restaurar» (junta la copia sin duplicar), y una nota de privacidad.
- **Barra de guardar:** fija abajo, con vidrio, «1 cambio sin guardar», Descartar y «Guardar cambios». La confirmación usa el mismo verbo: «Cambios guardados».
- **Zona de peligro:** «Borrar todo». En la app pide confirmación en un `dialog` (el prototipo no la incluye).

### Historial (avance de F2)

- **Barra de herramientas:** búsqueda local (filtra por nombre y zona; «/» le da el foco), segmentado de periodo y orden (recientes, más largas, más desnivel o más rápidas).
- **Resumen del mes:** «Noviembre hasta hoy, frente a tu media a día 6», con 4 cifras y su delta.
- **Tabla:** agrupada por mes con totales en la cabecera de grupo. Columnas: fecha, salida (mini forma, nombre y zona), distancia, desnivel, tiempo, velocidad media, cadencia («sin dato» si no hay sensor) y dificultad para ti. Cifras alineadas a la derecha y en tabulares. Lleva `caption` oculto.
- **Móvil:**
  - sin subtítulo ni etiqueta de fase;
  - **una sola fila de herramientas**: lupa de 44 px que despliega el buscador en la misma fila (con «Cerrar la búsqueda» y Esc), el periodo como segmentado y el orden como botón de icono con el `select` nativo encima;
  - las 4 cifras del mes en **una tira horizontal compacta** dentro de una sola tarjeta («Tiempo» en lugar de «En movimiento», «3,2 de media»);
  - tarjetas de salida con la forma de 48 px, ya visibles en la primera pantalla.

### Rutas (avance de F4 y F5)

- **Generador** (fijo en escritorio):
  - modo Generar o Con IA, botones con `aria-pressed`;
  - salida desde Casa;
  - distancia y desnivel con `input[type=range]` y `output`; la ayuda da tu media («Tu salida media: 74 km»);
  - circular o ida y vuelta;
  - «Priorizar carretera nueva»;
  - botón «Generar 5 rutas» o «Pedir 5 rutas a la IA».
- **Resultados:** lista ordenada de `RouteCard`. En modo IA, una nota previa dice qué ha visto la IA (cifras resumidas, nunca tracks ni Casa).
- **Móvil con resultados:** el formulario se pliega en una barra resumen «90 km · 1.500 m · Circular · Editar» y las rutas van primero. «Editar» (con `aria-expanded`) despliega el formulario; al generar se vuelve a plegar y el foco pasa al título de los resultados.

## 6. Mapa oscuro y trazado luminoso

- **Teselas:** CyclOSM (`https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`), con la atribución «CyclOSM | © OpenStreetMap».
- **Oscuro:** se aplica `filter: var(--map-filter)` **solo** a `.leaflet-tile-pane`, con `invert(1) hue-rotate(200deg) brightness(0.7) contrast(1.1) saturate(0.25)`. Así el trazado, los marcadores y los controles no se invierten. En claro el filtro es `none`.
- **Tinte azul noche:** un pane propio, `map.createPane('tint')` con `zIndex` 250 (entre teselas, 200, y trazados, 400), `mix-blend-mode: multiply` y `pointer-events: none`, con un `div.map-tint` de 10.000 px en `--map-tint`. En oscuro es `#A9BEF2`: más oscuro, los rótulos de las poblaciones («Terrassa», «Castellar del Vallès») dejan de leerse. En claro es blanco y no cambia nada.
- **Fondo:** `--map-under` y una textura de carreteras SVG mientras cargan las teselas.
- **Trazado:** tres polilíneas sobre la misma geometría:
  1. halo: `--trace`, 9 px, opacidad 0,55 × `--glow`;
  2. núcleo: `--trace`, 3 px;
  3. hilo: blanco, 1 px, opacidad 0,85 × `--thread`.
- **Salida:** un `circleMarker` en `--good` con borde blanco de 2,5 px.
- **Encuadre:** `fitBounds` con 150 px de margen a la izquierda en escritorio, para dejar sitio a la placa, y 24 px en móvil.
- **Placa de cifras:** vidrio fuerte, y en móvil va fuera del mapa.
- **Controles:** botones de 44 px con `aria-label`. La rueda del ratón no hace zoom (`scrollWheelZoom: false`), para no atrapar el desplazamiento de la página. En móvil el arrastre también está desactivado.
- **Privacidad:** el repositorio no guarda tracks reales. El prototipo usa la forma sintética «montseny» de `shell.js` pasada a grados (la longitud se estira 1/cos(41,7°)).
- **Miniaturas:** las formas de las tarjetas usan las mismas tres capas en SVG (`.shape-halo`, `.shape-core` y `.shape-thread`) y curvas de nivel con `--contour`. En el prototipo, `SHAPES` guarda puntos de control dibujados a mano; `shapeDense` los suaviza (Catmull-Rom) y les añade las curvas de la carretera; `shapePoints` los ajusta a la caja y los simplifica con Douglas-Peucker.

## 7. Tema de ECharts

ECharts 5 con `renderer: 'svg'`. El tema se construye en tiempo de ejecución leyendo los tokens con `getComputedStyle` (de ahí la regla de hex y `rgba`), y se vuelve a pintar al cambiar de tema.

| Parte | Valor |
|---|---|
| Fuente | `--font-ui`; las cifras del tooltip y de la burbuja en `--font-fig` |
| Grid | `left: 4, right: 16, top: 52, bottom: 2, containLabel: true` |
| Ejes | Etiquetas `--ink-3` a 12 px; línea del eje X en `--line`; sin marcas; Y con `splitNumber: 3` y la rejilla en `--line` |
| Serie actual | Curva suave de 0,35 y `smoothMonotone: 'x'`; 2,8 px del acento de la métrica; `shadowBlur` de 14 solo si `--glow` > 0; área en degradado del acento (0,34 en oscuro y 0,2 en claro, hasta 0) |
| Serie anterior o media | 1,6 px `--ink-3` discontinua `[5, 4]`, sin interacción |
| Último punto | `markLine` punteada del acento al 60 % hasta el eje y `markPoint` con burbuja: borde del acento, fondo `--surface`, cifra en cursiva de 18 px y retardo de 900 ms |
| Tooltip | `trigger: 'axis'`, fondo `--surface-2`, borde `--line-strong`, radio de 12, puntero de línea en `--line-strong`; filas «Actual» y «Periodo anterior», el porcentaje en `--good` o `--ink-2` y, al pie, la nota del periodo |
| Animación | 900 ms `cubicOut` solo en la primera carga; 280 ms al actualizar; 0 con movimiento reducido |
| Accesibilidad | `aria-label` en el contenedor con la frase resumen, y la tabla equivalente en «Ver como tabla» |

Perfiles por pendiente (última salida, rutas e historial): SVG propio y no ECharts. Es un único `path` con un degradado horizontal de paradas duras por tramo `--g0`…`--g5`, un borde `--ink` al 50 %, ejes en km, la cota máxima en cursiva y un tooltip al pasar el puntero («km 52,0, 992 m, 8,4 %»). La leyenda solo lleva las clases presentes.

## 8. Movimiento

| Qué | Cómo | Con movimiento reducido |
|---|---|---|
| Carga de Inicio (el único momento orquestado) | El horizonte y la línea de progresión se dibujan con `stroke-dashoffset` en 900 ms `--ease-out`; después la burbuja (260 ms) y el rótulo de la cima | Todo aparece de golpe, sin trazo; solo un fundido de 200 ms |
| Pulsar | `scale(.97)` en 160 ms `--ease-out` en botones, filas y tarjetas enlazadas | Se mantiene, porque es una respuesta y no un desplazamiento |
| Hover | Color o fondo en 200 ms, solo con `(hover: hover) and (pointer: fine)` | Igual |
| Segmentado | El indicador se desplaza con `transform` en 240 ms | Sin transición |
| Hoja «Más» | `translateY(100%)` a 0 en 320 ms `--ease-drawer`; el fondo hace un fundido | Solo fundido |
| Interruptor | La bola se desplaza 18 px en 240 ms | Sin transición |
| Importando | Icono `loader-circle` girando en 1,1 s lineal; en la app la barra avanza con `transform: scaleX` | Sin giro; la barra salta |
| Cambio de rango o métrica | ECharts en 280 ms | 0 ms |

No hay entradas escalonadas por tarjeta ni animaciones en acciones de teclado. Solo se animan `transform`, `opacity` y `stroke-dashoffset`.

## 9. Accesibilidad (WCAG 2.2 AA)

- **Contraste:** el texto cumple 4,5:1 y los iconos y bordes de control, 3:1, en los dos temas (ver la sección 2). Sobre el paisaje, el texto va en el cielo oscuro (o claro) o con una sombra de texto del color del cielo.
- **Color:** nunca es la única pista. Los deltas llevan flecha y signo, la dificultad lleva barras y texto, la pendiente tiene leyenda con rangos, y la serie anterior es discontinua además de gris.
- **Teclado:** enlace «Saltar al contenido», foco visible en todo, el buscador con «/», la hoja como `dialog` modal (Esc la cierra) y los avisos como `popover`.
- **Objetivos táctiles:** 44 px como mínimo y 48 px en las pestañas.
- **Gráficas:** frase resumen, `aria-label` y tabla equivalente. Los perfiles llevan `role="img"` con una descripción.
- **Formularios:** etiquetas visibles, ayuda y error asociados, `aria-invalid` y errores escritos como acción.
- **Avisos:** la campana se llama «Avisos, N avisos» («1 aviso» en singular) y no aparece sin avisos. La importación usa `role=progressbar` y la cuenta de resultados es `aria-live`.
- **Marcas no textuales:** carriles, barras de rango, marcas de media y puntos pasan 3:1 sobre la tarjeta (`--track`, acento al 100 %, `--ink`).
- **Colores forzados:** los bordes pasan a `CanvasText` y el trazado a `Highlight`.
- **Idioma:** `lang="es"` y textos en castellano, sin emojis.

## 10. Adaptación a nuestros recursos

Qué cambia frente a la inspiración y por qué.

| En la inspiración | En FBikeTrain | Motivo |
|---|---|---|
| Foto de montaña en el hero | Paisaje SVG procedimental con la cresta de tu última salida | Sin fotos de stock; el paisaje es tuyo |
| Calorías y frecuencia cardiaca | Velocidad media, cadencia y desnivel por salida | No hay esos datos |
| Fotos en las rutas | Forma luminosa y perfil por pendiente | Lo pide el brief y lo permiten los datos |
| Mapa satélite oscuro | CyclOSM con filtro solo en las teselas | Libre, ciclista y sin clave |
| Notificaciones push y buscador global | Avisos locales (importación, próxima salida) y búsqueda local en Historial | Web estática, sin servidor |
| Objetivo semanal del servicio | F1: tu semana frente a tu media; F3: objetivo propio | Los objetivos llegan en F3 |
| Iconos y fuentes de CDN | lucide y `@fontsource` autoalojados | GitHub Pages, sin terceros en ejecución |

**Visibilidad por fase.** Las tarjetas sin datos no aparecen. No hay «próximamente» en Inicio.

| Fase | Qué aparece |
|---|---|
| F1 | Hero y KPI, Progresión, Rendimiento, el anillo de semana, Última salida, «Tus datos», Importar y Ajustes |
| F2 | Historial, Subidas, búsqueda y perfil por pendiente propio (D4) |
| F3 | Calendario, Próximas salidas y objetivo propio |
| F4 | Rutas, la tarjeta de rutas en Inicio (D6), insignias de dificultad (D5) y la sección Rutas en Ajustes |
| F5 | Rutas con IA, la explicación y la clave de IA |

**Datos sintéticos** del prototipo: hoy es viernes 6 de noviembre de 2026. La última salida fue el jueves 5 (87,6 km, 1.542 m, 3 h 12 min y 27,4 km/h). La salida más larga, de 112 km, fue el 18 de octubre. Las próximas son el sábado 7, el domingo 8 y el martes 10. El lazo del mapa es inventado.

## 11. Pasar a React

- **Estilos:** copia `tokens.css` a `src/ui/styles/`, importado antes que el resto. El script del tema va en línea en `index.html`.
- **Componentes:** uno por cada pieza de la sección 5. Las formas y los perfiles van en componentes SVG puros, memorizados por el id de la salida y el ancho. El ancho se mide con `ResizeObserver` y un rebote de 60 ms.
- **ECharts:** el tema sale de una función `chartTheme()` que lee los tokens. Hay que cargar ECharts y Leaflet de forma diferida (`React.lazy`), porque solo los usan Inicio y Rutas.
- **Fuentes e iconos:** `@fontsource` (solo los subconjuntos `latin`) e iconos de `lucide-react` importados uno a uno.
- **Prototipo:** no se copia `shell.js`, que es un apaño del prototipo. Su lógica de fase y de tema pasa a contexto y rutas.

## 12. Peticiones de datos

No se tocan `src/import`, `src/metrics` ni `src/db`. Estas son las peticiones:

| Id | Qué | Para qué | Quién | Fase |
|---|---|---|---|---|
| D1 | `currentWeekVsAverage`: añadir `deltaPct.speed` y `deltaPct.rides` | KPI de velocidad y la frase del hero | `cycling-metrics-analyst` | F1 |
| D2 | `periodMean(periods, key)` o la serie del periodo anterior junto a `aggregate` | La discontinua de la progresión y de las chispas | `cycling-metrics-analyst` | F1 |
| D3 | Por periodo: desnivel medio por salida, cadencia media ponderada (ignorando las salidas sin cadencia, `undefined` si ninguna la tiene), velocidad máxima, salida más larga y el rango de 12 meses de cada una | Tu rendimiento (cifras y barras de rango) | `cycling-metrics-analyst` | F1 |
| D4 | `gradeSegments(profile)`, con tramos `{ fromM, toM, gradePct, cls }` y las clases de pendiente | Perfil por pendiente de las salidas propias y la cresta del hero | `cycling-metrics-analyst` | F2 |
| D5 | Exponer `difficulty(activity, ref)` también para salidas | Insignia «Media para ti» en Última salida e Historial | `cycling-metrics-analyst` | F4 |
| D6 | Guardar las rutas generadas (geometría reducida, `steep` y cifras) y `routeId` opcional en `PlannedWorkout` | Rutas en Inicio y la forma en Próximas salidas | `cycling-routes-engineer` y `cycling-data-engineer` | F4 y F3 |
| D7 | Opcional: racha de semanas seguidas con salida | Tarjeta del menú lateral | `cycling-metrics-analyst` | F1 |
| D8 | `ImportReport`: añadir `noGps: { date, file }[]` y `withCadence`. Mensaje `progress` del Worker con `phase: 'unzip' \| 'parse' \| 'save'` | Avisos del informe y pasos de la importación en curso | `cycling-data-engineer` | F1 |

Dependencias por pedir, sin instalarlas ahora: `@fontsource/barlow`, `@fontsource/barlow-semi-condensed` y `lucide-react`. ECharts y Leaflet ya están previstos en la especificación.
