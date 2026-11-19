# Distribución: pestaña «Gente» (lámina del 2026-11-19)

Abrir `lamina.html`: tema oscuro por defecto y `?theme=light` para el claro. Cada marco es un `<iframe>` del mismo fichero (`#p-a` … `#p-g` en el móvil y `?p=p-pc#p-pc` en escritorio), para que `@media` y `dvh` se comporten como en el teléfono. Capturas: `distribucion-390-oscuro.png`, `distribucion-390-claro.png`, `distribucion-1440.png` y `antes-ahora.png`.

**Por qué.** El usuario probó el chat y dijo que el acceso tenía que estar mejor integrado, en el Inicio y en todos lados, y que la distribución de la app le parecía mala. En el móvil lo social estaba en tres sitios: Retos en la barra inferior, Chat como icono arriba, y Amigos y Ciclistas detrás de la foto de perfil. Importar, Ajustes y la copia de seguridad estaban en «Más», a tres toques.

**Decidido por el usuario** (formulario del 2026-11-19): barra inferior `Inicio · Salidas · Rutas · Plan · Gente`; «Gente» reúne Chats, Amigos, Retos y Ciclistas; el icono de chat de arriba desaparece; la foto de perfil lleva a perfil, Importar, Ajustes, copia de seguridad y Privacidad, y «Más» desaparece; el Inicio gana «Tu gente»; todo sobre el estilo publicado «Libro de ruta», sin tokens nuevos.

**Qué se ve en cada marco.**

- A, Inicio con pendientes: el saludo y su escena bajan de 367 a 247 px. Debajo, «Hoy» con acceso a la ruta, «Tu gente» con lo pendiente (tres filas como mucho y «Ver todo») y el arranque de la semana.
- B, Inicio sin pendientes: «Tu gente» es una sola fila («Todo al día»), el muelle no lleva insignia y la semana sube entera a la primera pantalla.
- C, Gente · Chats (`#/chat`): la pestaña se abre aquí. El control de cuatro reparte en rojo la insignia del muelle; el azul sigue contando mensajes.
- D, Gente · Amigos (`#/perfil/amigos`): solicitudes arriba; cada amigo lleva «Escribir» y «Retar». «Quitar» pasa a su perfil.
- E, Gente · Retos (`#/retos`): el contenido de hoy; sus tres vistas pasan a filtros pequeños.
- F, Gente · Ciclistas (`#/ciclistas`): el buscador de siempre, sin su filtro «Amigos».
- G, Tú (`#/perfil`): Importar salidas, Ajustes, Copia de seguridad y Privacidad encima de tu ficha, a la vista sin desplazar.
- Escritorio, 1440 px: carril con Inicio, Salidas, Rutas y Plan, el grupo «Gente» con sus cuatro entradas y sus insignias, y «Tú» abajo.

Cada segmento conserva su dirección, así que los avisos push siguen abriendo donde toca. Dentro de una conversación el muelle se oculta, como hoy.

**Lo que cuesta.** `antes-ahora.png` cuenta los toques desde Inicio. Baja un toque llegar a un chat sin leer, a una solicitud de amistad, a Importar, a Ajustes y a la copia de seguridad. Sube un toque llegar a la lista de Retos (de 1 a 2); un reto por responder sigue a un toque, porque sale en «Tu gente».

**Comprobado** con el script de capturas, a 360, 390 y 430 px en los dos temas y a 1440 px: nada desborda, ningún texto por debajo de 12 px ni en mayúsculas forzadas, objetivos táctiles de 44 px y contraste mínimo de 4,63:1 en claro y 5,61:1 en oscuro. Sin comprobar: dispositivo real, foco con teclado, colores forzados y textos extremos.

**No dibujado.** Las pantallas que no cambian (Salidas, Rutas, Plan, una conversación), la tablet, los estados vacíos de cada segmento de Gente y el Inicio de una cuenta sin salidas. El grupo «Grupeta del sábado» del marco C es del lote 3 del chat.

**Por decidir.**

1. ¿«Historial» pasa a llamarse «Salidas»?
2. ¿Vale que la lista de Retos quede a dos toques, a cambio de tener todo lo social junto?
3. Al tocar «Gente», ¿se abre siempre en Chats o en el segmento que tenga algo pendiente?

Los datos de la lámina son inventados. La app publicada no se ha tocado.
