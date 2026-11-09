# Brief de diseño: FBikeTrain

Fecha: 2026-11-06. Etapa: análisis previo al rediseño. Aún no hay que construir nada: con este brief se preparan 2 o 3 direcciones, el usuario elige una y solo después se escribe el plan de rediseño.

Fuentes analizadas:
- inspiración: `images/2.png` (escritorio con foto y hero), `images/3.png` (escritorio y móvil con montañas), `images/4.png` (móvil) y `docs/referencia-ui.png` (idéntica a la 2);
- estado actual: `images/1.png`, un menú y la frase «Aún no hay salidas»;
- spec `docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md`, propuesta `docs/propuesta-ciclismo.html`, planes F1 a F5 y `docs/verificaciones.md`;
- código de F1, solo en lectura: `src/domain/types.ts`, `src/metrics/aggregate.ts`, `src/ui/pages/Inicio.tsx`, `src/ui/components/LastRide.tsx` y `src/ui/format.ts`.

Lámina de apoyo, con datos sintéticos: `docs/design/board/index.html`. Capturas en `docs/design/shots/`.

---

## 1. Por qué atrae la inspiración (y qué no copiamos)

La inspiración no gusta por las tarjetas. Gusta por cinco cosas:

1. **Profundidad.** Hay tres planos: el paisaje al fondo, el vidrio de las tarjetas que lo dejan entrever y el dato con brillo delante. Las tarjetas KPI de la imagen 3 se apoyan sobre las montañas en lugar de quedarse en una franja aparte.
2. **Luz con significado.** Lo que brilla es el dato: el trazado de la ruta en cian, el último punto de la gráfica y el anillo verde. Los marcos no brillan.
3. **Un color por métrica.** Azul para la distancia, violeta para el desnivel, cian para el tiempo y naranja para las calorías. El mismo color se repite en el icono, en la chispa y en la serie, así que se lee sin leyenda.
4. **Cifras enormes y etiquetas pequeñas.** «278 km» en negrita de 28 a 32 px, con la unidad más pequeña y en gris y el porcentaje en verde a su lado.
5. **Un saludo como titular.** «¡Hola Fran!» a 56 px sobre el cielo oscuro le da a la pantalla una persona y un momento del día.

Lo que **no** se copia, y por qué:

| De la inspiración | Por qué no | Qué ponemos en su lugar |
|---|---|---|
| Foto de ciclista y fotos de las tarjetas de ruta | Repositorio público y sin derechos | Paisaje SVG propio. Las rutas muestran su forma y su perfil por pendiente |
| Calorías y FC media | No hay sensores; la spec oculta pulso y potencia si no hay datos | Velocidad media como cuarto KPI y cadencia solo si el fichero la trae |
| Mapa de satélite | La spec decide CyclOSM sin satélite | CyclOSM con filtro oscuro y trazado luminoso |
| Distancia y desnivel en un mismo eje de 0 a 400 | Mezcla km y m: es el error número 1 de dataviz. El plan de F1 (tarea 10) pide dos ejes, que es el mismo error | Una métrica cada vez, que se cambia con unas pastillas, y tu media en discontinua, como el «Tu anterior periodo» de la imagen 4 |
| Emojis (músculo, destellos, bici) | Regla del proyecto | Iconos de lucide-react |
| Carrusel de rutas IA con puntos | Esconde de 2 a 4 de las 3 a 5 rutas | Lista de tarjetas compactas; en Inicio, la mejor y «Ver las 5» |
| Avatar con foto | Sin fotos | Inicial del nombre (Ajustes, `displayName`) |
| Insignia «Excelente» | Elogio genérico que no se mide contra nada | «Media para ti», «Dura para ti» (F4), medido contra tu referencia |
| «CyclePro» | Es el nombre de la inspiración | FBikeTrain (sección 2) |

## 2. Identidad propia

**Nombre: FBikeTrain.** Lo mantengo. Es del usuario (la F es de Fran), no choca con ninguna marca conocida y ya figura en la tarea. Alternativa, si se quiere un nombre de producto: **Cota** (la altitud de un punto del mapa). Es corto, está en castellano y viene de la topografía, pero renombrar no aporta nada a una web personal. El nombre se guarda en una sola constante de UI para poder cambiarlo.

**Logotipo: un hito kilométrico.** Es el mojón de carretera de la propuesta (`.borne`): un rectángulo con la parte de arriba redondeada, una banda de color arriba y la «F» en Barlow Semi Condensed. Es un objeto de carretera que no usa nadie del sector fitness, a diferencia de las montañas en triángulo de CyclePro, que repiten todas las apps de deporte.

**La idea central, donde se gasta la audacia: «el horizonte es tu última salida».** La cresta delantera del paisaje del hero no es una montaña inventada. Es el perfil de altitud real de tu última salida, suavizado, con una línea de luz en la arista. Las capas de detrás son procedurales y de menor contraste. Esto aporta tres cosas:
- el hero cambia con cada salida importada, de modo que la pantalla es tuya y no una plantilla;
- no hace falta ninguna foto;
- enlaza con el lenguaje del ciclismo de carretera: el perfil de etapa del libro de ruta.

Sin track, o con 0 salidas, el horizonte es una cresta procedural fija. En la lámina, una pastilla discreta, «El horizonte es el perfil de tu última salida», explica el guiño. En la app iría como `title` o como texto alternativo.

**Segundo rasgo propio: el color del libro de ruta.** Los perfiles se colorean por pendiente en tramos de 1 a 4, 4 a 7, 7 a 10, 10 a 16 y más de 16 %, como los perfiles de etapa de las grandes vueltas. Son las mismas clases que `steepness` de ORS en F4. Lo que no sube (menos del 1 % y las bajadas) va en un gris azulado neutro.

## 3. Inventario, widget a widget

Las fases indican cuándo existe el dato. «Petición» significa que el dato hay que pedirlo a quien lleva `src/metrics`, `src/db` o `src/import` (sección 9); el rediseño no toca esa lógica.

| # | Widget (inspiración) | Dato nuestro | Fase | Adaptación y estado vacío |
|---|---|---|---|---|
| 1 | **Menú lateral**: logo, navegación, tarjeta «Sigue pedaleando», conmutador de tema y versión | Rutas de `App.tsx` | F1 y siguientes | Logo del hito y FBikeTrain. Entradas: Inicio, Historial (F2), Subidas (F2), Calendario (F3), Rutas (F4), Importar, Ajustes. La IA es el modo «Con IA» dentro de Rutas (F5), con un acceso directo «Rutas con IA». **Solo se muestran las entradas que existen**: nada de enlaces muertos con «próximamente» en la navegación. La tarjeta inferior pasa a ser «Última importación hace N días» con el botón Importar, a partir de `getMeta().lastImportAt` (F1). Abajo, el conmutador Oscuro/Claro y la versión de `package.json` |
| 2 | **Cabecera**: buscador, campana y avatar | Búsqueda local sobre `listActivities` (nombre y fecha) | F2 (cuando hay Historial) | En F1 no hay buscador: no hay nada que buscar todavía. La campana muestra avisos locales: importación terminada, «hace 9 días que no importas» (F1) y «mañana: entreno X» (F3). El avatar es la inicial de `displayName`, que lleva a Ajustes |
| 3 | **Hero con saludo**: «¡Hola Fran!» y la frase | `displayName` (F1) y semana actual frente a la media (`currentWeekVsAverage`, F1) | F1 | «Hola, Fran» sin exclamaciones dobles. La frase sale de los datos: «Esta semana llevas 3 salidas y vas por encima de tu media en distancia». Sin nombre: «Hola». Con 0 salidas, el hero invita a importar: «Importa tu archivo de Strava para ver tu progresión», con el botón Importar. El paisaje está descrito en la sección 2 |
| 4 | **KPI con chispa** (4) | Distancia, desnivel y tiempo: `current` y `deltaPct` (F1). Chispas: `aggregate(acts, 'week', 8 semanas)` (F1) | F1 | 1. Distancia; 2. Desnivel; 3. Tiempo en movimiento; 4. **Velocidad media de la semana** (sustituye a Calorías). Su variación pide `deltaPct.speed` (**petición D1**). El delta lleva flecha, signo y el texto oculto «frente a tu media»: en verde (`--good`) si sube y en tinta 2 si baja, porque bajar de tu media no es un error y no va en rojo. Con `deltaPct` a `null` (sin semanas previas) aparece «Sin referencia aún». Semana sin salidas: «0 km», con la chispa visible |
| 5 | **Tu progresión**: área con degradado, curvas suaves, burbuja en el último punto y rangos 12/6/3 meses y 30 días | `aggregate` por mes o por semana (F1) | F1 | Rangos como hoy. **Una métrica cada vez** con pastillas del color de su acento (Distancia, Desnivel, Tiempo, Velocidad) y **tu media del periodo** en discontinua (D2: cálculo trivial, pero mejor como función probada). La burbuja va en el último punto con su valor. Con menos de 2 periodos con datos aparece el estado vacío «Con 2 meses de salidas verás tu tendencia», con la gráfica en gris y sin línea |
| 6 | **Tu rendimiento**: velocidad, desnivel medio, tiempo y FC | Velocidad media del periodo (F1); desnivel por salida; cadencia media; velocidad máxima | F1 y peticiones | Cuatro celdas: velocidad media (F1), desnivel medio por salida (**D3**), cadencia media (**D3**, solo si alguna salida la trae; si no, la celda se oculta, como dice la spec) y velocidad máxima o salida más larga (**D3**). En F2 se suma la VAM media de tus subidas («712 m/h»). **Nunca FC ni potencia sin datos** |
| 7 | **Tu objetivo con anillo**: 72 %, 278/400 km y días restantes | F3: `VolumeGoal` y `volumeProgress` (`pct`, `expectedPct`, `aheadPct`, `daysLeft`); `EventGoal` y `goalProgress` | F3 (antes, sustituto en F1) | **F1 y F2:** el anillo mide «Tu semana frente a tu media», con `current.distanceM / avg.distanceM`, un dato real que no se presenta como objetivo. **F3:** objetivo de volumen con el anillo y una muesca en `expectedPct` («vas 6 puntos por delante») u objetivo de evento («Marcha 120 km, 14 dic»), con su mejor salida de las 8 semanas y los días que faltan. Sin objetivos: «Define un objetivo mensual», que lleva a Calendario |
| 8 | **Próximas salidas**: fecha, foto, nombre, km, m y dificultad | F3: `PlannedWorkout` (`date`, `title`, `distanceM?`, `elevGainM?`) | F3 | Bloque de fecha (día de la semana, número y mes en Barlow Semi Condensed), título, km y m, y la etiqueta Suave/Media/Dura de F4 sobre la distancia y el desnivel del entreno. En lugar de foto, una mini forma de ruta si el entreno enlaza una ruta guardada (**D6**); si no, un icono de calendario. Antes de F3, la tarjeta no aparece: no hay «próximamente» en Inicio para F3 |
| 9 | **Última salida**: mapa con trazado luminoso, cifras sobre el mapa, perfil abajo e insignia | F1: `StoredActivity`, `getTrack` y Leaflet con CyclOSM; perfil `AltitudeProfile` | F1, F2 y F4 | Cifras en una placa de vidrio sobre el mapa: km, m, tiempo y km/h. Debajo, el perfil a todo el ancho: **F1** con degradado del acento; **F2** con las subidas sombreadas (`detectClimbs`); **coloreado por pendiente** con **D4**. La insignia es «Media para ti» (F4, `difficulty` contra la referencia) y se oculta sin referencia. Sin GPS (rodillo): «Esta salida no tiene GPS, así que no tiene mapa», con las cifras, y el perfil se oculta |
| 10 | **Rutas recomendadas por IA**: carrusel con foto, «IA, 3 opciones», cifras y «Ver ruta» | F4: `GeneratedRoute` (forma, `steep`, `newPct`, `difficulty`, `estTimeS`); F5: explicación con cifras | F4 y F5, más **D6** para Inicio | Tarjeta de ruta: **forma** (SVG del `LineString` con trazado luminoso) y **perfil por pendiente**, título, km, m, «74 % carretera nueva», la etiqueta Suave/Media/Dura y «Descargar GPX». En F5, una línea de la explicación con cifras. Hoy F4 no guarda las rutas, así que Inicio no puede mostrar las últimas: hay que pedir guardarlas (**D6**). Antes de F4, Inicio no muestra la tarjeta. En F4 sin clave ORS: «Configura tu clave de rutas en Ajustes» |
| 11 | **Barra inferior en móvil**: Inicio, Historial, Rutas, IA y Más | Rutas de la app | Crece con las fases | **F1:** Inicio, Importar y Más (Ajustes y tema). **F2:** con Historial. **F4:** con Rutas. **F5:** con IA. **Más** abre una hoja inferior con Subidas, Calendario, Importar, Ajustes y el tema. Pestaña activa en `--action` con su etiqueta; nunca solo el icono |
| 12 | **Conmutador de tema**: sol y luna | Preferencia de la persona que mira | F1 | Dos estados, Oscuro (por defecto) y Claro, en un control segmentado con texto e icono. Se guarda en `localStorage` con try/catch, y un script previo al pintado en `index.html` pone `data-theme` para evitar el destello. Si se quiere dentro de la copia de seguridad, iría en `Settings`, pero el tema es una comodidad de cada navegador, así que no lo recomiendo |
| 13 | «¿Nueva ruta?» con CTA morado (móvil, imagen 3) | F5 | F5 | Banda de llamada al final de Inicio en móvil: «Pide una ruta para progresar», que lleva a Rutas en modo IA. Solo si hay clave de IA; si no, lleva a Ajustes |
| 14 | Estados globales (no están en la inspiración) | — | F1 | Cargando: esqueletos con la forma final de cada tarjeta, sin spinners. Almacenamiento bloqueado: aviso con la causa. 0 salidas: el hero invita a importar y el resto de tarjetas no se pinta |

## 4. Lenguaje visual

### Capas (de atrás adelante)

1. **Fondo** `--bg`, plano.
2. **Paisaje del hero**, en SVG y solo en el hero:
   - cielo en degradado vertical, de noche arriba a un horizonte cálido (malva y rosa) abajo;
   - un resplandor radial a la derecha, lejos del saludo;
   - dos crestas procedurales, más claras por la perspectiva atmosférica;
   - la cresta delantera, con el perfil de la última salida y una línea de luz.
3. **Tarjetas.**
   - Las KPI, sobre el paisaje: vidrio con `--surface-glass`, al 78 %, y `backdrop-filter: blur(10px)`, solo en esas 4 y en la barra inferior de móvil.
   - El resto de tarjetas: superficie opaca `--surface`, borde de 1 px `--line` y un brillo interior de 1 px arriba (`inset 0 1px 0 rgba(255,255,255,.06)`).
4. **Dato luminoso**, la única capa con brillo: el trazado de la ruta, la línea de la gráfica, el último punto y el anillo.

### Brillo (resplandor)

- Se hace con un **trazo doble**: uno ancho, de 7 a 10 px, con opacidad entre 0,25 y 0,35 del acento, y encima el trazo nítido de 2,5 a 3 px. En el mapa se añade un hilo blanco de 1 px al 70 % para el núcleo «de neón».
- `filter: blur` y `drop-shadow` solo en piezas estáticas y pequeñas, como el anillo. No van en el mapa mientras se mueve.
- Las tarjetas y los botones no brillan.
- La intensidad se controla con un token, `--glow`: 0,55 en oscuro y 0 en claro. En claro, el brillo pasa a ser un **contorno blanco** (*casing*) bajo el trazo.

### Degradados

Solo hay tres, todos con significado:
- el cielo del hero;
- el área bajo la curva (del acento al 32 % hasta 0);
- la chispa de la KPI (del acento al 35 % hasta 0).

No hay degradados decorativos en botones ni en fondos de tarjeta.

### Tipografía

Se autoalojan con @fontsource, y es una **petición de dependencia**:
- **Barlow** (400, 500 y 600) para la interfaz y el texto. Nace de los rótulos de las carreteras de California: es tipografía de carretera, no de app de fitness. Hay continuidad con la propuesta, que ya usa Barlow Condensed.
- **Barlow Semi Condensed** (600 y 700) para cifras, titulares y el saludo, siempre con `font-variant-numeric: tabular-nums`.

Escala:

| Uso | Tamaño | Peso | Familia |
|---|---|---|---|
| Saludo | `clamp(34px, 5vw, 56px)` / 1, tracking −0,02em | 700 | Semi Condensed |
| Cifra KPI | 32 px (26 px en móvil); unidad a 17 px en tinta 2 | 700 | Semi Condensed |
| Título de tarjeta | 17 px, con el icono de 20 px a la izquierda | 600 | Barlow |
| Texto | 15 px / 1,5 | 400 | Barlow |
| Notas y ejes | 12,5 a 13,5 px (mínimo 12 px) | 400 | Barlow |

Nada de mayúsculas sostenidas en etiquetas ni de títulos encima de cada título (eyebrows). Los enlaces no llevan «→» en el texto: la flecha de la inspiración pasa a un *chevron* de lucide, y solo en filas que son enteras un enlace.

### Densidad

Panel de densidad media-alta.
- Huecos de 12 px entre tarjetas y relleno de 20 px dentro de cada tarjeta.
- Rejilla de escritorio: menú de 232 px y un contenido de 12 columnas con un máximo de unos 1.360 px.
- Composición de Inicio: hero a todo el ancho con las 4 KPI integradas; progresión (8 columnas) con objetivo (4); rendimiento (4), última salida (5) y próximas salidas (3); y por último la fila de rutas.

### Radios (por jerarquía, no uno igual para todo)

| Pieza | Radio |
|---|---|
| Hero y tarjetas | 22 px |
| KPI y miniaturas de ruta | 16 px |
| Controles y placas | 12 px |
| Chips y muestras | 8 px |
| Pastillas, avatar y botones redondos | 999 px |

### Sombras

- Oscuro: la tarjeta flota con `0 24px 48px -28px rgba(0,0,0,.75)` y el brillo interior de 1 px; el borde hace casi todo el trabajo.
- Claro: `0 1px 2px` y `0 12px 32px -18px` en el tono de la tinta, y nunca gris neutro.

### Color de acento por métrica

Validado con `dataviz/scripts/validate_palette.js`: en categórico, banda de luminosidad, croma, separación CVD de los pares adyacentes, umbral de visión normal y contraste, todo en PASS en los dos modos.

| Métrica | Oscuro (sobre `#111A2E`) | Claro (sobre `#FFF`) | Icono lucide |
|---|---|---|---|
| Distancia | `#3B8BFF` | `#1F66E0` | `Bike` |
| Desnivel | `#9277F2` | `#6E4BD8` | `Mountain` |
| Tiempo | `#1AA597` | `#0B8C80` | `Timer` |
| Velocidad | `#C9820B` | `#B86E00` | `Gauge` |

Ojo: el azul y el violeta de la inspiración (`#3B8BFF` y `#A07CFF`) **no se distinguen con protanopía** (ΔE 0,8). Por eso el orden de validación es azul, ámbar, violeta y teal, y las dos únicas métricas que podrían ir juntas, distancia y desnivel, nunca comparten gráfica.

El texto nunca lleva el color de la serie: valores, etiquetas y leyendas van en tinta.

### Pendiente (escala ordinal, validada con `--ordinal` en los dos modos)

| Clase | Oscuro | Claro |
|---|---|---|
| < 1 % y bajadas (neutro) | `#5C6B8A` | `#A7B3C8` |
| 1–4 % | `#F4D77E` | `#D6A21F` |
| 4–7 % | `#F2A44E` | `#D9782A` |
| 7–10 % | `#EC7343` | `#C2452B` |
| 10–16 % | `#E04A5E` | `#972530` |
| ≥ 16 % | `#B0368C` | `#5A1634` |

- La luminosidad es monótona.
- En claro, la escala va del ocre al granate: más oscuro es más empinado.
- En oscuro va del amarillo pálido al magenta: el extremo más empinado se mantiene por encima de 3:1 sobre la superficie.
- Siempre lleva leyenda con los rangos y, en el tooltip, la pendiente en cifras.

### Estado y dificultad

Colores reservados, siempre con icono y texto:
- `--good` (`#3DD68C` en oscuro y `#15803D` en claro) para «por encima de tu media» y para el anillo;
- Suave en verde, Media en ámbar y Dura en rojo, con un icono de barras (1, 2 o 3).

### Tokens base

Los nombres siguen el estilo `--color-*` de `src/styles.css`; en la lámina están abreviados.

```css
:root {                      /* oscuro, por defecto */
  --bg:#0A1122; --surface:#111A2E; --surface-2:#17223B; --surface-glass:rgba(17,26,46,.78);
  --line:rgba(148,176,230,.14); --line-strong:rgba(148,176,230,.26);
  --ink:#EAF0FA; --ink-2:#A9B6CF; --ink-3:#8C9AB5;
  --action:#2F6FEB; --on-action:#FFF; --focus:#7FB2FF;
  --sky-0:#060A15; --sky-1:#0B1430; --sky-2:#1A2558; --sky-3:#3B3470; --sky-4:#A0586A;
  --ridge-far:#2A3874; --ridge-mid:#1A2656; --ridge-near:#0E1734; --ridge-line:#7FB2FF;
  --glow:.55; --r-xl:22px; --r-lg:16px; --r-md:12px; --r-sm:8px;
}
:root[data-theme="light"] {
  --bg:#EEF2F8; --surface:#FFF; --surface-2:#F4F7FB; --surface-glass:rgba(255,255,255,.86);
  --line:#D9E1EE; --line-strong:#C3CEE0; --ink:#0E1730; --ink-2:#3E4C68; --ink-3:#56657F;
  --action:#1F5FD6; --focus:#1F5FD6;
  --sky-0:#C9D9F2; --sky-1:#DCE6F7; --sky-2:#EEF1FA; --sky-3:#F8E6DA; --sky-4:#F6D2BF;
  --ridge-far:#B9C7E0; --ridge-mid:#9DB0D3; --ridge-near:#7F96C2; --ridge-line:#1F55C8;
  --glow:0;
}
```

El oscuro es el tema **por defecto aunque el sistema esté en claro**, como pide la tarea. Si se quiere respetar `prefers-color-scheme`, se añadiría un tercer estado, «Sistema»; queda como decisión abierta.

Contrastes medidos (WCAG):

| Pareja | Ratio |
|---|---|
| Tinta sobre tarjeta, oscuro | 15,2:1 |
| Tinta 2, oscuro | 8,5:1 |
| Tinta 3, oscuro | 6,1:1 |
| Blanco sobre `--action` | 5,2:1 |
| `--good` en oscuro | 9,2:1 |
| Tinta 2, claro | 7,0:1 |
| `--good` en claro | 5,0:1 |

Todo es AA para texto normal.

### Movimiento

Hay un solo momento orquestado en Inicio (skill `choreograph` en la fase de construcción):
1. la línea de luz del horizonte se dibuja (900 ms, `cubic-bezier(.23,1,.32,1)`);
2. a la vez, la línea de la progresión;
3. al terminar aparece la burbuja del último punto, solo con opacidad, en 260 ms.

Las tarjetas no hacen *fade-up* una a una y no hay contadores que suben.

Respuesta a acciones:
- pulsación con `scale(.97)` en 160 ms;
- el indicador del control segmentado se desliza (técnica de `clip-path`);
- la hoja «Más» entra desde abajo (`translateY(100%)`, curva de cajón);
- el *hover* solo bajo `(hover:hover) and (pointer:fine)`.

Con `prefers-reduced-motion: reduce`, nada se dibuja ni se desplaza: todo aparece con un fundido de opacidad y los cambios de tema son instantáneos. La captura `board-dark-1440-reduced.png` muestra el estado final sin animación.

## 5. Gráficas (dataviz, ECharts 5)

- **Progresión.** Una serie `line` con:
  - `smooth: true` y **`smoothMonotone: 'x'`**: con pocas salidas, la curva suave cruza por debajo de 0 entre meses vacíos, y el modo monótono lo evita;
  - `areaStyle` con `LinearGradient` del acento, de 0,32 a 0;
  - `lineStyle.shadowBlur: 12` y `shadowColor` del acento solo en oscuro;
  - burbuja con `endLabel` (fondo `--surface-2` y borde del acento);
  - media con `markLine` discontinua en `--ink-3`.
  - Rejilla y ejes en `--line` y `--ink-3`, tooltip con cruceta.
  - Los colores se leen de los tokens con `getComputedStyle` y la gráfica se repinta al cambiar el tema.
- **Chispas.** SVG propio o ECharts sin ejes. 8 semanas, sin interacción: son un adorno con dato, y la cifra grande es la que manda.
- **Anillo.** SVG propio: pista en `--surface-2` y arco en `--good`. En F3 se añade la muesca del ritmo esperado. `role="img"` con un `aria-label` que dice la cifra entera.
- **Perfil por pendiente.** ECharts (F4: `SlopeProfile`) o SVG propio para las miniaturas, con un trazo de 1 px en tinta encima del relleno coloreado para que la forma se lea sin color.
- **Accesibilidad.** Cada gráfica lleva una tabla oculta o un `aria-label` con los valores, y en «Tu progresión», «Ver como tabla».

## 6. Móvil

Capturas: `board-dark-390.png` y `board-light-390.png`.

- **Menú lateral → barra inferior de pestañas.**
  - Cinco pestañas como máximo (Inicio, Historial, Rutas, IA y Más), que van apareciendo según la fase (sección 3, widget 11).
  - Fija abajo, con vidrio y `padding-bottom: env(safe-area-inset-bottom)`.
  - Objetivos táctiles de 48 px y etiqueta siempre visible.
- **Hero.**
  - Logo pequeño y botones redondos de búsqueda y avisos de 44 px arriba.
  - Saludo a 34 px y la frase en 2 líneas.
  - El paisaje queda detrás del saludo y de la rejilla 2×2 de KPI. A 390 px la cresta asoma entre las KPI: es la pieza que más hay que cuidar en las direcciones.
- **KPI.** Rejilla 2×2, cifra a 26 px y sin la línea «frente a tus 4 semanas», que pasa al `aria-label`.
- **Progresión.**
  - A todo el ancho.
  - Las pastillas de métrica pasan a 2 líneas o se convierten en un `select` segmentado.
  - Por debajo de 480 px se etiqueta un mes de cada dos (`axisLabel.interval: 1`), porque doce meses en 300 px se amontonan.
  - La gráfica se redimensiona con el contenedor (`ResizeObserver` y `chart.resize()`). Un SVG de viewBox fijo deja los textos diminutos: lo vi en la primera captura de la lámina y lo corregí.
- **Objetivo y próxima salida.** En 2 columnas desde 400 px, como en la imagen 4; por debajo, en una.
- **Última salida.**
  - Mapa de 220 px de alto, sin zoom con la rueda y con el arrastre de un dedo desactivado (`dragging: !L.Browser.mobile`), para que la página se pueda desplazar. Se abre a pantalla completa con un botón.
  - La placa de cifras pasa a quedar bajo el mapa.
- **Rutas.** Miniatura de 96 px y perfil a todo el ancho.
- **Comprobado:** sin desplazamiento horizontal a 390 px (`overflow-x: 0` en las 5 capturas).

## 7. Modo claro

Capturas: `board-light-1440.png` y `board-light-390.png`.

- **Cielo de amanecer**: azul pálido arriba y melocotón en el horizonte. Las crestas son azul grisáceo, de más claro a más oscuro hacia delante, y la línea de luz es azul oscuro, `#1F55C8`. El saludo en tinta sobre el cielo da 12:1.
- **Tarjetas** blancas con borde `#D9E1EE` y sombra teñida. El vidrio de las KPI está al 86 % de opacidad para que el texto no dependa del paisaje.
- **Sin resplandor** (`--glow: 0`). El trazado del mapa lleva un contorno blanco de 6 px bajo un trazo de 3 px del acento, para que se lea sobre el CyclOSM claro, que está muy cargado.
- **Acentos un paso más oscuros** (validados en claro) y la escala de pendiente invertida en luminosidad.
- Las etiquetas de dificultad en claro llevan el texto en un tono más oscuro que el fondo del chip. Por ejemplo, Media va en `#8A4A00` sobre ámbar al 12 %.
- El mapa en claro no lleva filtro.

## 8. Riesgos y mitigaciones

1. **Contraste del texto sobre la ilustración.** La tinta sobre la cresta media (`#5A6FA8`) da 4,29:1: **no llega a AA**.
   - El saludo y la frase se colocan siempre en la franja del cielo más oscuro, por encima de `--sky-2`, que da 9,7:1. El paisaje ancla las crestas abajo (`preserveAspectRatio="xMidYMax slice"`), las crestas son más bajas a la izquierda y el resplandor cálido se queda a la derecha, lejos del texto.
   - Las KPI llevan su propia superficie de vidrio. Su texto no se mide contra el paisaje, sino contra la superficie, que está al 78 % (86 % en claro).
   - Si una cresta real (un puerto de 2.000 m en el kilómetro 5) sube hasta el texto, se recorta su amplitud al 30 % inferior del hero. Hay que probarlo con `break-ui`: perfiles planos, un muro al inicio, 400 km y una salida sin altitud.
2. **Rendimiento del resplandor.**
   - `backdrop-filter` en un máximo de 5 elementos (las KPI y la barra móvil). Las tarjetas que se desplazan no lo llevan, porque desenfocar en cada fotograma es caro, y más en Safari.
   - El brillo es un trazo doble, sin `filter: blur` en nada que se anime o que se mueva con el mapa.
   - ECharts usa `shadowBlur` en una sola serie de 12 a 52 puntos, lo que es barato.
   - Las animaciones son de `stroke-dashoffset` (pintura) y opacidad, una sola vez al cargar.
   - Hay que medirlo con `animation-performance` en un portátil modesto.
3. **Mapa oscuro.** CyclOSM no tiene versión oscura.
   - En oscuro se aplica `filter: invert(1) hue-rotate(180deg) brightness(.9) contrast(.85) saturate(.5)` **solo** a `.leaflet-tile-pane`, nunca a los marcadores, la polilínea ni los controles.
   - Efecto secundario: los colores semánticos de CyclOSM se invierten (el verde de los parques se vuelve violeta y el azul de las vías ciclistas, naranja). Lo atenúa `saturate(.5)`. Si molesta, se puede ofrecer «Mapa claro» dentro de la tarjeta.
   - La atribución de CyclOSM y OpenStreetMap queda fuera del filtro, siempre legible, con 12 px como mínimo.
   - El filtro de CSS sobre muchas teselas cuesta al moverse: hay que comprobar que el arrastre va fluido. Si no, se quita el filtro durante el `movestart`.
   - Las teselas de CyclOSM tienen límites de uso: nada de precargar teselas para adornar.
4. **Pocos datos.** El archivo real tiene **8 salidas de bici** (`docs/verificaciones.md`).
   - 12 meses serán casi todo ceros, con chispas planas y `deltaPct` a `null`.
   - El diseño tiene que verse bien con 0, 1, 8 y 5.000 salidas: estados vacíos con frase útil, una curva monótona que no baje de 0 y «Sin referencia aún» en lugar de «−100 %».
   - Las 4 semanas previas casi nunca tendrán datos al principio.
5. **Cadencia vacía.** La `Cadencia promedio` del CSV de Strava viene vacía; solo los FIT y GPX con sensor la traen. La celda de cadencia existe, pero se oculta casi siempre: no puede ser un KPI fijo.
6. **Doble eje heredado.** La tarea 10 de F1 pide dos series con ejes separados. El rediseño lo sustituye por una métrica cada vez. Hay que anotarlo en el plan de rediseño para que el revisor no lo marque como incumplimiento del plan de F1.
7. **Fuentes y CDN.** La propuesta HTML carga Google Fonts. La app **no** puede: se usa @fontsource, que es una dependencia nueva que hay que pedir. La lámina incluye 5 woff2 copiados con su licencia OFL en `docs/design/board/fonts/`, solo para la lámina.
8. **Sin capturas del Inicio real con datos.** La única captura del estado actual muestra 0 salidas, así que las direcciones se prepararán con datos sintéticos realistas (8 salidas y un año entero), no con el archivo del usuario.

## 9. Peticiones de datos (no se tocan `src/import`, `src/metrics` ni `src/db`)

| Id | Qué | Para qué widget | Quién | Fase |
|---|---|---|---|---|
| D1 | `currentWeekVsAverage`: añadir `deltaPct.speed` y `deltaPct.rides` | KPI 4 (velocidad) y la frase del hero («3 salidas, una más que tu media») | `cycling-metrics-analyst` | F1 |
| D2 | `periodMean(periods, key)` o la media del rango junto a `aggregate` | Línea «tu media» de la progresión | `cycling-metrics-analyst` | F1 |
| D3 | Por periodo: desnivel medio por salida, cadencia media ponderada por tiempo (ignorando las salidas sin cadencia, `undefined` si ninguna la tiene), velocidad máxima y salida más larga | Tu rendimiento | `cycling-metrics-analyst` | F1 |
| D4 | `gradeSegments(profile)`: tramos `{ fromM, toM, gradePct, cls }` con las clases de F4 sobre el perfil suavizado de F2 | Perfil por pendiente de las salidas propias (última salida, Historial y miniatura del hero) | `cycling-metrics-analyst` | F2 |
| D5 | Exponer `difficulty(activity, ref)` para salidas, no solo para rutas | Insignia «Media para ti» en la última salida y en Historial | `cycling-metrics-analyst` | F4 |
| D6 | Guardar las rutas generadas (tabla `routes` o las últimas N en `meta`), con geometría reducida, `steep` y cifras, y opcionalmente `routeId` en `PlannedWorkout` | «Rutas para ti» en Inicio y la forma en «Próximas salidas» | `cycling-routes-engineer` y `cycling-data-engineer` | F4 y F3 |
| D7 | Opcional: racha de semanas seguidas con salida | Tarjeta del menú lateral | `cycling-metrics-analyst` | F1 |

Dependencias nuevas que hay que pedir, sin instalar ahora: `@fontsource/barlow`, `@fontsource/barlow-semi-condensed` y `lucide-react`.

## 10. Siguiente paso

Preparar **2 o 3 direcciones** sobre esta base y **esperar a que el usuario elija** antes de escribir el plan. Todas comparten los datos, el inventario y las reglas de este brief; cambian la atmósfera y la composición del hero. Propuesta:

- **A, «Puerto al anochecer»**: la de la lámina. Noche azul, horizonte malva, crestas por capas y vidrio. Es la más cercana a la inspiración.
- **B, «Libro de ruta»**: más gráfica que fotográfica. Fondo liso de noche, el hero es un gran perfil de etapa de la última salida coloreado por pendiente, con los puertos rotulados y kilómetros como en un libro de ruta, y curvas de nivel como textura. Es la más propia y la menos parecida a la inspiración.
- **C, «Cartografía»**: curvas de nivel en todo el fondo, el mapa como protagonista del hero (la última salida, luminosa) y la paleta de tinta cartográfica. Es la más sobria.

Cada dirección se presentará con capturas de escritorio, móvil, claro y oscuro del Inicio con datos sintéticos.
