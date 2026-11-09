# Nueva dirección del acceso, animación ciclista e IA compartida

Fecha: 2026-11-09. Estado: dirección B aprobada por el usuario; implementación pendiente. Esta elección sustituye la composición del login anterior, no el diseño del resto de pantallas.

## Petición del usuario

El usuario aprueba el acabado actual, pero quiere explorar un login con la composición de su imagen de referencia (colección de accesos editoriales como Racing Paddock, Terra Maps y Film Darkroom), una animación elaborada de una persona subiendo una cuesta en bicicleta y simplificar mucho las rutas con IA, alojando su lógica en la nube si resulta viable.

Estas mejoras se añaden al trabajo de cuentas. Siguen pendientes la configuración real de Auth/SMTP/Google, las pruebas remotas, la migración de datos antiguos, sincronización y comparativas. No dar estos puntos por completados por cambiar el diseño.

## Decisiones del usuario y propuestas visuales

- **Aprobado por el usuario: B «Cartografía».** Lámina conservada en `docs/design/2026-11-09-opciones-login.png`: usar su columna central. Salvia, marfil, tinta verde oscura, curvas de nivel y trazo azul ascendiendo; composición editorial con formulario limpio. No implementar A Paddock ni C Puerto de noche. Generación con herramienta integrada ImageGen a partir de la referencia del usuario, como maqueta de dirección, no como imagen de fondo para el formulario real.
- **Decidido:** animar el login con sutileza, sin sobrecargarlo. Propuesta técnica: trazado de ruta dibujándose una vez y movimiento mínimo de un marcador; curvas de nivel estables, campos y texto quietos. Mantener oscuro/claro y accesibilidad; la traducción de B al tema oscuro necesita su propia validación.
- **Decidido:** el ciclista aparece al abrir la aplicación después del login y en las pantallas de carga, incluidas las de generación de rutas.
- **Decidido:** coste cero para la IA compartida, usando cuotas gratuitas y limitando búsquedas.
- Pendiente concretar el estilo del ciclista y la interacción de rutas (conversación, formulario o combinación), así como las cuotas reales y la centralización de ORS.

## Nueva capacidad de rutas solicitada

El usuario pide que la generación consulte Wikiloc o webs similares, complemente sus recorridos con el planificador propio y pueda **empalmar rutas o tramos**. Debe tener en cuenta puntos de salida y conexiones, no limitarse a generar circulares aleatorias. Es un requisito de producto aceptado para planificar, todavía no implementado.

Separar descubrimiento de referencias (enlaces, autoría y metadatos) de acceso a geometrías y de cálculo de conexiones. El texto de una página o la memoria de un modelo no son geometría navegable. Conservar procedencia de cada tramo, recalcular totales del conjunto y validar conexiones sobre una red de carreteras apropiada para ciclismo de carretera; no unir extremos con rectas ni inventar cruces.

**Limitación verificada:** Wikiloc declara que no ofrece API pública para desarrolladores. Por tanto, no prometer búsqueda/descarga automática integral ni una integración gratuita ya disponible. Su ayuda describe la descarga manual de GPX/TCX; se puede estudiar la incorporación de ficheros obtenidos legítimamente por el usuario, respetando sus condiciones y la atribución. Otras webs deben evaluarse por separado, sin asumir acceso por analogía. Si una fuente no permite obtener el track, mostrar la referencia o solicitar un fichero, no fabricar la ruta.

La biblioteca de recorridos de referencia será distinta del historial de actividades: importar un GPX para diseñar una ruta no debe crear una salida realizada ni alterar estadísticas. Los tracks privados del usuario no se convierten en públicos por activar estadísticas visibles. El modelo sigue recibiendo solo resúmenes, hechos e identificadores simbólicos; el motor cartográfico maneja coordenadas fuera del prompt.

Plan de continuación: `docs/superpowers/plans/2026-11-09-login-cartografia-carga-rutas-ia.md`.

## Animación propuesta

Identidad: **B Trazado elegida también como logo**, con indicación expresa de adaptarla a toda la web. Se ha integrado un SVG global en tinta y azul de los tokens actuales; la elección no supone trasladar toda la paleta del login al resto de pantallas. Aplicación y vista de variantes en `docs/design/2026-11-09-logo-propuestas.md`.

Preferir SVG y CSS propios, coherentes con la interfaz, sin vídeo pesado: pedaleo articulado, ruedas, balanceo sutil, pendiente y paisaje con movimiento relativo. Separar representación de la espera de los datos de progreso: solo mostrar porcentajes reales cuando existen. En peticiones indeterminadas mostrar etapas, sin inventar un porcentaje.

No añadir esperas artificiales para completar la animación. Respetar `prefers-reduced-motion` con una escena estática legible. Mostrar cancelación y errores fuera del decorado. Validar teléfono modesto, varios tamaños, ambos temas, apaisado y animación reducida.

## IA en la nube: viabilidad preliminar

La aplicación ya llama a un modelo remoto (Groq por defecto), pero la orquestación está en el navegador y cada usuario configura sus claves de IA y ORS. Alojar la orquestación en Supabase Edge Functions permitiría guardar una clave común del proveedor en secretos del servidor y ofrecer acceso autenticado sin que cada usuario configure IA. No supone alojar el modelo de lenguaje dentro de Supabase.

Propuesta pendiente de aceptación: función autenticada, entradas acotadas y validadas, límites atómicos por usuario y globales, modelo autorizado por servidor, tamaño/tokens máximos, control de reintentos y cancelación, y errores claros de cuota. No exponer un proxy abierto que acepte cualquier URL, prompt o modelo. Las cuotas de Groq se comparten a nivel de organización.

Mantener separación entre funciones: el modelo solo recibe resúmenes numéricos y preferencias, nunca coordenadas ni tracks. El proveedor de carreteras necesita el punto de salida. Centralizar también ORS requeriría gestionar sus cuotas y aprobar el cambio respecto a las claves locales; mover solo la IA no elimina el paso de configurar ORS.

Edge Functions tiene límites de memoria, CPU y duración; es adecuado para llamadas HTTP y coordinación acotada, no para mantener un modelo grande ejecutándose ni un agente permanente. Los flujos largos deben dividirse o diseñarse de otra forma.

Hallazgo a comprobar al mejorar rutas: fuentes oficiales de ORS indican la deprecación de `api.openrouteservice.org` a favor de `api.heigit.org/openrouteservice/`. El código actual utiliza el host antiguo. Verificar endpoint, claves, formato y cuotas reales antes de migrar, con pruebas que mantengan la semántica de `cycling-road`.

## Fuentes consultadas

- [Funciones Supabase](https://supabase.com/docs/guides/functions)
- [Límites de Edge Functions](https://supabase.com/docs/guides/functions/limits)
- [Autenticación de funciones](https://supabase.com/docs/guides/functions/auth)
- [Secretos de funciones](https://supabase.com/docs/guides/functions/secrets)
- [Cuotas Groq](https://console.groq.com/docs/rate-limits)
- [Cambio de host y cuotas ORS](https://ask.openrouteservice.org/t/quota-exceeded-on-directions-while-dashboard-shows-full-quota-standard-key/8068)
- [Wikiloc: ausencia de API pública](https://help.wikiloc.com/article/102-api-for-developers)
- [Wikiloc: descarga de GPX/TCX](https://help.wikiloc.com/article/520-download-trails-wikiloc-web)
- [Planificador de Wikiloc como referencia funcional, no API de terceros](https://help.wikiloc.com/article/905-route-planner-wikiloc)
