# Auditoria de diseno y usabilidad movil (390 px)

Fecha: 2026-11-17. Solo auditoria: no se ha tocado codigo. Marca (B Trazado) y paleta no cambian.
Base: capturas de hoy a 390 px (oscuro, claro en los casos que hacia falta) y las capturas de `docs/design/`.
Las capturas copiadas estan en `capturas/` (mismo nombre que el original, con sufijo `-390-dark` o `-390-light`).

Nota sobre las capturas: son de pagina completa. La barra inferior y el aviso de error aparecen a mitad de imagen,
y el recuadro vacio de "Septiembre" en Historial es `content-visibility: auto`. Nada de eso es un fallo de la app.
Para la proxima ronda, captura solo el viewport.

## 1. Tabla resumen

| Nº | Pantalla | Problema | Impacto | Esfuerzo |
|----|----------|----------|---------|----------|
| 1 | Retos (lista) | El corazon de "me gusta" queda suelto debajo de la tarjeta | alto | S |
| 2 | Busqueda de rutas (overlay) | Banda plana entre la escena y el estado | medio | S |
| 3 | Rutas | Dos desplegables de webs externas empujan la Biblioteca fuera de pantalla | medio | S |
| 4 | Biblioteca comun | Buscador y filtro ocupan ~330 px antes de la primera ruta | medio | S |
| 5 | Plan (Calendario) | Dos mensajes de "nada planificado" apilados | medio | S |
| 6 | Ajustes | Boton "Instalar la app" desactivado y 3 lineas de ayuda arriba del todo | medio | S |
| 7 | Reto de ruta (detalle) | Bloque de reglas de 3 parrafos a 12 px al final | medio | S |
| 8 | Retos y detalle | Texto secundario a 12 px en gris tenue | medio | S |
| 9 | Inicio | "Carga y forma" sin datos ocupa una tarjeta entera | bajo | S |
| 10 | Mas | Subtitulo de "Ciclistas" cortado con puntos suspensivos | bajo | S |
| 11 | Cabeceras | Iconos de accion sueltos en unas pantallas y en circulo en otras | bajo | S |
| 12 | Salida | "Frente a tu media" se descuadra cuando todos los valores son iguales | bajo | M |
| 13 | Retos (vacio) | El CTA "+100 km esta semana" no ocupa el ancho como el resto de CTA | bajo | S |
| 14 | Amigos | El buscador "entre tus amigos" no tiene placeholder | bajo | S |

## 2. Detalle por hallazgo

### 1. Corazon suelto en la lista de Retos (alto, S)

- Que se ve: en `docs/design/2026-11-17-me-gusta/retos-390-dark.png` la pastilla del corazon (con el 5) flota a la derecha,
  debajo de la tarjeta, sobre el fondo. Parece de otro elemento. En el diario
  (`docs/design/2026-11-17-me-gusta/salidas-390-dark.png`) el corazon va dentro de la tarjeta, en el pie, a la derecha.
- Por que molesta: no se sabe a que reto pertenece. Queda a mitad de camino entre dos tarjetas y se pulsa sin querer al hacer scroll.
- Cambio: meter el corazon en el pie de la tarjeta, como en el diario. Pie con `Ver marcador →` a la izquierda y `LikeFor` a la derecha, separado por la misma linea.
- Donde:
  - `src/ui/pages/CommunityRetos.tsx`, `ChallengeCard` (linea ~160-176). Hoy el `<Link className="card community-challenge">` envuelve la tarjeta y `<LikeFor>` va fuera.
  - Pasar la clase `card` al contenedor `.community-challenge-item`. El `Link` principal queda sin borde ni fondo.
  - Crear un pie: `<div className="community-card-foot"><Link className="community-card-link">Ver marcador →</Link><LikeFor/></div>`.
  - `src/ui/styles/community-challenges.css`: la regla `.community-card-link` (linea 32) pasa su `border-top` y `margin-top` al nuevo `.community-card-foot { display:flex; align-items:center; justify-content:space-between; }`.
  - Quitar `.community-challenge-item .like { justify-self: end; }` de `src/ui/styles/likes.css`.
  - Misma estructura en `InviteCard` (linea ~151-152, `Ver invitacion`) y en `src/ui/pages/CommunityReto.tsx`.
- Los 44 px del boton se mantienen (`.like-btn`, `likes.css`).

### 2. Banda plana en la busqueda de rutas a pantalla completa (medio, S)

- Que se ve: en `docs/design/2026-11-17-loading-cartografia/carga-390-dark.png` la escena (ciclista y lineas) termina en un borde recto
  a ~685 px. Debajo empieza el estado con otro tono. Entre el ciclista y ese borde hay una banda lisa.
- Por que molesta: la pantalla parece partida en dos cajas. El estado ("Cargando las rutas...") queda desconectado del dibujo.
- Causa: `src/ui/components/RouteLoadingScene.css`, regla `.route-loading-scene`, lleva
  `background: linear-gradient(180deg, var(--cv-paper), color-mix(in srgb, var(--cv-sage) 70%, var(--cv-paper)) 95%)`.
  El gradiente acaba en un tono mas claro que `.card` (`--surface`), que es el fondo del cuerpo. En movil la escena crece con `flex: 1`, asi que ese tono se ve en toda la banda.
- Cambio: dentro de `@media (max-width: 600px)` en `src/ui/routes/RouteSearchLoading.css` (linea ~69-82), anadir
  `.route-search-overlay .route-loading-scene { background: none; }`.
  Asi la tarjeta sigue siendo `--surface` de arriba a abajo y no hay borde.
  Si se quiere separar el estado, anadir `border-top: 1px solid var(--line)` a `.route-search-loading__body`, dentro de esa misma media query.
- Comprobar despues en claro y oscuro. El SVG ya trae su propia linea de suelo (`--cv-blue`).

### 3. Rutas: la Biblioteca queda escondida bajo dos desplegables (medio, S)

- Que se ve: en `capturas/rutas-390-dark.png`, tras el formulario van "¿Buscas en Ride with GPS Explore?" y "¿Buscas en Wikiloc?" (~66 px cada uno).
  La "Biblioteca de rutas" empieza justo en el borde inferior, tapada por la barra.
- Por que molesta: la Biblioteca es una accion propia y frecuente. Los desplegables son ayuda para un flujo secundario, y van por delante.
- Cambio: ordenar formulario, Biblioteca de rutas, y al final un solo desplegable "Traer una ruta de otra web" con Explore y Wikiloc dentro.
  Alternativa mas barata: solo mover la tarjeta Biblioteca encima de los desplegables.
- Donde: `src/ui/pages/Rutas.tsx` (orden de los bloques). Los desplegables usan `src/ui/components/Disclosure.tsx`.

### 4. Biblioteca comun: demasiados controles antes del contenido (medio, S)

- Que se ve: `docs/design/2026-11-17-biblioteca-comun/lista-dark-390.png`. Etiqueta, buscador, boton "Filtrar y ordenar" a ancho completo y "24 rutas":
  la primera ruta arranca a ~465 px. Historial, en `capturas/historial-390-dark.png`, hace lo mismo en una sola fila (buscador + boton de 50 px).
- Por que molesta: en un movil de 700 px visibles se ve una sola ruta. Y es una inconsistencia con Historial.
- Cambio: usar el mismo patron `.toolbar` de Historial (buscador + icono de filtro de 50 px con el contador de filtros activos como punto).
  Quitar la etiqueta visible (dejarla como `aria-label`, el placeholder ya orienta).
- Donde: `src/ui/library/CommonLibrary.tsx` lineas 108-109 (`Field` + `.lib-filter-btn`), reutilizando `.toolbar` de `src/ui/styles/kit.css` (linea 881-882).

### 5. Plan: dos mensajes de vacio seguidos (medio, S)

- Que se ve: `capturas/plan-390-dark.png`. Dentro de la tarjeta de la semana: "Nada planificado esta semana." Debajo, "Proponer semana con IA", y debajo otra tarjeta
  grande: "Aun no has planificado nada".
- Por que molesta: el mismo mensaje dos veces y dos bloques de ~100 y ~230 px antes de la accion primaria ("Planificar", cortada por la barra).
- Cambio: cuando no hay nada en toda la agenda, dejar solo el estado vacio con sus dos acciones (planificar e IA) y ocultar la linea "Nada planificado esta semana".
  Con datos, no cambia nada.
- Donde: `src/ui/calendario/` (vista semana; la linea de la tarjeta) y la pagina `src/ui/pages/Plan.tsx`. Estilos: `src/ui/styles/plan.css`.

### 6. Ajustes: "Instalar la app" desactivado ocupa el primer sitio (medio, S)

- Que se ve: `capturas/ajustes-390-dark.png` y `capturas/ajustes-390-light.png`. Un boton ancho, casi invisible (`opacity: .45`),
  y tres lineas de instrucciones del navegador. Es lo primero que se ve en Ajustes, y no se puede pulsar.
- Por que molesta: parece un boton roto. Pasa justo antes de los ajustes reales.
- Cambio: si `available` es falso, no mostrar el boton. Dejar una sola linea de ayuda, o mover todo a una fila al final con el resto ("Instalar la app" como fila de lista).
  Si el boton esta activo, mantenerlo como ahora.
- Donde: `src/ui/components/InstallApp.tsx` (`disabled={!available}`) y su sitio en `src/ui/pages/Ajustes.tsx`. La opacidad esta en `.btn[disabled]`, `src/ui/styles/kit.css:237`.

### 7. Reto de ruta: reglas largas y pequenas (medio, S)

- Que se ve: `docs/design/2026-11-17-reto-ruta/reto-ruta-marcador-390.png`. Debajo del marcador, "Asi cuenta tu esfuerzo": tres parrafos
  de unos 12 px, en gris, con ~15 lineas seguidas.
- Por que molesta: es informacion necesaria pero ocupa una pantalla al final y se lee mal. Las filas del marcador tambien son muy altas para la poca informacion
  (nombre, "Actualizado ...", tiempo).
- Cambio: meter el bloque en un `Disclosure` cerrado, "Asi cuenta tu esfuerzo". Subir el texto a 13 px (ver hallazgo 8).
  En las filas del marcador, bajar `padding: 18px 14px` a `14px`.
- Donde: `src/ui/pages/CommunityReto.tsx` linea 126 (`aside.community-rules`); `src/ui/styles/community-challenges.css` lineas 80-86 y 71.

### 8. Texto secundario a 12 px en la comunidad (medio, S)

- Que se ve: en `docs/design/2026-11-17-me-gusta/retos-390-dark.png` y `docs/design/2026-11-17-retos-movil/implementado/retos-390-dark.png`: "Duelo · 2/2 participantes · Hasta 23 nov, 14:18",
  "Kilometros", "Se actualiza cada 30 s" y el pie de privacidad van a 11-12 px en `--ink-3`.
- Por que molesta: es la informacion que dice cuando acaba el reto. Con luz solar en el movil se pierde. En las pantallas de Historial e Inicio el texto equivalente va a 13 px.
- Cambio: subir a 13 px y usar `--ink-2` en los datos que importan (plazo, participantes). Dejar `--ink-3` solo para pie y ayudas.
  Hay que medir el contraste de `--ink-3` sobre `--surface` en claro y oscuro (el fichero `contraste.json` de hoy salio vacio, hay que repetirlo).
- Donde: `src/ui/styles/community-challenges.css` lineas 29 (`.community-challenge p`), 32 (`.community-card-link`), 86 (`.community-rules p`) y 160.

### 9. Inicio: "Carga y forma" sin datos (bajo, S)

- Que se ve: `capturas/inicio-390-dark.png`. Tarjeta de ~170 px con cabecera y un parrafo de 4 lineas que dice que no hay pulso ni potencia.
- Por que molesta: sin sensor no hay nada que hacer, y empuja "Tus datos" casi 200 px mas abajo en cada visita.
- Cambio: con `gate.state === 'empty'`, dibujar una sola fila compacta (icono + titulo + frase corta de una linea), no la tarjeta completa.
  Los otros dos estados se quedan como estan.
- Donde: `src/ui/inicio/LoadCard.tsx` (rama `gate.state === 'empty'`, linea ~62) y `.load-empty` en `src/ui/styles/carga.css`.

### 10. Mas: subtitulo cortado (bajo, S)

- Que se ve: `capturas/mas-390-dark.png`. "Ciclistas: Toda la comunidad, por actividad recie…".
- Por que molesta: la frase pierde el sentido. El resto de filas caben enteras.
- Cambio: acortar el texto ("Toda la comunidad") o permitir dos lineas.
- Donde: `src/ui/styles/mas.css:8` (`.page--mas .row-meta { white-space: nowrap; ... }`). Texto en `src/ui/mas/masSummary.ts`.

### 11. Cabeceras: iconos de accion con dos estilos (bajo, S)

- Que se ve: en Inicio (`capturas/inicio-390-dark.png`) los dos iconos de la cabecera van en circulos con borde y relleno.
  En Historial (`capturas/historial-390-dark.png`), Rutas y Mas van sueltos, sin circulo.
- Por que molesta: parecen controles distintos. Lo que va sin circulo se ve menos tocable aunque el area de 44 px exista.
- Cambio: elegir uno. Propuesta: sin circulo en todas las pantallas (Inicio es la excepcion porque va sobre la imagen del paisaje, ahi el circulo tiene sentido y se puede dejar).
  Si se quiere una regla simple: circulo solo sobre imagen (`.icon-btn--glass`).
- Donde: `src/ui/components/AppBar.tsx` (acciones) y `.icon-btn`, `.icon-btn--filled`, `src/ui/styles/kit.css` lineas 247-251.

### 12. Salida: "Frente a tu media" con valores iguales (bajo, M)

- Que se ve: `capturas/salida-390-dark.png`. En "Desnivel" y "Velocidad media" el punto aparece con trazos verticales encima y debajo,
  y no en una linea horizontal como en "Distancia" y "Tiempo".
- Por que molesta: parece un fallo de dibujo. Pasa cuando el rango de tus salidas es cero (con datos sinteticos todas iguales; con datos reales pasa con pocas salidas).
- Cambio: si `max - min` es 0, dibujar la linea horizontal con el punto en el centro y la marca de "Tu media" en el mismo sitio. Sin trazos verticales.
- Donde: el componente de la comparacion en `src/ui/pages/Salida.tsx` y su CSS en `src/ui/styles/` (buscar la clase de la fila "vs media"). Es calculo de posiciones en la vista, no toca `src/metrics`.

### 13. Retos vacio: CTA con otro ancho (bajo, S)

- Que se ve: `docs/design/2026-11-17-retos-movil/implementado/retos-vacio-390-dark.png`. "+100 km esta semana" mide ~190 px y va a la izquierda; "Reto a medida" es un enlace
  suelto debajo. En Subidas y Repetidas (`capturas/` de hoy), el CTA va centrado.
- Por que molesta: es la accion principal de la pantalla, y no se alinea con nada.
- Cambio: `btn--block` en el CTA primario y "Reto a medida" como `btn--secondary` bloque, o ambos centrados como en los demas estados vacios.
- Donde: `src/ui/retos/RetosEmpty.tsx` linea ~49.

### 14. Amigos: buscador sin placeholder (bajo, S)

- Que se ve: `docs/design/2026-11-17-retos-movil/implementado/amigos-390-dark.png`. Un recuadro vacio bajo "Buscar entre tus amigos".
  En la Biblioteca el mismo patron lleva placeholder ("Pantano, Navacerrada...").
- Por que molesta: con solo 2 amigos parece un hueco o un campo roto.
- Cambio: anadir `placeholder="Nombre o @usuario"`, y mostrar el buscador solo si hay mas de 5 amigos.
- Donde: `src/ui/pages/Amigos.tsx` linea 133.

## Lo que esta bien (no tocar)

- Barra inferior: 5 pestanas con icono y texto, zona de 44 px, insignia en Retos. Clara en oscuro y claro.
- Estados vacios de Subidas y Repetidas: icono, titulo, dos lineas de explicacion y un CTA. Consistentes entre si.
- Estado de error de la Biblioteca comun: dice que paso, que se conserva y ofrece "Reintentar".
- Hoja de filtros de Historial: titulo, cerrar, chips de 44 px de area, "Restablecer" y "Ver 12 salidas" fijos abajo.
- Importar: una accion principal clara y la ayuda de Strava en pasos. Login y Objetivos: jerarquia limpia, sin desbordes.
- Avisos en Ajustes (`docs/design/2026-11-17-avisos/desactivados-390-dark.png`): interruptor con explicacion corta.
- Claro y oscuro: Inicio y Ajustes se comportan igual en `capturas/ajustes-390-light.png`, sin perdida de contraste visible.
- "Mas" muestra "Aun no has importado" con 12 salidas en la cabecera. Es casi seguro un efecto del dato de prueba (sin `lastImportAt`), no un fallo. Confirmar con datos reales.

## 3. Lotes propuestos

Orden pensado para que cada lote se pueda revisar con capturas a 390 px y revertir por separado.

1. Lote 1, los dos del usuario mas retoques de una linea: hallazgos 1, 2, 10, 13, 14. Solo CSS y mover un elemento. Se prueba en Retos y en la busqueda de rutas.
2. Lote 2, menos scroll antes de lo importante: hallazgos 3, 4, 5, 6, 9. Reordenar o compactar bloques en Rutas, Biblioteca, Plan, Ajustes e Inicio. No cambia datos.
3. Lote 3, legibilidad de la comunidad: hallazgos 7, 8. Subir tamanos, medir contraste de `--ink-3` y plegar las reglas del reto de ruta.
4. Lote 4, consistencia y pulido: hallazgos 11, 12. Decidir el estilo de los iconos de cabecera y arreglar el caso de rango cero en "Frente a tu media".
