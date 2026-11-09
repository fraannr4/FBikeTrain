# Prototipo móvil de FBikeTrain

Prototipo estático (HTML, CSS y un poco de JS, sin librerías) de la app en el teléfono. Es la referencia para implementar las pantallas en `src/`. Ante cualquier duda manda el móvil (`docs/requisito-mobile-first.md`). La identidad «montaña» y los tokens están en `docs/design/design-system.md` y `docs/design/tokens.css`.

## Cómo verlo en el móvil

1. En el PC: `node docs/design/prototipo-movil/servir.mjs`. Sirve `docs/design` sin caché en el puerto 5174 y escribe en la consola las direcciones de la red local.
2. En el móvil, conectado a la misma wifi: `http://<IP-del-PC>:5174/`, que abre la galería (`index.html`). Por ejemplo, `http://192.168.1.141:5174/`.
3. La galería enseña un sello de versión, por ejemplo «Versión 973d416 · 7 nov, 04:02». Si en el móvil aparece otro sello, la página es vieja: recárgala.

Después de tocar cualquier CSS o JS, ejecuta `node docs/design/prototipo-movil/version.mjs`. El script pone `?v=<hash>` en cada `<link>` y `<script>` y renueva el sello. Sin ese paso, Vite (en el 5173) y la caché del móvil siguen sirviendo los ficheros viejos.

Para el tema: `?theme=light` o `?theme=dark` en la URL, el botón de sol o luna de la barra superior, o el conmutador de la galería. La elección se recuerda (`localStorage`, clave `fbt-theme`).

## Pantallas

La navegación inferior tiene cinco pestañas: **Inicio, Historial, Rutas, Plan y Más**. Las pantallas raíz de cada pestaña llevan el logotipo, que enlaza con la galería. Las pantallas a las que se entra desde otra llevan la flecha de volver.

| Página | Pestaña | Qué es | Estados por URL |
|---|---|---|---|
| `index.html` | — | Galería del prototipo: cada pantalla y sus estados, agrupados por pestaña, con el sello de versión | — |
| `inicio.html` | Inicio | Saludo con el paisaje de la última salida; las 4 cifras de la semana frente a tus semanas a estas alturas; objetivo del mes; próximo entreno con GPX; evento; última salida con mapa y perfil; tendencia de 12 semanas; tus datos | `state=empty`, `nohistory`, `loading`, `error`; `rides=0` y `rides=1`; `ruta=<nombre>` |
| `historial.html` | Historial | Salidas por mes, con las cifras del mes y una tira de días; búsqueda y hoja de filtros | `estado=vacio`, `cargando`, `error`; `salidas=N` (carga); `q=`, `orden=`, `periodo=` |
| `salida.html` | Historial | Detalle de una salida: mapa, 4 cifras, perfil táctil sincronizado con el mapa, subidas, comparación con 12 meses y rutas parecidas | `state=loading`, `error`, `empty` (sin GPS); `nombre=`, `km=` |
| `subidas.html` | Historial | Puertos que repites: la última subida en grande y la lista con tu mejor tiempo; hoja con perfil por km y pasadas | `caso=una`, `sin-una`, `solo-una`, `rampa`, `largos`, `muchas` |
| `repetidas.html` | Historial | Rutas que repites: la última, la lista con mejor, última y tendencia; hoja con las vueltas | `caso=una`, `ninguna-mejor`, `largos`, `rtl`, `sin-gps`, `muchas` |
| `rutas.html` | Rutas | Petición (km, desnivel, dificultad) y carrusel de 5 propuestas: forma, perfil por pendiente, % de carretera nueva, dificultad, tiempo; «Exportar GPX» fijo | ver la galería |
| `ia.html` | Rutas | Rutas con IA: 4 preguntas, una por pantalla, y las propuestas explicadas; qué ve la IA | ver la galería |
| `calendario.html` | Plan | Semana deslizable con hecho, pendiente y sin hacer; hoy; próximos entrenos; mes en una hoja | `state=empty`, `loading`, `error` |
| `objetivos.html` | Plan | Volumen de la semana y del mes (anillo con muesca de ritmo), evento y objetivos anteriores | `state=empty`, `loading`, `error`; `caso=tiempo`, `superado`; `evento=manana`, `hoy`, `pasado` |
| `mas.html` | Más | Explorar (Subidas, Repetidas, Calendario, Objetivos) y Datos y ajustes | `state=empty`, `loading`, `error` |
| `importar.html` | Más | Elegir ficheros o carpeta de Strava, progreso, informe y cómo conseguir los ficheros | `state=loading`, `nada`; `file=`, `fallos=N` |
| `ajustes.html` | Más | Acordeón: perfil, Casa, claves (rutas e IA), apariencia, copia de seguridad, borrar datos | `state=empty`, `loading`, `error`; `ia=sin-clave` |
| `kit.html` | — | Todas las piezas del kit y sus estados | — |

## Decisiones móviles clave

- **El pulgar manda.** Las acciones principales están abajo: navegación inferior, «Exportar GPX» fijo sobre ella en Rutas, botones de las hojas en el pie. Nada interactivo mide menos de 44 × 44 px; `shots.mjs` lo comprueba en cada captura.
- **Lo urgente, arriba.** Inicio responde, en el primer pantallazo, a «¿cómo va mi semana?» y «¿qué toca mañana?». Los análisis (tendencia, comparación con 12 meses) quedan debajo.
- **Hojas inferiores en vez de modales.** Filtros, GPX, mapa, generar ruta y detalle de una subida van en `dialog.sheet`, con asa y gesto de arrastre para cerrar.
- **Un título por pantalla, que se encoge al desplazar.** Al bajar, la barra compacta muestra el nombre de la pantalla. La entradilla que acompaña a un segmentado de vistas va debajo del segmentado, para que el segmentado no cambie de altura al pasar de Salidas a Subidas o a Repetidas.
- **Segmentado de vistas = `seg seg--quiet` con enlaces.** Lo usan Historial (Salidas, Subidas, Repetidas) y Plan (Calendario, Objetivos). El segmentado relleno de color se reserva a elegir un valor dentro de una pantalla, como el tema.
- **Cifras «dorsal».** Barlow Semi Condensed 700 en tabulares; la cursiva se reserva a la cifra titular de cada pieza. Formato es-ES: coma decimal y punto de miles **a partir de 10.000** (1542 m, 13.120 km), igual que `FBT.fmt`. Las unidades van en pequeño tras un espacio fino. Duraciones: «3 h 12», «6 h 08 min».
- **La dificultad nunca depende solo del color.** Siempre lleva barras (1 a 3) y texto: «Suave/Media/Dura para ti». La pendiente usa la misma escala de 6 colores en todos los perfiles, con leyenda de rangos.
- **Las diferencias llevan flecha y signo**, y el porcentaje siempre se mide contra tu propia referencia.
- **Sin fotos.** Las rutas se dibujan con su forma y su perfil coloreado por pendiente; el relieve con curvas de nivel de las cabeceras es la firma visual.
- **Volver.** La flecha de volver usa el historial del navegador si vienes de otra pantalla de la app, y dice a cuál vuelve («Volver a Inicio»); si no, lleva a la pantalla madre. También se vuelve deslizando desde el borde izquierdo.
- **Movimiento.** Pulsar escala a 0,97 (160 ms); las hojas suben en 320 ms con curva de cajón y bajan más rápido; el único momento orquestado es la línea de luz del paisaje de Inicio. El hover solo existe con puntero fino. Con `prefers-reduced-motion: reduce` se anulan las transiciones y las animaciones, y lo que se arrastra solo aparece y desaparece.
- **Apaisado y tableta.** En apaisado, el segmentado sube junto al título y las listas ganan alto. A partir de 900 px, la barra inferior pasa a ser un carril lateral.
- **Tema.** Oscuro por defecto y claro completo, todo con tokens. El botón de tema de la barra superior es una ayuda del prototipo para revisar los dos temas; en la app, el tema vive en Ajustes > Apariencia.

## Kit de componentes

Todos están en `kit.html`. Los estilos están en `movil.css`, salvo los indicados; el comportamiento, en `movil.js` (`window.FBT`).

| Componente | Clases o API | Notas |
|---|---|---|
| Barra superior compacta | `.appbar`, `.appbar-lead`, `.appbar-title`, `.appbar-actions`, `.brand` | Se vuelve de vidrio al desplazar (`data-scrolled`) |
| Cabecera de página | `.page-head`, `.page-title`, `.page-lead`, `.page-lead--sub` | Relieve grabado de fondo; el título se encoge con el scroll |
| Navegación inferior | `<nav class="tabbar" data-tabbar data-current data-badge="plan:1">` | La pinta `movil.js`; el contador va sobre la pestaña |
| Botones | `.btn`, `--primary`, `--secondary`, `--ghost`, `--lg`, `--block`; `.icon-btn`, `--filled`, `--glass`; `.btn-row` | 44 px mínimo; se escalan al pulsar |
| Acción fija | `.fab`, `.dock` | El dock va sobre la barra inferior (Exportar GPX) |
| Tarjetas | `.card`, `--flush`, `--accent`; `.card-h`, `.card-ic`, `.card-title`, `.card-link`, `.card-foot` | Sin tarjetas anidadas |
| KPI | `.kpis`, `.kpi`, `.kpi-h`, `.kpi-v`, `.delta`, `--up`, `--down` | Color por métrica con `data-m="dist|elev|time|speed"` |
| Medidor de objetivo | `.meter` (`--p`, `--pace`), `.meter-legend` | La muesca marca el ritmo para llegar a tiempo |
| Anillo de objetivo | `.ring` (`plan.css`, `FBT.ring`) | Primera métrica en anillo y el resto en barras |
| Chips | `.chip`, `--easy`, `--mid`, `--hard`, `--new`, `--done`, `--missed`; `.fchip` (filtro) | Dificultad con barras `#i-bars1..3` |
| Segmentado | `.seg`, `.seg--quiet`; con botones (`aria-pressed`) o con enlaces (`aria-current="page"`); `.seg-nav` en Plan | El indicador se desliza con `transform` |
| Lista táctil | `.list`, `--inset`; `.row`, `.row-lead`, `.row-main`, `.row-title`, `.row-meta`, `.row-trail`, `.row-val` | Filas de 64 px o más |
| Hoja inferior | `<dialog class="sheet">`, `data-sheet-open`, `data-sheet-close`; `FBT.sheet.open/close` | Asa, arrastre para cerrar y pie fijo |
| Avisos | `FBT.toast(texto, { tone })`, `data-toast` | Abajo, encima de la barra |
| Estados | `.state`, `--error`; esqueletos `.sk`, `.sk-line`, `.sk-fig` | Los esqueletos imitan la forma real |
| Banner | `.banner`, `--warn`, `--error` | Mensajes en línea |
| Acordeón y campos | `details.disclosure`, `.field`, `.input`, `.input-wrap`, `.status-line` | Ajustes e Importar |
| Gráficas SVG | `FBT.profile` (perfil por pendiente), `FBT.shape` (forma de ruta), `FBT.climb` (puerto por km), `FBT.passes` (pasadas) | SVG en línea, con `role="img"` y texto alternativo |
| Fecha en hito | `.hito-date`, `.hito-big` (`plan.css`) | Banda azul con el día y número dorsal |
| Stepper | `FBT.stepper` | Cifra grande entre «−» y «+»; mantener pulsado repite |
| Carrusel | `FBT.carousel` | Una tarjeta y el asomo de la siguiente, con paginador |
| Tarjeta de ruta | `.rcard`, `.receta`, `.opt`, `.genbar` (`rutas.css`) | Rutas y Rutas con IA |
| Utilidades | `FBT.fmt`, `FBT.dur`, `FBT.icon`, `FBT.theme`, `FBT.reduced` | Iconos de lucide en línea (`data-ic="..."`) |

## Datos de ejemplo

Son sintéticos y coherentes entre pantallas. Si cambias uno, cámbialo en todas. Hoy es el viernes 6 de noviembre de 2026.

- **Última salida:** jueves 5, Collsuspina y Moià: 87,6 km, 1542 m, 3 h 12 y 27,4 km/h, con cima de 911 m en el km 26. Es «Media para ti», tu 2.º mejor tiempo en esa ruta de 7 veces (el mejor, 3 h 06). Aparece en Inicio, Historial, Salida, Repetidas y Plan.
- **Primera subida de esa salida:** Collsuspina desde Centelles, 7,4 km al 4,3 %, en 24:14 (VAM 795). Es tu 2.ª mejor de 9; el mejor tiempo es 23:40. Aparece en Salida y Subidas.
- **Semana del 2 al 8:** 2 salidas (el martes 3, Coll de Bracons, 72,1 km; el jueves 5), con 160 km, 2722 m, 6 h 08 y 26,0 km/h. El objetivo es de 250 km (64 %, 19 km por detrás del ritmo). Con el fin de semana planificado llegarías a 296 km.
- **Noviembre:** 201 de 800 km (25 %, 41 km por delante del ritmo; quedan 24 días).
- **Próximos entrenos:** sábado 7, Lluçanès por Prats (86 km, 1320 m); domingo 8, Rodaje suave a Tona (50 km).
- **Evento:** Marxa del Lluçanès, domingo 13 de diciembre (faltan 37 días), 140 km y 2600 m.
- **Tu salida media:** 74 km y 1050 m. Es la base de la comparación de 12 meses, de la IA y del Calendario.
- **Totales:** 214 salidas y 13.120 km. Hay 14 subidas (8 las repites) y 6 rutas repetidas (en 4 vas más rápido). La última importación fue ayer.
- **Límites conocidos:** Historial solo trae tres meses de salidas, y su nota final lo dice. La serie de 12 semanas de Inicio es aparte y no sale de esas salidas.

Algunos datos que el prototipo enseña aún no existen en la app y están pedidos en el código: el nombre de las subidas sin nombre propio y las rutas «parecidas» con una similitud entre 0,3 y 0,6 (D9). Más peticiones de dato en `docs/design/design-system.md`.

## Comprobación

- `node docs/design/prototipo-movil/shots.mjs <pagina> [sufijo] [opciones]` captura la página a 360×780, 390×844, 412×915, 430×932 y 844×390, en los dos temas. Comprueba que no haya scroll horizontal, que los objetivos midan al menos 44 px, que no haya texto cortado ni fuera de pantalla, el contraste, que no haya texto de menos de 12 px y que no haya errores de consola. Las opciones están en la cabecera del script.
- `node docs/design/prototipo-movil/definitivas.mjs` genera las capturas definitivas a 390×844: `capturas/<pagina>-390-oscuro.png` y `capturas/<pagina>-390-claro.png`, con su informe.
