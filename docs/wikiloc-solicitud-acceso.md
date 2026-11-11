# Borrador de correo a Wikiloc

Preparado el **11 de noviembre de 2026**. **No enviado**.

Destinatario: equipo de soporte/integraciones de Wikiloc, pidiendo que lo deriven a la persona responsable de acuerdos. Canal verificable: **Contact us** de la [ayuda oficial de API](https://help.wikiloc.com/article/102-api-for-developers). No se ha verificado una dirección específica de programa API/partners; usar ese formulario de contacto o la dirección que Wikiloc confirme, sin inventar un buzón empresarial.

**Asunto:** FBikeTrain: consulta de integración autorizada de rutas y posible acuerdo para proyecto personal

Hola, equipo de Wikiloc:

Soy Fran Romano y estoy desarrollando FBikeTrain, una aplicación web personal de ciclismo con biblioteca privada de recorridos y planificación de rutas de carretera. Wikiloc es una fuente imprescindible para mí y quiero que cualquier integración respete vuestras condiciones y los derechos de los autores.

App: https://fraannr4.github.io/FBikeTrain/

Código: https://github.com/fraannr4/FBikeTrain

El flujo que estamos preparando consiste en que el usuario elija una ruta en Wikiloc y descargue o comparta su GPX mediante los mecanismos oficiales. Después lo abre voluntariamente en su biblioteca privada de FBikeTrain. La aplicación no inicia sesión en Wikiloc, no recoge contraseñas ni descarga vuestro catálogo por su cuenta. La biblioteca conserva el original, autor y enlace cuando figuran en el archivo; actualmente permanece en el dispositivo y separada por cuenta.

Antes de ampliar el uso, agradecería vuestra confirmación sobre estos puntos:

1. ¿Es admisible este flujo de importación para uso personal, manteniendo la ruta privada y su atribución? ¿Qué condiciones adicionales debemos mostrar o respetar?
2. Para orientar propuestas, querríamos enviar a un proveedor de IA solo nombre, fuente, distancia y desnivel de las referencias elegidas; nunca el GPX, coordenadas, dirección del usuario, enlace ni datos del autor. ¿Está permitido este tratamiento de metadatos? ¿Qué restricciones aplican a la adaptación o unión de recorridos para uso privado y a su exportación al GPS del mismo usuario?
3. ¿Ofrecéis algún acuerdo, programa de socios o acceso empresarial autorizado a búsqueda de rutas por zona y/o descarga de GPX, aunque no exista API pública? ¿Aceptáis proyectos personales o comunitarios de pequeño volumen?
4. Si existe, ¿cuáles son los requisitos de atribución, autorización de usuarios, almacenamiento, borrado, caché y cuotas? El proyecto busca coste cero; agradecería saber si existe un nivel gratuito limitado o una vía adecuada para un piloto personal.
5. Como alternativa limitada, ¿autorizaríais un marcador ejecutado por el usuario sobre una ficha que ya tenga abierta para guardar únicamente título, kilómetros, desnivel y enlace, sin leer ni extraer el track? En caso afirmativo, ¿qué condiciones debería cumplir?

No activaremos búsqueda automatizada ni intentaremos eludir controles de acceso. Si no hay una vía de integración adecuada, mantendremos la descarga manual que nos indiquéis y ajustaremos el tratamiento de los archivos a vuestras instrucciones.

Muchas gracias por orientarnos o derivar esta consulta al equipo correspondiente.

Un saludo,

Fran Romano

[Añadir correo de respuesta y, si se desea, volumen estimado de usuarios/peticiones antes de enviarlo.]

## Referencias para preparar la consulta

La [ayuda de API](https://help.wikiloc.com/article/102-api-for-developers) indica ausencia de API pública (actualizada el 05-02-2025). La [página de integraciones](https://www.wikiloc.com/wikiloc/partners.do) acredita acuerdos con dispositivos, no un programa abierto para este caso. Se pide confirmación específica, sin presuponer que Premium u ORG la concedan.

## Versión TFG: marcador «→ FBikeTrain» (2026-11-11)

Preparada el **11 de noviembre de 2026**. **No enviada.** Sustituye al borrador anterior para la vía del marcador descrita en [wikiloc-cerca.md](wikiloc-cerca.md); el anterior se conserva como referencia. Mismo canal: **Contact us** de la [ayuda oficial de API](https://help.wikiloc.com/article/102-api-for-developers), pidiendo que lo deriven a quien lleve acuerdos o permisos.

Antes de enviarla, el usuario completa lo que va entre corchetes. No se ha inventado ningún dato del centro ni del tutor.

**Asunto:** Solicitud de autorización para uso académico y no comercial (TFG): marcador personal sobre Wikiloc en FBikeTrain

El cuerpo va en texto plano, listo para copiar:

---

Hola, equipo de Wikiloc:

Me llamo Fran Romano y estoy haciendo mi Trabajo de Fin de Grado en [titulación] en [universidad], bajo la dirección de [tutor o tutora]. El trabajo es FBikeTrain, una aplicación web personal de ciclismo de carretera que planifica salidas a partir de la distancia y el desnivel que pide el ciclista y las prepara para su GPS.

App: https://fraannr4.github.io/FBikeTrain/
Código: https://github.com/fraannr4/FBikeTrain

Os escribo para pediros autorización antes de usar una parte del trabajo que se apoya en Wikiloc. He leído vuestras condiciones de uso, en particular los apartados 1.2 y 1.6, y sé que piden permiso para herramientas como la que describo. Sé también que no ofrecéis API pública.

Qué hace la herramienta:

1. Desde FBikeTrain, el usuario abre en su navegador vuestro mapa de rutas de ciclismo de carretera alrededor de su punto de salida.
2. En esa pestaña, ya dentro de Wikiloc con su sesión, el usuario pulsa un marcador del navegador («→ FBikeTrain»). El marcador lee de las rutas que tiene a la vista solo el nombre, los kilómetros, el desnivel, la dificultad, el autor y el enlace, como máximo 50. Si el mapa no muestra la lista, hace una única consulta a la misma petición que usa vuestro mapa para esa vista.
3. FBikeTrain ordena esas rutas por lo que ha pedido el ciclista. Si usa un asistente de IA, este solo recibe el nombre, la fuente, los kilómetros y el desnivel de cada ruta; nunca coordenadas, enlaces, autores ni la dirección del usuario.
4. Si el usuario elige una ruta, abre su ficha en Wikiloc y vuelve a pulsar el marcador. El marcador hace la misma descarga del GPX que vuestro botón «Descargar», con la cuenta del usuario y solo de esa ruta. Si la descarga pide Premium, iniciar sesión o una confirmación, no la salta: avisa y deja vuestro botón.
5. FBikeTrain adapta esa ruta para que empiece y acabe donde vive el ciclista y se ajuste a la distancia pedida, y la guarda en su biblioteca privada con el autor y el enlace a la ficha original. El único fichero que sale es el GPX que el propio usuario envía a su GPS.

Qué no hace:

1. No hay ningún servidor nuestro que acceda a wikiloc.com. Todo ocurre en el navegador del usuario, con su sesión y por una acción suya cada vez.
2. No se eluden Cloudflare, Premium ni otros controles; no se reutilizan cookies, no se usan navegadores automáticos, proxies ni rotación de IP, y no hay bucles ni recorridos de otras zonas: una petición por pulsación como máximo.
3. El track nunca se extrae del HTML de la página: solo llega por la descarga oficial.
4. No se redistribuyen rutas ni datos de Wikiloc. La biblioteca es privada de cada cuenta, la lista recibida caduca a los 7 días y no se publica nada.
5. No hay uso comercial, publicidad ni ingresos. Es un proyecto académico y personal.

Por todo ello, os pido:

1. Autorización para usar este marcador con fines académicos y no comerciales durante el TFG, en las condiciones descritas.
2. Si no la concedéis tal cual, qué cambios necesitaríais: por ejemplo, limitarlo a nombre, cifras y enlace, sin la descarga del GPX, o cualquier requisito de atribución, conservación o borrado.
3. Si existe una vía oficial más adecuada para un proyecto académico de este tamaño, cuál es.

Si la respuesta es negativa, quitaré la descarga mediante el marcador y volveré a la descarga manual desde vuestra web. Puedo enseñaros el código o una demostración si os resulta útil.

Muchas gracias por vuestro tiempo.

Un saludo,

Fran Romano
[correo de contacto]
[titulación], [universidad]

---

[Antes de enviarla: completar titulación, universidad, tutor o tutora y correo; si el centro lo pide, adjuntar una carta del tutor.]
