# Plataforma de ciclismo personal: especificación

Fecha: 2026-11-06. Propuesta visual y de producto: `docs/propuesta-ciclismo.html`. Referencia de interfaz: `docs/referencia-ui.png`. El diseño visual actual es provisional y se rehará más adelante.

## Objetivo

Una web gratuita, publicada en GitHub Pages, que:

- lee las salidas exportadas de Strava,
- muestra la progresión de cada usuario medida contra su propio nivel,
- genera rutas de bici de carretera para progresar, que se descargan en GPX para el iGPSPORT BSC200S.

## Decisiones

1. Sin suscripción de Strava: ni API ni conector MCP. No se hace scraping.
2. Los datos entran por importación manual:
   - una vez, el archivo «Descargar tu cuenta» de Strava (ZIP);
   - después, ficheros sueltos: FIT, GPX y TCX, que pueden venir comprimidos en `.gz`.
   - Strava sigue siendo la copia maestra.
3. Las salidas se guardan en una caché del navegador (IndexedDB), que se puede reconstruir reimportando. El calendario, los objetivos y los ajustes se protegen con «Exportar copia» y «Restaurar».
4. Funciones sin IA: panel de progresión, historial con detalle, rutas y subidas repetidas (tiempo, velocidad, VAM) y calendario manual.
5. La IA solo interviene en las rutas, con este flujo:
   - preguntas guiadas: qué trabajar, tiempo disponible, salida y si repetir zona o descubrir;
   - el código calcula un resumen del nivel del usuario;
   - la IA devuelve los objetivos de la ruta en un JSON con formato fijo;
   - OpenRouteService genera candidatas con el perfil `cycling-road`, en circular (`round_trip`);
   - el código filtra (asfalto, tipo de vía) y puntúa (cercanía al objetivo, carretera nueva);
   - el resultado es una lista de 3 a 5 rutas con una explicación que cita cifras, y cada una se descarga en GPX.
6. A la IA solo le llegan cifras resumidas. Nunca recibe tracks GPS ni la dirección de «Casa».
7. La IA corre en la nube, con un proveedor configurable compatible con OpenAI; Groq por defecto. Cada usuario pone su propia clave, que se queda en su navegador.
8. Las rutas las genera OpenRouteService. Cada usuario pone su propia clave.
9. El punto de salida es «Casa» por defecto; se confirma o se cambia en el mapa.
10. Amigos: usan la misma web, cada uno en su navegador.
11. Nivel adaptativo:
    - cada usuario tiene una referencia propia, calculada con sus últimas 8 a 12 semanas;
    - las etiquetas Suave, Media y Dura, los porcentajes y los distintivos se miden contra esa referencia;
    - las rutas propuestas apuntan entre un 5 y un 15 % por encima de la referencia;
    - con menos de 5 salidas, el usuario contesta 3 preguntas iniciales.
12. Sensores: GPS, velocidad y cadencia. Si un fichero trae pulso o potencia, se leen; si no, las tarjetas de pulso o potencia se ocultan.
13. Mapa: CyclOSM, sin vista de satélite. Las tarjetas de ruta muestran la forma de la ruta y su perfil coloreado por pendiente.
14. Tecnología: Vite, React y TypeScript. Repositorio público en GitHub.

## Fases

- F0: base técnica y comprobaciones.
- F1: importar y panel.
- F2: historial y repetidas.
- F3: calendario.
- F4: generador de rutas, sin IA.
- F5: rutas con IA.
