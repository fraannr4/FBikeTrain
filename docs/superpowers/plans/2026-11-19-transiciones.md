# Pulido de cargas y navegación

Petición: llevar la fluidez de la bienvenida al resto del frontend, conservando Libro de ruta y la marca.

- Auditar cargas, navegación principal y segmentados. El fundido de 140 ms se reiniciaba con una lectura síncrona de layout y terminaba antes de recibir los datos.
- Entrada de datos independiente de la ruta, solo con opacidad, sin desmontar formularios ni transformar contenedores con controles fijos. Duración de 320 ms y curva compartida con la bienvenida.
- Cabeceras con desplazamiento corto según el orden de las pestañas. Mantener navegación, scroll, hojas y foco. Segmentados sin forzar layout; precargar también Retos, quinta pestaña con cuenta.
- Aparición del ciclista y dibujo del trazado. Sin esperas mínimas, progreso inventado ni dependencias nuevas.
- Entrada de las vistas de retos y del cuaderno. Respetar movimiento reducido, incluso al activarlo durante una animación.
- Verificar con pruebas focalizadas, tipos, build y navegador a 360/390/412/430 px, apaisado y escritorio, ambos temas.

El usuario revisó el resultado local y autorizó commit, push y publicación el 2026-11-19. Resultados y límites en docs/verificaciones.md; el workflow de `main` valida y despliega al subirlo.
