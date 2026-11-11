# Revisión del conector para uso diario

Rama `codex/conectividad-revision`, desde `main`. Sin commit, push ni despliegue.

1. Reproducir con fixtures sintéticos el payload iGPSPORT `OAUTH_CLIENT`, FIT original, duplicados, ventanas y reanudación. Corregir con TDD.
2. Separar resolución de credenciales de sincronización. Cifrar la clave local con WebCrypto y una CryptoKey no exportable por cuenta, migrando la configuración anterior sin perder seguimiento.
3. Backoff acotado para 429/5xx, Retry-After persistido, cancelación y errores castellanos; nunca reintentar permisos.
4. Guiar la configuración móvil, acción manual y última sincronización. Validar visibilitychange y capturas 360/390/412/430, apaisado, ambos temas.
5. Revisión independiente de cumplimiento y calidad, correcciones y simplificación. Documentar límites del cifrado y preparación OAuth (sin implementarlo).
6. Verificación final: vitest completo, TypeScript, build y e2e del conector. Actualizar guía, estado y verificaciones; proponer mensaje de commit.

Rango propuesto: sin historial, últimos 30 días; con historial, última salida real menos dos días. Después de completar una consulta, revisar siete días previos para cargas retrasadas; conservar las ventanas pendientes. El histórico anterior se incorpora por archivo. No descargar originales completados otra vez; mantener el descarte de duplicados del importador.

Evidencia externa facilitada por el usuario el 2026-11-11: lista 200, iGPSPORT `source=OAUTH_CLIENT`, `device_name=IGPSPORT 202`, `file_type=fit`, `type=Ride`; original sin gzip `application/octet-stream`, CORS `*`. No se usan credenciales ni tracks reales durante este lote.
