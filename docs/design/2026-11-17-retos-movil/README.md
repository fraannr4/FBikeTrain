# Retos en móvil: navegación con la comunidad en primer plano (propuesta, 2026-11-17)

Propuesta de diseño, sin cambios en `src/`. Maquetas estáticas a 390 px con los tokens y las fuentes reales de la app (`maquetas.html`, `?theme=light` para el claro) y capturas reales del estado actual (`actual/`). Datos sintéticos.

Láminas: [navegación, tres opciones](lamina-navegacion.png) · [dónde se lanza un reto de ruta](lamina-reto-ruta.png).

## Resumen

En el ordenador, la comunidad tiene su bloque en el carril lateral. En el móvil queda escondida dentro de Perfil, que es la quinta pestaña. Para llegar a Retos hay que bajar unos 2.100 px del perfil hasta «Mis retos» o pasar por Ciclistas. Una invitación pendiente no se ve fuera de Retos: no aparece en la barra ni en Inicio. Es lo que el usuario llama «caos».

**Recomendación: opción 1.** La quinta pestaña pasa a llamarse **Comunidad**, se abre en Retos y tiene dos vistas más: Ciclistas y Amigos. Lleva un badge con lo pendiente. Además, Inicio gana una tarjeta «Retos en juego» que solo aparece cuando hay algo. El perfil se abre desde tu foto, arriba a la derecha. Así el móvil copia el bloque Comunidad del ordenador (las mismas tres secciones y el mismo nombre) y la barra conserva Inicio, Historial, Rutas y Plan.

## Estado actual (capturas reales a 390 px, build + `vite preview`)

| Pantalla | Oscuro | Claro | Qué se ve |
|---|---|---|---|
| Inicio | [ver](actual/actual-inicio-390-dark.png) | [ver](actual/actual-inicio-390-light.png) | Nada sobre retos, aunque haya una invitación pendiente. |
| Perfil (completo) | [ver](actual/actual-perfil-390-dark-full.png) | [ver](actual/actual-perfil-390-light-full.png) | «Mis retos» y «Ciclistas» al final de la página, debajo del cuaderno. El título «Tu perfil» queda pegado al borde izquierdo. |
| Retos | [ver](actual/actual-retos-390-dark.png) | [ver](actual/actual-retos-390-light.png) | Pantalla secundaria, con flecha atrás; está activa la pestaña Perfil. El aviso solo aparece en «Avisos (1)». |
| Ciclistas | [ver](actual/actual-ciclistas-390-dark.png) | [ver](actual/actual-ciclistas-390-light.png) | Buen patrón (diseño A): Retar junto a cada ciclista. |
| Amigos / Más | [Amigos](actual/actual-amigos-390-dark.png) · [Más](actual/actual-mas-390-dark.png) | [Amigos](actual/actual-amigos-390-light.png) · [Más](actual/actual-mas-390-light.png) | Más solo se abre desde el botón «…» del perfil. |

Problemas: 1) los retos están a tres niveles de profundidad; 2) el único badge de la barra es el de Plan, y nada avisa de las invitaciones; 3) la pestaña Perfil mezcla identidad, cuaderno, comunidad y ajustes; 4) el móvil y el ordenador no se parecen: el ordenador tiene «Comunidad» y el móvil, «Perfil».

## Patrones de apps deportivas y redes sociales (patrones, no aspecto)

- **Pestaña social propia** (grupos, clubes, desafíos) en vez de enterrarla en el perfil. Es lo habitual en las apps de entrenamiento con comunidad.
- **El perfil como foto en la cabecera** o como última pestaña con tu avatar. Se reconoce enseguida y libera una pestaña.
- **Badge numérico solo para lo que pide una acción** (invitaciones, solicitudes). Los resultados y los cierres van a la bandeja de avisos, sin badge, para que el número no se vuelva ruido.
- **Tarjeta accionable en el feed o en la portada**: «Te han retado», con Aceptar en la propia tarjeta, sin abrir el detalle.
- **Fila de personas con anillo de estado** (estilo historias), para saber de un vistazo con quién tienes algo pendiente. Cuidado: el color nunca va solo, siempre con texto.
- **Botón de acción principal flotante** en la pantalla social («Retar»), en lugar de un botón central en la barra que quite sitio a Plan o a Historial.

## Opciones de estructura

Las tres mantienen Inicio, Historial, Rutas (una sola entrada, de acuerdo con la reorganización que está haciendo el otro equipo) y Plan. Lo que cambia es la quinta pestaña y dónde aparecen los retos.

### 1. Pestaña Comunidad (recomendada)

[Comunidad · oscuro](o1-comunidad-390-dark.png) · [claro](o1-comunidad-390-light.png) · [Inicio · oscuro](o1-inicio-390-dark.png) · [claro](o1-inicio-390-light.png)

- Barra: Inicio · Historial · Rutas · Plan · **Comunidad** (icono de espadas y badge con invitaciones y solicitudes de amistad pendientes).
- `#/comunidad` abre Retos. Un segmentado con Retos (y su recuento) · Ciclistas · Amigos cambia de vista por URL (`#/retos`, `#/ciclistas`, `#/amigos` siguen valiendo).
- Retos se ordena por urgencia: «Te han retado» (con Aceptar y Ahora no en la tarjeta), «En juego» (pareja de avatares, nombre, tus cifras y las del rival, y una pastilla de diferencia con signo y texto) y, por último, Historial. El botón flotante «Retar» abre la elección de rival, ya ordenada (diseño A).
- Inicio: la tarjeta «Retos en juego» aparece solo con invitaciones o duelos activos, con un máximo de dos filas y el enlace «Ver todos». La frase del saludo puede nombrar el reto pendiente.
- Perfil: la foto, arriba a la derecha en las pantallas raíz. Lleva al perfil actual; Más y Ajustes siguen dentro.
- En el ordenador no cambia nada: el bloque Comunidad del carril ya tiene esas secciones. Solo se añade el badge a «Retos».

Ventajas: un solo sitio para todo lo social; el móvil y el ordenador hablan igual; cambia poco el código (TabBar, `tabOf`, una pantalla contenedora). Inconveniente: el perfil pierde la pestaña, aunque la foto en la cabecera es un patrón conocido.

### 2. Pestaña Retos

[Retos · oscuro](o2-retos-390-dark.png) · [claro](o2-retos-390-light.png) · [Perfil · oscuro](o2-perfil-390-dark.png) · [claro](o2-perfil-390-light.png)

- La quinta pestaña es **Retos**, sin más. Ciclistas queda como la lupa y el «+ Buscar» de la fila «¿A quién retas?»; Amigos pasa al perfil, que se abre desde la foto.
- Arriba, una fila de rivales con anillo de estado; debajo, el segmentado En juego · Avisos · Historial.

Ventajas: los retos tienen el máximo protagonismo y quedan a un toque. Inconvenientes: Amigos y Ciclistas se esconden más que hoy; el bloque Comunidad del ordenador y el móvil dejan de corresponderse; con pocos retos, la pestaña queda vacía.

### 3. La barra casi igual, retos en Inicio

[Inicio · oscuro](o3-inicio-390-dark.png) · [claro](o3-inicio-390-light.png) · [Tú · oscuro](o3-tu-390-dark.png) · [claro](o3-tu-390-light.png)

- La quinta pestaña sigue siendo el perfil, renombrado **Tú** con tu foto y un badge. Dentro, un segmentado Cuaderno · Retos · Amigos sube Retos arriba del todo.
- Inicio gana una fila «Tus retos» con anillo de estado y una campana de avisos con badge en la cabecera.

Ventajas: es el cambio más pequeño y los retos se ven al abrir la app. Inconvenientes: la comunidad sigue dentro del perfil; hay dos badges (la campana y Tú) para lo mismo; la fila de Inicio compite con el hero y los KPI.

| Criterio | 1 Comunidad | 2 Retos | 3 Inicio |
|---|---|---|---|
| Toques hasta aceptar un reto | 1 (Inicio) o 2 | 2 | 1 (Inicio) o 2 |
| Ciclistas y Amigos | 2 toques | escondidos (lupa, perfil) | dentro de Tú |
| Coherencia con el ordenador | igual | distinta | distinta |
| Coste de implementación | medio-bajo | medio | bajo |

## Reto de ruta: dónde se lanza

El modelo (tipo `route`, detección por celdas de 200 m con ≥ 90 %, tiempo en movimiento, recorte de inicio y final y migración 202611160004) lo implementa otro agente. Aquí solo se decide cómo encaja en la navegación. [Lámina](lamina-reto-ruta.png).

- **Detalle de una salida** (`#/historial/:id`): botón principal «Retar a alguien en esta ruta», con una nota de privacidad (solo la ven quienes acepten y se ocultan el inicio y el final). El mapa marca el tramo oculto con línea discontinua. [oscuro](b-salida-390-dark.png) · [claro](b-salida-390-light.png)
- **Rutas** (la pantalla única `#/rutas`, una propuesta o la biblioteca): «Retar» junto a GPX y Guardar. Abre una hoja «¿A quién retas en esta ruta?» con buscador y, primero, los amigos y los rivales recientes. [oscuro](b-ruta-390-dark.png) · [claro](b-ruta-390-light.png)
- **Ficha de ciclista** (`#/personas/:id`) y el botón Retar de Ciclistas: una hoja «Retar a Jordi» con el tipo de reto. «En una ruta: quién la hace más rápido» va primero; después, la elección de la ruta (biblioteca, salida propia o GPX). Debajo, «Entre vosotros», con el historial de duelos. [oscuro](b-ciclista-390-dark.png) · [claro](b-ciclista-390-light.png)
- Desde el botón flotante «Retar» de Comunidad, el orden es: rival → tipo → ruta → plazo. Desde una salida o una ruta, la ruta ya está elegida y el orden es: rival → plazo.

## Detalles de interacción y movimiento

- Badge: suma de invitaciones a retos y solicitudes de amistad pendientes, con 9+ como máximo. El nombre accesible dice «Comunidad, 2 pendientes» (como el patrón actual de Plan). Desaparece al responder, no al abrir la pestaña.
- Aceptar en la tarjeta: la fila pasa a «En juego» sin recargar. La aparición dura 200 ms con `--ease-out` (opacidad y `translateY(4px)`); con `prefers-reduced-motion`, solo opacidad.
- El botón flotante no se esconde al desplazar, para evitar movimiento continuo. El espacio inferior de la lista lo tiene en cuenta (96 px).
- Sin animación al cambiar de pestaña ni de segmento, salvo el indicador `.seg-ind` que ya existe (`--dur-ui`).
- Las pastillas de diferencia siempre llevan signo y texto («−2:26», «+230 m», «Enviado»); el color de estado acompaña, nunca va solo.

## Tareas para un plan posterior

1. `screens.ts`: añadir `TabId 'comunidad'`; `tabOf` agrupa `/comunidad`, `/retos*`, `/ciclistas`, `/amigos` y `/personas/*`. Perfil, Zona, Más, Importar y Ajustes siguen en el antiguo grupo `mas`, que ya no tiene pestaña en móvil.
2. `TabBar.tsx`: en móvil, la quinta pestaña es Comunidad, con badge; en el ordenador, el badge va en «Retos» del carril. Un hook `useCommunityBadge` (como `usePlanBadge`) a partir de `list_community_notifications` sin leer y de las solicitudes recibidas.
3. Pantalla `#/comunidad`, contenedora con un segmentado por enlaces (como `HISTORIAL_VIEWS`) sobre Retos, Ciclistas y Amigos; sin flecha atrás en esas tres vistas.
4. Retos: agrupar «Te han retado», «En juego» e Historial; respuesta en la tarjeta; botón flotante «Retar».
5. Cabecera: botón con la foto del perfil en las pantallas raíz (`AppShell`), con el nombre accesible «Tu perfil». El perfil conserva el acceso a Más.
6. Inicio: tarjeta «Retos en juego» condicional (invitaciones y dos duelos como máximo).
7. Entradas del reto de ruta (coordinar con el agente del tipo `route`): botón en Salida, acción en las tarjetas de `#/rutas` y una hoja de tipo de reto en Persona y Ciclistas.
8. Corregir el margen del título «Tu perfil» en móvil (pegado al borde).
9. E2E: actualizar `comunidad-nav.spec.ts` (la quinta pestaña pasa a ser Comunidad), probar el badge y su nombre accesible, y capturar a 360, 390, 412 y 430 px y en apaisado, con los dos temas. Después, `web-design-guidelines`, `review-animations` y `break-ui` (nombres largos, 99 invitaciones).

## Decisiones del usuario

1. Estructura: opción 1 (recomendada), 2 o 3.
2. ¿El perfil, como foto en la cabecera (opción 1), o como pestaña «Tú» (opción 3)?
3. ¿Qué cuenta el badge: solo las invitaciones a retos, o también las solicitudes de amistad?
4. ¿Debe aparecer la tarjeta «Retos en juego» de Inicio también cuando solo hay duelos en marcha, sin invitaciones?

## Notas del proceso

Skills usadas: `frontend-design`, `ui-ux-pro-max` (pautas de navegación y badges), `impeccable` (contexto: no hay PRODUCT.md ni DESIGN.md, así que se respeta el sistema visual existente y no se pudo preguntar directamente al usuario), `emil-design-eng` y `dataviz` (diferencias con signo y texto; el perfil usa la escala de pendiente `--g0` a `--g5`). Como el alcance es solo de propuesta, no se cargaron `animate`, `react-best-practices` ni las de revisión final; corresponden a la fase de implementación.
