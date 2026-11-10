# Conector personal de actividades

Alcance autorizado: investigar fuentes oficiales antes de escribir código; después implementar la opción disponible sin aprobación. Rama `codex/conectores` creada desde `main` (`e8b64fa`) en `C:\testTrain-conectores`, worktree de `C:\testTrain`. El usuario autoriza commit; no push, merge ni despliegue.

1. Leer estado, solicitud Garmin, PWA y reglas del proyecto. Investigar Garmin Personal/Starter, iGPSPORT, Intervals, Wahoo, COROS, Polar, Suunto, Komoot y carpetas FIT. Entregar `docs/conectores-actividades.md` con enlaces y límites, sin confundir rutas con actividades ni prometer puentes privados.
2. Verificar CORS con preflight sin credenciales. Intervals admite lectura desde Pages: implementar cliente oficial HTTPS directo, Basic con clave personal; no Edge Function/SQL. Clave e id solo en metadatos locales por cuenta, fuera de backups.
3. Sincronización incremental con ventanas de fechas locales, solape, ids completados, reintento de archivos pendientes y checkpoint conservador. Reservar intentos automáticos durante seis horas incluso ante fallos; detener ante cuota, autorización o red. Bloqueo entre pestañas. Cancelación y límites de tamaño/tiempo. No Strava ni datos identificados como Garmin.
4. Ajustes > Conexiones: credenciales, guardar, importar, desconectar, auto al abrir/reanudar, estado y reporte existente. Actualizar datos abiertos tras importar; coordinar borrado total con cancelar/esperar y limpiar clave de memoria. Textos en castellano y controles de 44 px.
5. Pruebas de contrato, importador real/dedupe, fallos, cuota, aislamiento y backup. Revisar pantalla con un subagente conforme al requisito móvil. Playwright a 360, 390, 412 y 430 px, ambos temas y apaisado, con FIT sintéticos; puerto 4179. Ejecutar suite completa, tipos y build; `test:db` si aparece SQL (no previsto). Cerrar preview y registrar resultados antes del commit.

Límites: clave personal para uso propio; OAuth público con PKCE antes de promocionar integración multiusuario. La exportación/sincronización iGPSPORT nativa requiere prueba física. No hay trabajo en segundo plano con la app cerrada ni despliegue remoto en este lote.
