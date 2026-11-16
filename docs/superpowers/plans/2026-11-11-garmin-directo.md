# Garmin directo oficial

> **2026-11-16:** plan histórico de Codex. Portado a `main` en la rama `garmin-directo` con receptor push activo (secreto en la ruta y `garmin-client-id`), Courses API («Enviar a Garmin») y sin `/delete-account`. Estado vigente en [garmin-directo.md](../../garmin-directo.md).

Fecha: 2026-11-11. Sustituye el lote Garmin vía Intervals descartado por el usuario. Sin commit, push, despliegue ni cambios en `docs/ESTADO.md`. Fuentes, contrato y bloqueos: [garmin-directo.md](../../garmin-directo.md).

## Alcance

Activity API Starter, consentimiento oficial, nuevas salidas FIT, almacenamiento privado por cuenta e importación por Worker. Sin contraseñas Garmin, API privada, puente Intervals ni Strava. Sin Courses, Health, Training, histórico ni Ping/Pull en Starter.

## Lote local

1. Verificar OAuth/capacidades con fuentes oficiales; separar hechos públicos del contrato privado pendiente. Reescribir solicitud Starter para Activity API únicamente.
2. Preparar esquema/RLS y bucket privado por cuenta, tokens cifrados en servidor y estado PKCE de un solo uso. Tests sintéticos de aislamiento, permisos, expiración, archivos, duplicados, revocación y borrado.
3. Preparar Edge Function: `/connect`, `/callback`, `/status`, lista/archivo privados, `/disconnect`, `/delete-account`. `/notifications` responde 503 hasta verificar origen y esquema conforme al contrato Garmin concedido a la app. Ninguna firma o URL recibida se acepta por intuición.
4. Añadir bloque Garmin directo en Conexiones, estados claros de pendiente/conectado y atribución. Crear ruta de privacidad pública accesible sin cuenta. Conservar el conector Intervals anterior.
5. Revisar cumplimiento/calidad, corregir y ejecutar tipos, Vitest, build y e2e de conexiones/privacidad con fixtures. Validar 360 y 430 px en ambos temas con capturas y sin desbordes.
6. Entregar archivos, resultados, límites y propuesta de commit. No editar ESTADO; indicar en el informe qué requeriría actualizarse durante integración autorizada.

## Bloqueos externos

- Solicitud Starter pendiente de envío/aprobación y confirmación de límites.
- Contrato de autenticación/replay de notificaciones pendiente; `userId` y `Origin` no autentican.
- FIT push: esquema, descarga, hosts/rutas, compresión, límites, acuses y reintentos pendientes del portal.
- Contrato de `User_Permission`, desregistro y eliminación remotos pendiente; las rutas locales no sustituyen esos eventos.
- Configuración de aplicación, secretos de servidor, migración/RLS remotos y despliegue posteriores con autorización.
- Prueba real con cuenta propia y salida nueva, incluidos renovación/revocación y borrado, pendiente; datos reales fuera del repo.

El PDF público confirma OAuth, identidad, permisos y retirada de registro. La documentación pública no permite completar verificablemente el receptor FIT. El lote prepara una integración cerrada por defecto; no se entrega como Garmin productivo ni promete importar nuevas salidas antes de verificar esos contratos.
