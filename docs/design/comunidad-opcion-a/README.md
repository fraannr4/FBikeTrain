# Comunidad — opción A aplicada (2026-11-16)

Elección del usuario: opción A completa, con presupuesto acotado y cambios de diseño. Aplicación sobre 9557040 en el worktree C:/testTrain-comunidad-abierta, con commit local autorizado por el usuario, sin push ni publicación.

- Ciclistas: sin hero; buscador integrado con búsqueda al escribir, Enter, botón de lupa y limpieza que conserva el foco. Lista compacta, acceso a perfil, Retar y amistad junto a cada persona. El perfil propio se consulta desde Perfil y no se muestra como candidato. Las páginas conservan sus offsets originales del servidor aunque la fila propia no se dibuje.
- Duelos: identidad Tú contra rival, pareja de avatares/iniciales, cifras alineadas y barra comparativa. Invitación recibida/enviada identificada por persona; entrada principal Elegir rival. Los grupos conservan clasificación y acciones.
- Nuevo reto: primero rival, después reglas/plazo. Cambio de orden de presentación, sin modificar el contrato de creación.
- Cambio de dispositivo queda en un desplegable secundario. La advertencia y el reemplazo explícito se conservan.
- Paleta, marca y navegación principal existentes. Sin cambios de SQL, cuotas, RLS, cálculo ni sincronización de resultados.

Las fotos de Ciclistas son las del perfil cuando existen. Los miembros de retos no incluyen avatar_version en la respuesta actual, por lo que los duelos usan iniciales salvo que esa versión esté disponible; no se incorporan retratos ficticios de la maqueta como datos de usuarios.

Capturas reales del build con datos sintéticos (390×844):

| Pantalla | Oscuro | Claro |
|---|---|---|
| Ciclistas | [Ver](ciclistas-390-dark.png) | [Ver](ciclistas-390-light.png) |
| Duelo | [Ver](duelo-390-dark.png) | [Ver](duelo-390-light.png) |
| Retos | [Ver](retos-390-dark.png) | [Ver](retos-390-light.png) |

La colección local en test-results incluye 360/390/412/430 px y apaisado. Las capturas anteriores siguen en docs/design/comunidad-abierta para comparar.

Validación: 18/18 unitarias focalizadas, tipos y build correctos; 25/25 Playwright de Ciclistas y Retos, con ambos temas y apaisado. Escáner de secretos correcto. No se repite la suite completa ni SQL al ser un lote de interfaz, conservando el presupuesto solicitado.
