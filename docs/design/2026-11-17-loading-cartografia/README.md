# Cartografía viva: carga de rutas

El usuario eligió Cartografía viva y aprobó el refinamiento de ciclista, bicicleta, pedaleo y tarjeta el 2026-11-17. Después encargó revisar los cambios locales de Claude e integrarlo sin romper la búsqueda.

La referencia aprobada se conserva en `referencia-aprobada-clara.png` y `referencia-aprobada-oscura.png`. Las capturas `carga-<ancho>-<tema>.png` proceden de la aplicación de producción con datos sintéticos y movimiento reducido para una imagen reproducible.

- Móvil: 360×780, 390×844, 412×915 y 430×932.
- Apaisado: 844×390.
- Escritorio: 1280×900.
- Ambos temas; tarjeta sin desborde, texto completo y Cancelar de al menos 44 px.

## Alcance

`RouteLoadingScene` reproduce la ilustración con SVG y un único bucle de animación por instancia, sin renders React por fotograma. Piernas ligadas a los pedales, bielas y ruedas coordinadas, bicicleta estable y curvas de nivel en movimiento continuo. Se detiene con movimiento reducido y pestaña oculta; desmontar cancela el fotograma y elimina los listeners. Gradientes y máscaras usan identificadores propios por instancia.

`RouteSearchLoading` presenta el estado real del generador, el tiempo transcurrido y Cancelar. Las consultas consumidas conservan su semántica accesible, indicando «N de 20 consultas consumidas»; no representan un porcentaje de finalización. Solo el mensaje es una región viva: los segundos y el botón quedan fuera del anuncio.

El cambio en `Rutas.tsx` se limita al bloque visual de la búsqueda. Biblioteca, llamadas al motor, esperas por cuota, tarjetas aceptadas, errores, cancelación y adaptación de GPX conservan su lógica. El cargador de acceso/importación y los cambios locales de navegación pertenecen a otros lotes.

## Verificación

Pruebas focalizadas iniciales: 25/25 (Rutas, escena nueva y CyclingLoader anterior). Revisión de cumplimiento y revisión de calidad sin bloqueantes; se incorporó la mejora de texto accesible del presupuesto de consultas. Resultado final de suite/build/navegador registrado en `docs/ESTADO.md`.

Resultado final: 81/81 pruebas focalizadas en siete archivos (incluidos los cuatro que fallaron en la pasada general), tipos y build correctos. Trece escenarios de la escena/tarjeta aprobados y cuatro escenarios de propuestas/cancelación a 360 y 430 px comprobados; las dos cancelaciones se repitieron tras sincronizar la prueba con la petición lenta. La pasada general inicial fue 1.899/1.905, no una suite completa en verde: los motivos y sus verificaciones posteriores quedan registrados en Estado.

Las pruebas de navegador de este lote bloquean service workers y servicios externos. Las peticiones de biblioteca son sintéticas y se retienen expresamente para inspeccionar la espera. Se comprueba pedaleo real, cambio dinámico a movimiento reducido, finalización inmediata y cancelación. La regresión del generador cubre propuestas reales del fixture y conservación de tarjetas al cancelar.

Commit local autorizado por el usuario tras revisar el resultado. Sin push ni despliegue de este lote.
