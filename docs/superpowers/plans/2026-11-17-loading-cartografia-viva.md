# Carga de rutas: Cartografía viva refinada

Diseño elegido y refinamiento aprobados por el usuario el 2026-11-17. Encargo posterior: revisar los cambios locales de Claude e integrar la referencia sin romper la búsqueda. No autoriza commit, push ni despliegue.

Actualización de cierre: el usuario autorizó después el commit local del resultado revisado. No pidió push ni despliegue.

## Alcance

- Sustituir la presentación de la búsqueda de rutas por la tarjeta aprobada: cabecera «Cartografía viva», título «Explorando tu zona.», ilustración amplia y estado real, tiempo transcurrido y Cancelar debajo.
- Ciclista de carretera con casco, gafas, maillot azul y bicicleta detallada; pedaleo articulado con pies ligados a las bielas, ruedas coordinadas y curvas de nivel desplazándose suavemente. Bicicleta estable sobre una pendiente suave.
- Escena SVG decorativa, identificadores independientes por instancia, colores ligados a los temas de la app. Sin imágenes remotas ni bibliotecas nuevas.
- Mantener intactos generador, servicios, cuotas, tarjetas aceptadas, errores y AbortController. Los mensajes siguen los eventos reales; las consultas siguen siendo un presupuesto consumido, sin inventar porcentaje de finalización.
- Mantener fuera del anuncio de estado los segundos que cambian. Respetar movimiento reducido, detener animación con pestaña oculta y liberar recursos al desmontar.
- El cargador compartido de acceso/importación y los cambios pendientes de navegación quedan fuera de este lote. La adaptación de GPX existente conserva su comportamiento.

## Ejecución y revisión

1. Especialista: escena aislada y pruebas de ciclo de vida.
2. Integración de tarjeta en Rutas conservando actualizaciones y cancelación; adaptar únicamente las aserciones afectadas por la presentación/accesibilidad.
3. Revisión de cumplimiento y de calidad en paralelo; corregir hallazgos. Simplificar sin ampliar alcance.
4. Verificar unitarias, tipos, build y escenarios de búsqueda/cancelación con datos sintéticos. Capturas a 360/390/412/430 px, claro/oscuro, apaisado y escritorio; comprobar ausencia de desborde, controles de 44 px, animación y movimiento reducido.
5. Registrar resultado y límites reales en `docs/ESTADO.md` y en el directorio de capturas. No modificar capturas de otros lotes.
