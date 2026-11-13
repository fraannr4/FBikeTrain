# Cierre de perfil, amigos y retos — 2026-11-13

## Auditoría y alcance

El código y `main` ya incluían acceso obligatorio, edición del perfil, zona, búsqueda por nombre/radio, solicitudes y retos de ruta 1 contra 1. Las migraciones sociales ya constan aplicadas; no se deben volver a crear ni presentar estas capacidades como inéditas.

El encargo actual completa su integración: perfil propio como centro de comunidad, perfiles ajenos y conexión buscador → perfil → amistad → reto. No incluye activar sincronización de actividades ni comparativas periódicas: siguen pendientes las decisiones de incorporación de datos y conflictos del plan de cuentas.

## Implementación

- [x] Perfil propio: identidad visible, accesos a buscador/amigos/retos/zona, edición y salida conservadas, errores de carga con reintento.
- [x] Perfil ajeno `#/personas/:id`: identidad pública y acciones según amistad (solicitar, aceptar, rechazar, cancelar, retirar, retar). Sin lecturas de correo, coordenadas ni actividades ajenas.
- [x] Enlaces de los resultados y amigos a su perfil. `?vista=amigos` abre directamente la lista desde el perfil propio.
- [x] Errores de lectura de amistades visibles también en Buscar; acciones bloqueadas cuando la relación no se conoce.
- [x] Crear el primer reto desde la pantalla vacía. Errores de almacenamiento al elegir salida diferenciados de un historial vacío y con reintento.
- [x] Recuperar por id los retos anteriores a los últimos 100, con las políticas RLS ya existentes; sin migración nueva.
- [x] Pestaña Más y nombres de pantalla correctos para perfil propio y ajeno.
- [x] Ampliación del usuario: Comunidad visible en el carril izquierdo (Tu perfil, Amigos, Retos), Perfil como quinta pestaña móvil y Más opciones dentro del perfil; scroll de carril y selección de sección.
- [x] Cierre de verificación: 1.848/1.848 pruebas en 142 ficheros, SQL/RLS, tipos y build, bundle sin secretos. Navegador: acceso/perfil propio 23 escenarios aprobados; última pasada Amigos/perfiles ajenos/Retos 25/25. Capturas móviles revisadas en claro/oscuro.
- [x] Confirmación expresa del usuario para adaptar navegación, hacer commit y publicar, recibida el 2026-11-13.
- Publicación: seguir el workflow de GitHub Pages del commit que contiene este lote y registrar su resultado en el cierre de la sesión.

## Privacidad y verificación real

La identidad ajena usa únicamente `profiles(id,username,display_name)`, columnas ya legibles por usuarios autenticados. La localidad de un amigo procede de `list_friends`, que respeta `show_area`. Retos y resultados conservan las políticas de participantes. No se modifican permisos, claves, conexiones ni datos reales.

Las pruebas de navegador usan identidades y rutas sintéticas. Sigue pendiente la comprobación del usuario con dos cuentas reales y su registro en `docs/verificaciones.md`; las pruebas automatizadas no sustituyen esa comprobación.

Mensaje de commit: `Complete social profiles and make community navigation visible`.
