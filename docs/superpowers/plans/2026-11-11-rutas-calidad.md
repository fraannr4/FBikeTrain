# Calidad de rutas: diagnóstico, diversidad, puertos y biblioteca

Base: `main` d346a15. Rama `codex/rutas-calidad`. Sin commit, push ni despliegue.

## Diagnóstico antes de implementar

El flujo actual deja a ORS toda la geometría: la IA propone cifras y referenciaId, pero esta referencia no llega al generador. Cada opción busca por separado sin recordar lados. El primer resultado limpio puede detener la búsqueda sin ajustarse al desnivel. `round_trip` recibe longitud, cuatro puntos y semilla, nunca desnivel. El respaldo admite hasta 3 km de pista y las vías principales no penalizan dentro del umbral.

Seis casos ORS reales: Granollers, 40/60/90 km, objetivos de 5 y 15 m/km. Semillas fijas 1100/2200/3300, dos intentos por opción, seis como máximo por búsqueda. Informe y cifras en `docs/diagnostico-rutas-2026-11-11*`. Solo métricas persistidas, nunca tracks. Sin gastar consultas a un modelo para medir un motor GIS que no recibe el desnivel.

## Mini-plan de puertos (previo a implementación)

1. Operación `passes` de `route-sources`, autenticada, con cuota y caché actuales. Consulta Overpass de nodos `mountain_pass=yes` y `natural=saddle`, con nombre y ele, en anillo 15–40 km. Comprobar asociación con carretera apta; un collado de senderismo no basta. Coordenadas cuantizadas solo al buscador, nunca al modelo.
2. Sumar finales de subidas del historial local, deduplicar y filtrar por distancia. Cota desconocida queda null. La IA ve IDs, nombres, cotas y distancias, nada de tracks o Casa.
3. La IA elige `puertoId` opcional. ORS `path` calcula la vuelta con puntos reales de acceso y salida de la carretera del puerto; evitar el simple inicio-puerto-inicio que puede desandar toda la ida. Validar paso por el puerto, firme, autopista, distancia, desnivel y retrocesos. Si no hay vuelta aceptable, no atribuirle un puerto que no visita.

## Implementación por lotes

- [x] A. Pasar `usedSides` entre opciones y penalizar repeticiones; preferir lado nuevo antes de parar; tests de planificador y generador.
- [x] B. Puertos, contrato de IA y esquema compartido, fuentes Overpass e historial; tests de accesibilidad, privacidad, fallo de fuente y cancelación.
- [x] C. T3 biblioteca: enlace/autor GPX, referencias locales prioritarias, atribución honesta. Esqueleto local recortado/alargado/empalmado mediante hasta ocho puntos representativos y geometría íntegramente recalculada con ORS; nunca enviar puntos a la IA. No concatenar geometrías OSM discontinuas.
- [x] D. Penalizar vías principales y desajuste de desnivel al buscar, sin ampliar intentos. Los intentos dirigidos consumen el mismo presupuesto de seis; reserva para opciones siguientes y para respaldo `round_trip`. Sin llamadas adicionales a IA por candidato.
- [x] E. Repetir los seis casos con mismas semillas/objetivos, documentar mejoras y regresiones sin seleccionar solo éxitos. Separar ensayo de puertos/biblioteca cuando falte GPX real autorizado.
- [x] F. Revisiones de cumplimiento y calidad, `vitest`, `tsc`, build, SQL si cambia cuota, Playwright rutas/rutas-ia y capturas 360/430 px.

## Restricciones y decisiones

La petición actual limita IA a 12 operaciones/día/usuario, aunque la migración 202611100004 subió a 30. Preparar corrección posterior a 12 conservando contadores; no aplicar nada remoto. ORS mantiene seis por búsqueda. Los resultados con referencia solo pueden llevar «Basada en» cuando la geometría realmente usa su esqueleto. Una fuente caída no bloquea rutas tradicionales. La selección de pocos waypoints aproxima el GPX: no prometer conservar cada curva ni transitar un collado no verificado.

No hay cambios de diseño global. Las skills antiguas citadas por CLAUDE (`grilling`, `superpowers:*`) y su runtime Workflow no están disponibles en esta sesión; se conserva su secuencia de diagnóstico, plan, pruebas, implementación y revisión con agentes y comandos disponibles.

## Cierre (Claude, 2026-11-11)

Codex terminó A-D sin medir ni verificar. Claude integró la rama con `codex/fuentes-externas` (las dos implementaban las referencias de biblioteca; se conserva la de esta rama, que además usa el esqueleto, y se añaden de la otra los textos de ayuda, el `accept` del selector de archivos y el autor sin enlace), quitó la migración que bajaba la cuota de IA a 12 (la decisión vigente es 30, migración 202611100004), quitó la alternancia de 4 y 3 puntos, arregló la consulta de puertos y descartó las vueltas dirigidas de ida y vuelta. Mediciones en `docs/diagnostico-rutas-2026-11-11.md`.
