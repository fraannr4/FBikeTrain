# Cuentas, sincronización y perfiles sociales

Estado: acceso obligatorio y perfil implementados localmente, 2026-11-09. Migración/RLS probados en PostgreSQL embebido. Pendiente configurar y verificar Supabase real, migración local y sincronización; ninguna fase completa está cerrada.

Continuación visual/rutas aprobada después de este lote: `2026-11-09-login-cartografia-carga-rutas-ia.md` (B Cartografía, ciclista de carga, IA común a coste cero y composición de recorridos externos). Las claves personales siguen locales; el futuro servicio común usará sus propias claves en servidor. Los pendientes de sincronización de este plan se mantienen.

## Objetivo y decisiones

Mantener la aplicación estática en GitHub Pages. La cuenta será obligatoria; se propone Supabase para identidad, base de datos y almacenamiento. Sincronizar perfil, actividades, tracks, calendario y objetivos entre dispositivos. Las claves ORS y Groq y la dirección de casa permanecen locales. Los tracks son privados, sin cifrado adicional en cliente.

Los perfiles serán buscables. Cada persona podrá elegir si sus estadísticas son visibles para todos los usuarios autenticados o solo para amistades aceptadas; el valor inicial será todos. La primera comparativa mostrará distancia, desnivel, tiempo en movimiento y número de salidas por semana, mes y año. La comparación de recorridos o subidas concretos requiere diseño posterior. No publicar geometrías ni coordenadas mediante perfiles o estadísticas.

## Trabajo por fases

1. **Auditoría y diseño de datos.** Inventariar datos locales, dependencias y riesgos; definir esquema, versiones, sincronización, borrados, conflictos y migración de datos existentes. Resolver explícitamente con el usuario qué datos locales incorporar y cómo evitar mezclas entre cuentas.
2. **Servicio y seguridad.** Preparar proyecto Supabase, migraciones versionadas, tablas, almacenamiento privado y políticas RLS para cada operación. La clave publicable puede estar en el cliente; nunca la clave secreta. Probar con dos cuentas y un usuario anónimo, incluyendo acceso directo a API y ficheros. Decidir proveedor de acceso; para correo a usuarios externos hace falta SMTP propio o servicio equivalente.
3. **Acceso obligatorio y perfil.** Registro, entrada, salida, recuperación y estados de carga/error; perfil editable y búsqueda sin exposición de correo. Aislar datos y cachés por usuario, también al cambiar de cuenta o perder sesión. Adaptar interfaz móvil y pruebas.
4. **Sincronización.** Sincronizar actividades y tracks, calendario y objetivos con cola, reintentos y tratamiento explícito de errores, conflictos y borrados. Migración inicial sin borrar datos locales hasta verificar el resultado; no subir claves ni casa. Cubrir cortes de red, duplicados y cambio de usuario. Definir comportamiento sin conexión sin permitir acceso anónimo.
5. **Amistades y privacidad.** Solicitudes, aceptación, retirada y ajuste de visibilidad; aplicar permisos en servidor, no solo en la interfaz. Probar ambos sentidos, solicitudes pendientes, cambios de privacidad y acceso no autorizado.
6. **Comparativa.** Agregados de distancia, desnivel, tiempo y salidas por semana, mes y año, con límites temporales y zona horaria definidos. Exponer solo cifras autorizadas, sin rutas individuales ni ubicaciones. Interfaz móvil con estados vacíos y pruebas de privacidad.
7. **Cierre.** Pruebas unitarias, tipos, build y Playwright, auditoría móvil, pruebas reales con dos cuentas, comprobación de migración y restauración. Anotar resultados en `docs/verificaciones.md` y actualizar `docs/ESTADO.md`. Proponer commit; solo hacerlo con confirmación expresa.

## Auditoría inicial

- `src/db/db.ts` usa una sola base IndexedDB `ciclismo`, sin separación por cuenta. Contiene actividades, tracks, ajustes, metadatos, análisis derivados, calendario y objetivos; no se puede activar login multiusuario sin aislar o limpiar cuidadosamente esa caché.
- `src/settings/settings.ts` mezcla nombre, casa y claves en una fila local: no sincronizarla íntegra. Los análisis de subidas y firmas pueden contener información derivada de la geometría y no deben exponerse como estadísticas públicas.
- `src/db/repo.ts` guarda actividad y track en transacción local. La sincronización remota deberá preservar integridad y recuperación ante fallos; IndexedDB y la nube no comparten transacción.
- `src/App.tsx` muestra todas las rutas sin guardia de autenticación. No activar un bloqueo hasta tener recuperación de sesión y migración seguras.
- Git ha rechazado la consulta de estado por propiedad insegura en esta sesión. No se ha cambiado la configuración global ni se ha validado el supuesto arreglo pendiente del GPS.

## Decisiones pendientes antes de conectar el servicio

- Método de acceso decidido: **ambos**, correo y contraseña y Google. Pendiente configurar SMTP, proveedor Google y redirects.
- Qué hacer con los datos existentes al asociar la primera cuenta, sin atribuirlos silenciosamente a otra persona.
- Política de sincronización, conflictos y borrados; perfiles y nombres únicos; zona horaria de las comparativas.
- El usuario ya ha creado Supabase (`btmsakyhkxrndvscmxqs`), Google Cloud (`fbiketrain-514211`) y Brevo; ha facilitado la clave publishable y verificado el remitente Gmail. Faltan OAuth, SMTP y redirects. No solicitar ni registrar claves secretas en documentación versionable.

La documentación de Supabase consultada el 2026-11-09 indica 500 MB de base de datos y 1 GB de ficheros en Free, posible pausa por baja actividad y limitaciones del correo predeterminado: https://supabase.com/pricing , https://supabase.com/docs/guides/platform/free-project-pausing y https://supabase.com/docs/guides/auth/testing-auth-flows .

## Registro de ejecución, 2026-11-09

- [x] Auditar la base local y documentar riesgos de cambio de cuenta.
- [x] Registrar acceso por correo/contraseña y Google.
- [x] Preparar migración de perfiles, solicitudes de amistad y permisos del bucket privado de tracks.
- [x] Escribir pruebas SQL con tres identidades y acceso anónimo (permisos, aceptación, duplicados y Storage).
- [x] Ejecutar migración y pruebas SQL en una instancia de pruebas; no hay Postgres, Supabase CLI ni Docker disponibles en el entorno actual. Hecho: `npm run test:db` (PGlite) en local y en CI.
- [x] Conectar cliente Auth con URL y clave publishable del usuario e integrar la guardia local.
- [x] Configurar correo; verificar Auth real antes de publicar. (2026-11-09: SMTP de Brevo configurado y login real verificado en producción. 2026-11-10: el usuario retira el acceso con Google; solo correo y contraseña.)

### Lote de acceso y perfil, 2026-11-09

- [x] Instalar cliente oficial Supabase e integrar URL/clave publishable públicas facilitadas por el usuario.
- [x] Implementar PKCE con limpieza de callback y guardia en el punto de entrada de producción.
- [x] Implementar entrada, registro, recuperación, cambio de contraseña y botón Google.
- [x] Implementar «Tu perfil» con username, nombre, visibilidad y cierre de sesión.
- [x] Separar IndexedDB por UUID y reenviar el nombre de la base al Worker. Forzar recarga al pasar a otra identidad para descartar estado anterior; conservar base antigua intacta.
- [x] Probar migración y permisos con PostgreSQL embebido (`npm run test:db`); Auth/Storage externos simulados. Falta comprobar el servicio real.
- [x] Adaptar fixtures e2e para autenticar con sesiones sintéticas, sin llamadas al proyecto real; no existe bypass de autenticación en producción.
- [x] Comprobar tipos, build y 19 pruebas e2e de acceso/perfil con 32 capturas (cuatro anchos, apaisado y ambos temas). Suite unitaria: 944/949 en pasada bajo carga; los tres ficheros con los cinco fallos pasan después aislados (36/36), sin cambiar las aserciones. La pasada completa no fue limpia; ver `docs/verificaciones.md`.
- [x] Regresión completa de navegador: 66/66 PASS con el último ajuste visual, incluyendo importación y Worker sobre la base de la cuenta.
- [ ] Aplicar y comprobar migración en el proyecto Supabase; configurar Google, SMTP y redirects; probar con dos cuentas reales. (2026-11-09: migraciones 0001 y 0002 aplicadas, SMTP y redirects configurados; faltan Google y la prueba con dos cuentas reales.)

La protección de acceso ya está integrada localmente. No se ha publicado. La sincronización y las comparativas aún no están implementadas; el texto de «Más» lo indica. Las cuentas nuevas utilizan una caché vacía propia: no migran ni eliminan los datos de antes del login.

Actualización del usuario: proyectos Supabase y Google Cloud y cuenta Brevo creados. Remitente `FBikeTrain <fbiketrain@gmail.com>` verificado según captura; sin dominio propio y con avisos DKIM/DMARC. Pendiente configurar SMTP y probar correo real. Guía: `docs/supabase-configuracion.md`. El frontend de acceso y la separación de bases locales están adaptados; los datos anteriores no se han movido.
