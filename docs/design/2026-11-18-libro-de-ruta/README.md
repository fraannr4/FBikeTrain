# Dirección creativa «Libro de ruta» (2026-11-18)

Evolución de «Relieve grabado». Encargo del usuario: que el frontend deje de parecer un panel correcto y genérico y tenga identidad propia, primero en el móvil. Este documento recoge la investigación, la auditoría, la dirección elegida y la especificación que siguen los agentes.

## 1. Investigación (resumen con fuentes)

Hecha con búsqueda y lectura web el 2026-11-18. Lo marcado «sin fuente abierta» es conocimiento general.

| Principio | Por qué funciona | Fuente |
|---|---|---|
| Lo que no se ha ganado la atención, retrocede | La navegación en reposo baja de luminosidad; solo el contenido y la pestaña activa llevan contraste | Linear, https://linear.app/now/behind-the-latest-design-refresh |
| La estructura se siente, no se ve | Separar con espacio y cambio de superficie, no con un borde en cada tarjeta | Linear, misma fuente |
| Un color, un oficio | Whoop solo usa verde, amarillo y rojo, siempre con el mismo significado | https://www.925studios.co/blog/whoop-design-breakdown (secundaria) |
| Una línea por elemento | Flighty enseña solo los campos que importan en cada fase, como un panel de aeropuerto. Apple Design Award 2023 | https://blakecrosley.com/guides/design/flighty (lectura de un analista) |
| Cifras antes que gráficas, en tres capas | Nivel 1: tres cifras. Nivel 2: tendencia. Nivel 3: detalle | Whoop, misma fuente secundaria |
| Lenguaje humano sobre la cifra | Gentler Streak convierte cifras en un estado del día. Apple Design Award 2024 | https://sketch.com/blog/gentler-streak |
| En oscuro, la elevación es luminosidad | Sin sombras negras; superficies con L creciente | Material 2 (vía búsqueda, página no extraída) |
| Cara expresiva solo en títulos | Linear: Inter Display para titulares, Inter para el resto | Linear, primera fuente |
| Cifras tabulares solo en datos | Las cifras que se comparan no deben bailar | https://bjrn.vercel.app/blog/tabular-nums-usage-and-comparison |

No se pudo abrir documentación primaria de Komoot, Garmin, intervals.icu, TrainingPeaks, Arc, Raycast ni Revolut.

Anti-patrones de una app deportiva genérica: todas las métricas en tarjetas iguales; color decorativo; una sola fuente con cifras que bailan; vacíos con «No hay datos»; gráficas sin anotar; cifras sin lectura.

## 2. Auditoría del frontend actual (capturas a 390 px, datos de ejemplo)

Se conserva:
- La pantalla de salida: mapa a sangre, perfil por pendiente con las subidas numeradas y «Frente a tu media». Es la mejor pantalla y marca el camino.
- La frase humana del inicio («Mañana toca Lluçanès…»), el hito de fecha, la escala de pendiente, las curvas de nivel, el ciclista de las esperas.
- Verde bosque, tinta crema y azul del trazado: marca aprobada.

Genérico o flojo:
- Inicio es una pila de tarjetas con borde, mismo radio y un icono en recuadro en cada cabecera. El paisaje del hero casi no se ve detrás de cuatro KPI de vidrio iguales.
- El azul hace de todo: botón, enlace, pestaña activa, barra, día de hoy, métrica de distancia. No significa nada.
- La jerarquía tipográfica es plana: casi todo entre 15 y 26 px, sin una voz dominante por pantalla.
- La barra inferior usa la píldora de Material.
- Historial, Rutas y Plan heredan el mismo kit de cajas; los vacíos van dentro de otra caja con un icono en recuadro.

## 3. Direcciones comparadas

| | Instrumento (ciclocomputador) | Cartografía editorial | Libro de ruta |
|---|---|---|---|
| Idea | Negro, una señal ámbar, cifras mono | Mapa como héroe, serif | Perfil de etapa, rótulo de puerto, ficha técnica |
| Encaje con la marca aprobada | Bajo: abandona el verde | Medio | Alto: hito, pendiente y curvas ya existen |
| Sin red y rendimiento | Bueno | Malo: depende de teselas | Bueno: SVG con datos propios |
| Riesgo | Cliché «negro + un acento» | Cliché «crema + serif» | Ruido si se abusa |

Elegida: **Libro de ruta**. Toma de la primera la ficha en una línea y de la segunda las curvas de nivel que ya hay.

## 4. Especificación

### Principios
1. **Una voz por pantalla.** Un solo elemento grande (una cifra o un título rotulado). El resto, callado.
2. **Cajas solo para objetos.** Una caja es algo que se abre o se rellena: una salida, una ruta, un entreno, un formulario. Las secciones se separan con aire y una regla fina.
3. **Un color, un oficio.** Crema: texto y acción principal. Azul: tu trazado, «ahora» y enlaces. Ámbar: altitud y puertos. Naranja: la ruta sobre el mapa. Verde y rojo: solo estado.
4. **Ficha técnica.** Cifras tabulares alineadas, unidad pequeña, una línea por elemento.
5. **El perfil es la firma.** El perfil por pendiente y el rótulo de cima aparecen donde haya una salida o una ruta.
6. **El movimiento responde.** Solo se mueve lo que el usuario acaba de tocar, más el trazado inicial que ya existe.

### Tipografía
- Títulos y cifras grandes: **Big Shoulders Display** 700 y 800 (OFL-1.1, `@fontsource/big-shoulders-display`, solo `latin`). Rotulación urbana condensada; cifras muy reconocibles. Elegida frente a Barlow Condensed, Sofia Sans Extra Condensed, Saira Condensed y Archivo con una lámina de prueba.
- Texto e interfaz: Barlow 400/500/600 (sigue).
- Cifras de lista: Barlow Semi Condensed 700 con `tabular-nums` (sigue).
- Token nuevo `--font-display`. Sin mayúsculas forzadas ni antetítulos espaciados. Mínimo 12 px.

| Uso | Familia | Tamaño móvil |
|---|---|---|
| Cifra titular de pantalla | Display 800 | clamp(64px, 19vw, 88px), interlínea 0,86 |
| Título de página y saludo | Display 800 | clamp(40px, 11vw, 52px), interlínea 0,95 |
| Frase del inicio | Display 700 | 26 px, interlínea 1,08, tinta 2 |
| Título de sección | Display 700 | 24 px |
| Nombre de salida, ruta o entreno | Display 700 | 22-24 px |
| Cifra secundaria de ficha | Display 700 | 30 px, unidad Barlow 500 13 px |
| Texto | Barlow 400 | 15 px |
| Etiqueta | Barlow 500 | 13 px, tinta 3 |

### Color y superficie
- Los tonos no cambian. Cambian los oficios (principio 3).
- Acción principal: fondo `--ink`, texto `--bg`, en los dos temas. Tokens `--primary` y `--on-primary`.
- Regla fina: `--rule`, tinta al 14 %. Sustituye al borde de las cajas.
- Cajas que quedan: `--surface` sin borde. Radios más secos: 16 / 12 / 10 / 8; las pastillas siguen.
- Sin vidrio fuera de la barra inferior y de lo que flota sobre un mapa.

### Composición
- Móvil: texto con margen de 16 px; perfil, mapa y gráficas a sangre. 40 px entre secciones.
- Inicio: saludo rotulado, frase, perfil de la última salida visible y a sangre con su rótulo de cima, cifra de la semana a 64-88 px y las otras tres en una línea sin cajas.
- Barra inferior: muelle flotante con margen, sin píldora; una raya azul corta se desliza hasta la pestaña activa.
- Vacíos y errores: sin caja, alineados a la izquierda, título rotulado y una acción.

### Puertas de calidad
Contraste AA en los dos temas, objetivos táctiles de 44 px, `prefers-reduced-motion`, sin texto por debajo de 12 px, sin desbordes a 360, 390 y 430 px, escritorio revisado a 1440 px.

## 5. Implantación (2026-11-19)

Hecha en tres tandas, cada una revisada con capturas reales: bases e Inicio en el móvil; el resto de pantallas del móvil; tablet, escritorio y pulido.

Diferencias con la especificación:
- La cifra titular usa `clamp(64px, 22vw, 88px)` en el móvil (`--fs-figure`) y `clamp(96px, 9.2vw, 136px)` en escritorio (`--fs-figure-wide`).
- Menos de 900 px: composición del móvil con el muelle, también en la tablet en vertical. De 900 a 1023 px: carril y una columna. Desde 1024 px: composición de escritorio.
- En el mes de Plan en escritorio, el día elegido señala solo la cifra con un disco crema; la celda entera en crema pesaba demasiado.

No usado, por presupuesto: el workflow `develop-phase` y las skills `ui-ux-pro-max` e `impeccable` completas. Pendiente y límites: `docs/ESTADO.md`.
