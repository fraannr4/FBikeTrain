# Inicio en escritorio · propuestas · 2026-11-10

Propuesta **A elegida por el usuario e implementada**. Rama `codex/escritorio-inicio`, worktree `C:\testTrain-codex-escritorio-inicio`, base `main` en `650a510`. Sin commit, push ni despliegue. Se conservan aquí las maquetas de la fase 1.

Las tres conservan B Trazado, Barlow / Barlow Semi Condensed y los tokens actuales. Cabecera de lado a lado del área de contenido, un único paisaje continuo, saludo a la izquierda, cota junto al vértice y cuatro KPI en una sola fila. Solo se redistribuyen componentes existentes.

| Propuesta | Composición | 1440 × 900 | 1920 × 1080 |
|---|---|---|---|
| **A · Franja de planificación (elegida)** | Texto semanal y próximo entreno en una franja bajo el paisaje. Mapa y gráfica debajo, con igual ancho y altura. | [Ver PNG](propuesta-a-1440x900-claro.png) | [Ver PNG](propuesta-a-1920x1080-claro.png) |
| **B · Entreno en la cabecera** | Próximo entreno integrado al pie de la cabecera. Texto semanal debajo; mapa y gráfica en dos columnas de igual altura. Agrupa lo necesario antes de salir en un solo bloque superior. | [Ver PNG](propuesta-b-1440x900-claro.png) | [Ver PNG](propuesta-b-1920x1080-claro.png) |
| **C · Mapa protagonista** | Mapa y detalle a la izquierda. A la derecha, texto semanal, próximo entreno y gráfica apilados. Las dos columnas terminan a la misma altura. | [Ver PNG](propuesta-c-1440x900-claro.png) | [Ver PNG](propuesta-c-1920x1080-claro.png) |

## Alcance y comprobación

- PNG a tamaño exacto, escala 1:1, modo claro. Sin scroll horizontal; los bloques principales caben dentro de cada vista. «Tus datos» sigue después, en el flujo normal de la página.
- Maquetas compuestas en Chromium con DOM, SVG, fuentes y CSS de la build real. Ajustes temporales de composición y geometría en el navegador; no son una implementación ni imágenes generadas con IA.
- Datos sintéticos derivados de `e2e/seed.ts` y del fixture ORS existente, con fecha fija 10 de noviembre de 2026: esta semana sin salidas, última salida anterior y sin entrenos planificados. No se inventan módulos, textos, recorridos ni estadísticas de usuario.
- El mapa usa el circuito sintético del test sobre teselas neutras, como `e2e/escritorio.spec.ts`; no representa una cartografía nueva ni un cambio propuesto al mapa real.
- Captura de referencia: `e2e/escritorio.spec.ts -g "1920 light"`, 1/1 correcto, incluido contraste. Referencias móviles a 390 px en claro y oscuro: 2/2 correctas. Guardadas localmente en `escritorio-maquetas.local/` para la fase 2.
- Verificados en las seis maquetas: ancho completo de la cabecera, cuatro KPI en una fila y desbordamiento horizontal de 0 px. En A/B se comprueba además la misma altura de mapa y gráfica.

## Implementación A

Cabecera panorámica, cuatro KPI en fila y franja de planificación desde 1024 px. Si hay un entreno, la ficha usa todo el ancho de la franja, con acciones al lado y texto semanal en su propia línea: evita dejar un bloque alto vacío junto al texto. Los objetivos se mantienen debajo. Mapa y gráfica comparten altura; la tabla y los nombres largos pueden crecer sin recortes. El móvil conserva su estructura y estilos anteriores.

Captura de la implementación a 1440 × 900 en claro: [Ver](implementacion-a-1440x900-light.png). Las demás capturas de comprobación (1024/1920, oscuro, vacío, entreno largo y móvil 390 antes/después) se regeneran con `e2e/escritorio.spec.ts` y no se versionan.

Verificación al fusionar: `npx tsc --noEmit` correcto, `npx vitest run` 1297/1297 y `e2e/escritorio.spec.ts` + `e2e/inicio.spec.ts` 14/14. Todos los datos y recorridos de las capturas son sintéticos; las teselas neutras son las del fixture de pruebas.
