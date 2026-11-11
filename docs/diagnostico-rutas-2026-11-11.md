# Diagnóstico de calidad de rutas — 2026-11-11

Base main `d346a15`; worktree `codex/rutas-calidad`. Diagnóstico inicial terminado antes de modificar producción. No hay commit, push ni despliegue.

## Flujo y causas

1. `ai/routePlanner.ts` construye el resumen, consulta referencias y llama al modelo. `prompts.ts` y `schema.ts` restringen el modelo a 3–5 objetivos, 5–15 % sobre el nivel, una dimensión y referenciaId. El código limita por tiempo. La IA no decide carreteras ni coordenadas.
2. `ai/references.ts` convierte OSM/Wikiloc a nombre y cifras. Antes, referenciaId solo se usaba para poner «Basada en» al final: **ningún punto de esa referencia orientaba ORS**. Es una atribución sin fundamento geométrico.
3. `routes/generator.ts` pide `ors.ts` → `shared/orsService.ts` → ORS cycling-road round_trip. ORS elige toda la vuelta con inicio, longitud, seed y points=4. El desnivel pedido nunca llega a ORS. Seed aleatoria por opción; longitud corregida usando la mediana del exceso de las respuestas anteriores. Objetivo interno 94 %, filtro de distancia −20/+8 %.
4. `analyze.ts` mide distancia haversine y desnivel con histéresis a partir de coordenadas; filtra autopista, asfalto, pista y principal>20 %. `quality.ts` detecta corredores inversos >=200 m con tolerancia15 m y lazos200–1500 m sobre muestras20 m. Su retroceso cuenta solo la parte inversa. Son indicadores geométricos, no medidas de tráfico ni verificación física.
5. Puntuación `metrics/score.ts`: 70 % cercanía promedio (distancia/desnivel), 30 % novedad; exceso de distancia pesa triple. Resta penalización geométrica hasta0,65. Principal 0 % y19 % puntúan igual. Con count=1, primera limpia detiene la búsqueda, aun con desnivel muy diferente. `side.ts` solo diversifica dentro de cada llamada: el planificador no pasa lados anteriores. Centro calculado por vértices, sensible a densidad.
6. Cuando no hay limpia, el respaldo admite hasta3 km de pista y −40/+10 % de distancia con aviso. Vías principales sin techo en ese respaldo salvo autopista. Esto explica que aparezcan propuestas utilizables pero malas incluso tras los filtros previos.
7. `roadPath.ts` recalcula con directions de2–8 puntos; antes cuenta también pistas asfaltadas y no aplica filtro de autopista. `splice.ts` sí filtra autopista, pero conserva las geometrías de los GPX y solo recalcula conectores: no basta reutilizarlo para prometer toda una ruta recalculada.
8. `sources/schema.ts/client.ts`: rutas hasta25 km, cliente prueba Wikiloc apagado y OSM. `overpass.ts` solo relaciones ciclistas lcn/rcn/ncn, ascent=null; geometrías potencialmente discontinuas. `providers.ts`/`service.ts` aplican límites HTTP, autenticación, cuota3/min y30/día y caché7 días. `limits.ts` cuantiza y limita puntos. `wikiloc.ts` no elude bloqueos. No hay puertos ni biblioteca conectados al generador.

## Clasificación

| Causa | Evidencia | Impacto |
|---|---|---|
| Aleatoriedad round_trip | points=4 fijo, seeds independientes, sin orientación territorial | alto; misma longitud no implica vuelta atractiva |
| Prompt y contrato insuficientes | no hay puertoId ni esqueleto ejecutable; referenciaId decorativo | alto en selección; reescribir prosa por sí sola no cambia carreteras |
| Selección y puntuación | primera limpia; no penaliza principal <=20 %; desnivel solo a posteriori | alto; se desperdician candidatas útiles |
| Falta de puntos reales | Overpass no consulta puertos, historial/biblioteca no orientan | alto; no hay intención ciclista verificable |
| Respaldo permisivo | hasta3 km fuera de carretera y tolerancia−40 % | alto cuando solo sobreviven descartadas |

## Ensayo real antes

Inicio público fijo en Granollers, no Casa. Seis casos: 40/60/90 km, llano=5m/km y desnivel=15m/km. Tres opciones por caso, seeds1100/2200/3300 y dos intentos por opción (máximo6 por búsqueda). Visited vacío. Se reproduce la fase GIS del planificador con objetivos fijos, sin usar un LLM ni gastar su cuota. No mide la variabilidad del modelo. Se guardan exclusivamente cifras; respuestas ORS en memoria. La clave se lee de `.local-secrets` ajeno al repositorio.

Las rutas antes son iguales al cambiar solo el desnivel en cada distancia: evidencia directa de que round_trip no lo recibe. En60 km hay un lado repetido en ambas modalidades. Los llanos devuelven +187 % a+320 % de desnivel; algunas vueltas acumulan2120m de retroceso y dos lazos. Todas las propuestas devueltas llevan aviso de pista o de geometría; no se debe confundir «hay resultado» con «hay una vuelta limpia».

| Caso | Opción/seed | km | Principal % | Retroceso m | Lazos | Error km % | Desnivel m / pedido | Error desnivel % | Lado |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 40 llano | 1/1101 | 32.63 | 2.33 | 0 | 0 | -18.43 | 591 / 200 | 195.35 | 5 |
| 40 llano | 3/3300 | 37.46 | 14.41 | 0 | 1 | -6.34 | 575 / 200 | 187.45 | 6 |
| 40 desnivel | 1/1101 | 32.63 | 2.33 | 0 | 0 | -18.43 | 591 / 600 | -1.55 | 5 |
| 40 desnivel | 3/3300 | 37.46 | 14.41 | 0 | 1 | -6.34 | 575 / 600 | -4.18 | 6 |
| 60 llano | 1/1101 | 57.57 | 4.89 | 2120 | 1 | -4.05 | 878 / 300 | 192.53 | 5 |
| 60 llano | 2/2200 | 61.64 | 19.48 | 0 | 2 | 2.74 | 1261 / 300 | 320.33 | 4 |
| 60 llano | 3/3300 | 57.58 | 1.71 | 220 | 1 | -4.03 | 1224 / 300 | 307.9 | 5 |
| 60 desnivel | 1/1101 | 57.57 | 4.89 | 2120 | 1 | -4.05 | 878 / 900 | -2.49 | 5 |
| 60 desnivel | 2/2200 | 61.64 | 19.48 | 0 | 2 | 2.74 | 1261 / 900 | 40.11 | 4 |
| 60 desnivel | 3/3300 | 57.58 | 1.71 | 220 | 1 | -4.03 | 1224 / 900 | 35.97 | 5 |
| 90 llano | 3/3301 | 85.36 | 3.72 | 0 | 2 | -5.16 | 1688 / 450 | 275.2 | 3 |
| 90 desnivel | 3/3301 | 85.36 | 3.72 | 0 | 2 | -5.16 | 1688 / 1350 | 25.07 | 3 |

Lados:0 N,1 NE,2 E,3 SE,4 S,5 SO,6 O,7 NO,−1 alrededor del inicio. Las opciones ausentes no encontraron candidata dentro del respaldo: 40km opción2 y90km opciones1/2. 36 consultas ORS antes. Cifras crudas y rechazos en `diagnostico-rutas-2026-11-11-cifras.json`. Medición repetible con `node node_modules/vite-node/vite-node.mjs scripts/diagnose-routes.ts before|after` (requiere secreto local; no ejecutar en CI).

## Fuentes técnicas

- [ORS: funcionamiento de round_trip](https://ask.openrouteservice.org/t/description-of-round-trip-feature/4170): puntos en torno a una dirección determinada por semilla; la longitud es aproximada.
- [OSM mountain_pass](https://wiki.openstreetmap.org/wiki/Tag%3Amountain_pass%3Dyes) y [saddle](https://wiki.openstreetmap.org/wiki/Tag%3Anatural%3Dsaddle): un collado topográfico no garantiza carretera. Se comprobará asociación y paso por carretera.

## Después y verificación (Claude, 2026-11-11)

Codex dejó implementados los lotes A a D sin la medición final. Se integraron con la rama `codex/fuentes-externas` en `codex/integracion-rutas` y se midió con ORS real.

**Fase GIS (`round_trip`), mismos seis casos y semillas.** Primera medición «después» (`after_points_alternos` en el JSON): alternar 4 y 3 puntos en `round_trip` empeoraba la distancia (a 90 km salían vueltas de 61 y 71 km, antes 85). Se quitó la alternancia y se volvió a medir (`after`): cifras iguales al «antes». Con dos intentos por opción no hay margen para que la puntuación o los lados usados cambien el resultado. Ninguna vuelta sale limpia en ningún caso. Conclusión: retocar la puntuación de `round_trip` no mejora la calidad; la mejora tiene que venir de vueltas dirigidas por referencias reales.

**Puertos (lote B), probados directamente con Overpass y ORS desde Granollers.**
- La consulta original (`around` de 40 km con `way(bn.passes)`) agotaba el tiempo de Overpass (`Query timed out ... after 21 seconds`): en producción nunca devolvía puertos. Se cambió por un rectángulo, carreteras filtradas por tipo y asociación a la carretera más próxima a menos de 120 m (muchos collados se cartografían junto a la vía; Collformic quedaba fuera). El punto que recibe el motor es el vértice de la carretera. El fetch de proveedores de `route-sources` pasa de 10 a 25 s; la función sigue cortando a los 30 s.
- Overpass público sigue lento e irregular: 29-39 s por consulta y 2 fallos de 3 intentos en una tanda. La caché de 7 días amortigua, pero la primera consulta de cada zona puede fallar.
- Vuelta por un solo puerto (inicio, puerto, inicio): 7 de 7 eran ida y vuelta por la misma carretera, con 17-35 km de retroceso. Ahora el generador descarta toda vuelta dirigida con más del 15 % de retroceso (`MAX_INTENT_BACKTRACK`) y vuelve a `round_trip` sin atribuir el puerto.
- Triángulo con dos puertos: retroceso de 0,3-5 km, pero 4 de 5 cruzan pistas y salen de 86-100 km con 2.100-2.650 m. No se implementa: hace falta una red de carreteras ciclistas mejor que los collados de OSM.

**Conclusión.** La palanca con más efecto es la biblioteca: rutas reales (GPX de Wikiloc u otras) que el usuario importa y que el generador recorta, alarga o empalma con ORS (lote C). Los puertos quedan como apoyo, filtrados por retroceso.
