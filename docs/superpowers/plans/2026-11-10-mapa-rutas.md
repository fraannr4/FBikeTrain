# Mapa de rutas: diagnóstico y corrección

Worktree `C:\testTrain-mapa-rutas`, rama `codex/mapa-rutas`, base `main` en `650a510`. Sin commit, push ni despliegue.

## Causas demostradas antes de modificar producción

1. En claro el halo y el hilo estaban desactivados por `--glow: 0` y `--thread: 0`. Quedaba un núcleo azul de 3 px sobre las líneas azules/moradas de CyclOSM. En oscuro el halo también era azul. Capturas de la aplicación con teselas reales primero a 390 px y después a 1440 px.
2. `toCardData` transforma **todas** las coordenadas ORS en `shape`, sin simplificarlas. Leaflet hace su simplificación visual habitual, de aproximadamente un píxel; no explica grandes puntas. `RideMap` ya recreaba y encuadraba el mapa al cambiar `points`, y `ResizeObserver` volvía a encuadrarlo al cambiar tamaño. La prueba de navegador sobre la base verifica que la línea queda dentro del mapa en ambos casos. No se ha reproducido un fallo de esos mecanismos. Sí se midió que, con ventana de 900 px, el panel empezaba en y=125,44 y medía 796 px: acababa en y=921,44, fuera de la ventana. Tras pasar de tarjeta podía quedar parcialmente por encima de la ventana.
3. El generador filtraba firme, vías y longitud, pero no la forma. Una regresión sintética muestra que elegía una ruta con una punta de ida y vuelta antes que una vuelta simple de igual longitud. El límite de búsquedas era 8 + 8 semillas adicionales; una regresión da **16 consultas** cuando todas llevan pista moderada y **8** aunque bastaban **2** rutas. Además IA repetía hasta tres semillas por cada objetivo del plan, multiplicando el consumo.

Los tres tests de regresión del generador fallaron primero sobre el código original: `8 != 2`, `16 >= 8` y candidata `0` en vez de `1`.

## Implementación

- Trazado geográfico bermellón (`--map-route`, #DD4215 claro / #FF8756 oscuro), hilo de 4 px, borde oscuro de 7 px y borde blanco opaco de 10 px. El doble borde mantiene separación cuando el fondo tiene colores similares. No se modifica el azul global `--trace` de la marca. Se atenúa ligeramente la saturación de las teselas en claro y se usa el panel `tint` existente. En forced-colors se conservan los tres bordes con Canvas, CanvasText y Highlight; conectores en LinkText y patrones distintos. Leyenda de Empalmar coherente.
- Altura del panel de escritorio descontando cabecera y pie; aislamiento/recorte del mapa. Botón accesible de 44 px «Encuadrar ruta» para recuperar la vista tras zoom o arrastre. Se conservan los mecanismos automáticos existentes.
- Calidad geométrica sobre muestreo a 20 m: corredores recorridos al revés durante al menos 200 m y lazos locales de 200–1500 m. Penaliza la puntuación; esas candidatas no detienen la búsqueda anticipadamente y se conservan con aviso como respaldo si no hay una vuelta limpia. No se recorta, suaviza ni inventa geometría exportable.
- Máximo **6 consultas por operación**, en orden; parada al obtener suficientes candidatas limpias y distintas. Sin `EXTRA_SEEDS`. IA reparte ese mismo presupuesto entre todos los objetivos. Se conserva el respaldo con aviso por firme/longitud y el manejo de 5xx, ausencia de ruta, cancelación y resultados parciales. Una regresión adicional corrigió que las tarjetas IA sobrescribían y ocultaban los avisos del generador.

## Límites

- No existe garantía de producir una ruta si ORS no encuentra carreteras, solo devuelve autopistas o todas las candidatas exceden los límites de respaldo. No se elimina ese filtro para llenar la pantalla.
- Seis consultas es un presupuesto por operación, no un limitador móvil de 60 segundos entre pestañas o búsquedas sucesivas. La cuota real del servidor sigue siendo la autoridad; no se ha cambiado ni desplegado el servidor.
- La geometría no prueba que un tramo sea urbano ni su tráfico/firme. Ramas paralelas muy próximas (por ejemplo 8 m) pueden parecer un retroceso dentro de la tolerancia de 15 m; por eso se penalizan y avisan, sin descartarlas definitivamente. Cruces, un ocho grande y una horquilla con ramas separadas pasan los fixtures.
- Las capturas usan geometría matemática sintética situada en el entorno público de Caldes de Montbui, sobre teselas reales de CyclOSM. No son rutas navegables ni tracks privados. Las pruebas funcionales simulan ORS y la IA; no gastan cuota real.

## Verificación

Pruebas focalizadas, tipos, suite completa y e2e de rutas con `PLAYWRIGHT_PORT=4178`: resultados finales en `docs/verificaciones.md`.

Capturas regenerables, excluidas por `*.local`: `mapa-rutas.local/antes` y `mapa-rutas.local/despues`. Ejecutar con `MAPA_CAPTURAS=1`; por defecto las teselas de la nueva prueba e2e son sintéticas para no depender de red. Baseline reconstruido directamente de `git archive 650a510`, sin modificar el código corregido ni crear otro worktree.

Mensaje de commit propuesto: `Fix route map contrast, loop quality and bounded ORS searches`.
