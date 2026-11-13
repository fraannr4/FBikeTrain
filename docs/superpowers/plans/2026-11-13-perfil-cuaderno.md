# Perfil ciclista y Cuaderno de ruta

Petición del usuario: el perfil actual parece una pantalla de ajustes; debe destacar, tener foto, descripción y un feed diferenciador. El usuario eligió explícitamente **cuaderno propio y feed de amigos**.

## Producto

- Cabecera editorial de ciclismo, retrato grande y biografía. «Mi manera de rodar»: explorar, subir, fondo o grupeta, con una firma visual propia construida con SVG y los tokens de la app.
- Edición en una hoja modal; el contenido social ocupa la página principal. Cuenta, privacidad y cierre de sesión siguen disponibles.
- Cuaderno personal y feed de amistades aceptadas. Publicación manual de texto y, opcionalmente, cifras de una salida escogida. Sin publicación automática, GPS, mapas de salidas, Casa ni claves.
- Foto propia: recorte cuadrado y reexportación WebP en el navegador para retirar metadatos; un único archivo por cuenta en Storage privado. Lectura autenticada y escritura solo del dueño.
- Publicaciones para amigos por defecto, o para todos los usuarios autenticados por elección expresa. Las preferencias de estadísticas también protegen las publicaciones con cifras. Borrado solo del autor y paginación por fecha/id.
- Nada de likes, comentarios, rankings o actividad inventada. Los perfiles nuevos muestran un estado vacío útil.

## Lotes y validación

1. Migración aditiva de perfil, bucket privado y publicaciones, RPC y pruebas SQL con dueño, amigo, tercero y anónimo. Cliente tipado y errores traducidos.
2. Fotos: validación de archivo/dimensiones, WebP sin EXIF, carga privada y estados de error.
3. Cabecera propia/ajena, editor y feed, respetando navegación de comunidad publicada.
4. Revisiones de privacidad y usabilidad; tipos, pruebas focalizadas, SQL, build y capturas móviles 360–430 px, escritorio y ambos temas.
5. Aplicar la migración probada al proyecto existente sin usar claves de servicio; publicación coordinada con el frontend y seguimiento de Pages. La autorización de publicación de la tarea continúa vigente.

La sincronización completa de actividades, tracks, calendario y objetivos sigue siendo otro lote. Una publicación comparte una copia explícita de cifras, no sincroniza el historial.

## Resultado del lote

Implementados los lotes 1–4. Migración 202611130007 aplicada y registrada en el servicio real, con bucket privado y RLS comprobados. 32 unitarias focalizadas, SQL completo, tipos/build y escáner de secretos correctos. Regresión de navegador de 48 escenarios aprobada; cuaderno final 16/16, con capturas móviles, apaisado y escritorio en ambos temas. Revisiones independientes de permisos y UI sin bloqueantes. La publicación continúa por el workflow de Pages del commit de este lote.
