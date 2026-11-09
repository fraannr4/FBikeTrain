# Requisito prioritario: experiencia mobile-first

Añadido por el usuario el 2026-11-06 al objetivo «terminar la app». **La experiencia móvil es el principal criterio de calidad de todo el proyecto.** El escritorio debe quedar cuidado y profesional, pero ante cualquier duda manda el móvil.

## 1. Diseño

- Mobile-first de verdad: primero el smartphone, después la tablet y el escritorio.
- Más esfuerzo y refinamiento en el móvil que en el escritorio.
- Debe sentirse como una app nativa premium, no como una web comprimida.
- Ergonomía para usarla con una sola mano, navegación intuitiva, buena legibilidad y rapidez.
- Nada de pantallas saturadas, tablas difíciles de leer, elementos pequeños ni acciones que pidan precisión.
- Si una pantalla necesita otra composición en el móvil, se rehace. No hay que conservar la estructura del escritorio.

## 2. Experiencia de uso

- Navegación móvil intuitiva y accesible, con una jerarquía visual clara.
- Zonas táctiles de al menos 44×44 px.
- Tarjetas, gráficas y estadísticas pensadas para el móvil.
- Formularios simplificados.
- Menús, modales, filtros y selectores táctiles: hojas inferiores (bottom sheets), segmentados y gestos donde aporten.
- Estados de carga, error y vacío bien resueltos, con respuesta visual a cada acción.
- Microinteracciones sutiles que no penalicen el rendimiento. Respetar `prefers-reduced-motion`.

## 3. Contexto de uso

El usuario consulta la app:
- antes de salir;
- durante la salida, de un vistazo;
- después de entrenar, para analizar;
- en cualquier momento, con poco tiempo.

Por eso hay que priorizar:
- la consulta rápida y las métricas clave arriba;
- gráficas legibles en 360-430 px;
- las acciones principales a un toque, sin navegar de más.

## 4. Recursos

Usar de verdad los agentes de UI/UX (`cycling-ui-designer`), de frontend (`cycling-frontend-dev`) y de QA (`cycling-qa`), los workflows de diseño y revisión, y las skills de diseño:
- `frontend-design`, `ui-ux-pro-max`, `impeccable`, `emil-design-eng`;
- las de animación;
- `web-design-guidelines` y `break-ui`.

Además:
- Playwright con emulación de dispositivos;
- un subagente por pantalla para revisar la usabilidad.

## 5. Proceso iterativo, obligatorio

1. Auditar cada pantalla como un usuario que solo usa el móvil.
2. Encontrar los problemas de navegación, diseño, usabilidad y jerarquía.
3. Rediseñar lo que lo necesite.
4. Implementar.
5. Revisar en varias resoluciones con capturas reales: 360×780, 390×844, 412×915 y 430×932. Incluir el modo apaisado y los dos temas.
6. Comprobar que no hay desbordamientos, elementos cortados, scroll innecesario ni interacciones deficientes.
7. Iterar hasta que quede pulido. No darlo por terminado antes de tiempo.

## 6. Criterio de aceptación

- No basta con que sea responsive o funcione. Tiene que ser visualmente excelente, intuitivo, coherente y cómodo en el smartphone.
- Acabado comparable al de las mejores apps deportivas comerciales.
- Hay libertad para cuestionar y mejorar las decisiones de diseño existentes.
