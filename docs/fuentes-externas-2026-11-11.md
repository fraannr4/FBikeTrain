# Rutas conocidas: opciones y recomendación

Consulta de fuentes oficiales: **11 de noviembre de 2026**. Este informe sustituye las suposiciones antiguas sobre disponibilidad de APIs; no acredita un acuerdo con ningún proveedor. No se han solicitado credenciales, enviado correos ni probado cuentas reales.

## Recomendación para FBikeTrain

La vía principal es que cada usuario elija y descargue legítimamente un **GPX desde Wikiloc**, y lo abra en su biblioteca privada de FBikeTrain. En Android puede compartir el archivo con la PWA instalada; el selector de archivos de la biblioteca sirve también en iOS. Compartir un enlace no entrega el recorrido. No hay descarga automatizada de Wikiloc.

Mantener OSM como fuente automática de referencias y dar prioridad a las rutas que el usuario ha guardado. A la IA se envían únicamente nombre, fuente, kilómetros y desnivel; autor, enlace y geometría se conservan para la interfaz y el procesamiento local. Esas cifras orientan una propuesta: **no demuestran que el nuevo trazado de ORS siga el GPX**. Recortar, alargar y recalcular geometrías hasta un objetivo requiere un trabajo posterior específico.

Solicitar a Wikiloc confirmación escrita del alcance de la importación privada, el tratamiento de metadatos por un proveedor de IA y un posible acceso autorizado a catálogo/GPX. El borrador está en [wikiloc-solicitud-acceso.md](wikiloc-solicitud-acceso.md). No presentar la descarga personal como licencia para redistribuir o construir un catálogo colectivo.

| Opción | Utilidad para FBikeTrain | Acceso y coste conocidos | Decisión |
|---|---|---|---|
| Wikiloc, GPX elegido por el usuario | Recorrido conocido completo en biblioteca privada | Descarga por los mecanismos oficiales y según su cuenta | Vía principal |
| Wikiloc, API/acuerdo | Potencial catálogo y autorización explícita | No hay API pública; condiciones de integración no publicadas | Solicitar información |
| OSM, Overpass | Rutas ciclistas señalizadas por zona | Datos abiertos; servicio público con política de uso y disponibilidad limitada | Mantener |
| Ride with GPS API v1 | Rutas de una cuenta autorizada y descarga por ID | Cuenta y cliente API; sin plan de pago obligatorio según términos actuales | Buena futura conexión de biblioteca; búsqueda global por zona no documentada |
| Komoot | Exportación/compartición por el usuario; integraciones seleccionadas | Sin API pública | Importar el GPX legítimo, sin API privada |
| Outdooractive | Catálogo de un proyecto, filtros y rutas | Licencia API de pago y claves de proyecto/API | No encaja en coste cero sin acuerdo específico |
| Intervals.icu | Actividades; recorridos en eventos compartidos | No acredita una biblioteca privada general ni envío de rutas a iGPSPORT | No usarlo como puente de Wikiloc |
| iGPSPORT | Abrir GPX/TCX y enviarlo al BSC200S | Importación en app; plataforma OAuth por solicitud | Destino manual del GPX; estudiar acuerdo por separado |

Las afirmaciones de esta tabla se detallan con sus fuentes a continuación; las decisiones son recomendaciones de este informe.

## Wikiloc: descargas, uso y socios

Las condiciones visibles llevan fecha **marzo de 2022**. Los apartados 1.2 y 1.6 limitan el uso ordinario a fines personales; el acceso mediante herramientas y la obtención por medios distintos de los habituales requieren autorización. Restringen extracción/reutilización sistemáticas y redistribución, manteniendo derechos de los autores. Existen excepciones expresas y servicios ORG/Geopromotion; contratarlos no acredita por sí solo una licencia API. La descarga personal no concede una licencia general de reutilización. Esta es una lectura para decidir la integración, no una autorización del proveedor. [Condiciones oficiales, 1.2 y 1.6](https://www.wikiloc.com/wikiloc/terms_es.html).

La ayuda documenta **Descargar → Archivo**, GPX/TCX, y elección entre original o versiones reducidas/divididas. Para esta biblioteca conviene un track único detallado: un archivo dividido en segmentos o de waypoints puede requerir otra exportación. La opción de disponibilidad offline en la app y el QR no equivalen necesariamente a compartir un fichero con otra app. No se ha certificado qué menú ofrece cada versión móvil ni qué opciones permite cada cuenta. Página actualizada el **25-03-2025**. [Descarga oficial desde la web](https://help.wikiloc.com/article/520-download-trails-wikiloc-web).

Wikiloc declara que **no ofrece API pública**, por razones técnicas, legales y de privacidad; la ayuda está actualizada el **05-02-2025**. [API para desarrolladores](https://help.wikiloc.com/article/102-api-for-developers). La página de socios muestra integraciones con fabricantes de GPS/relojes: demuestra acuerdos existentes, no una convocatoria abierta, tarifa, cuota o API empresarial autocontratable. [Integraciones oficiales](https://www.wikiloc.com/wikiloc/partners.do).

**Marcador opcional:** se aplaza. Leer solo nombre/km/desnivel/enlace reduce datos, pero no resuelve por sí solo las condiciones amplias sobre herramientas y extracción. Pedir permiso también para ese caso; no interpretar que omitir el track convierte el marcador en una integración autorizada. El código automatizado de Wikiloc sigue desactivado.

## Ride with GPS: API real frente al buscador de la web

La API actual es **v1**, con cliente registrado y `api_key`. [Inicio oficial](https://ridewithgps.com/api/v1/doc). Para varios usuarios se recomienda OAuth; el intercambio de código utiliza `client_secret`, que exigiría backend seguro en FBikeTrain. Basic con clave y token se orienta al uso personal. No pedir la contraseña de Ride with GPS a usuarios de FBikeTrain. [Autenticación](https://ridewithgps.com/api/v1/doc/authentication).

Los términos efectivos desde el **11-09-2026** admiten proyectos personales/comunitarios y empresas, sin plan de pago, acuerdo comercial ni aprobación previa obligatorios. Actualmente no fijan una cuota numérica de peticiones ni máximo de usuarios conectados; sí permiten limitar o bloquear usos abusivos y cambiar esas condiciones. Usar caché, webhooks y retroceso ante fallos. No equivale a servicio ilimitado garantizado. Contacto técnico publicado: `developers@ridewithgps.com`. [Términos de la API](https://ridewithgps.com/api/v1/doc/terms).

`GET /api/v1/routes.json` lista rutas **del usuario autenticado**, con filtros de nombre, visibilidad, distancia, desnivel y archivo; paginación de 20 a 200 elementos. No documenta latitud/radio ni un índice de todas las rutas públicas. Sí documenta consulta por ID y descarga GPX/TCX/FIT/KML de una ruta accesible. No se debe reutilizar un endpoint interno del buscador web como si fuera API soportada. Conclusión: permite conectar una biblioteca autorizada; **no hemos encontrado búsqueda geográfica del catálogo público en la API v1 documentada**. Consultarlo al equipo antes de diseñar ese buscador. [Endpoints Routes](https://ridewithgps.com/api/v1/doc/endpoints/routes).

## Komoot y Outdooractive

Komoot declara que no tiene API de acceso público y limita integraciones a fabricantes seleccionados y establecidos de GPS/wearables. Ofrece enlaces, QR y mapas incrustados para compartir contenido; estos no entregan un catálogo de tracks para FBikeTrain. Artículo actualizado el **21-05-2026**. No se verificó una cuota o tarifa de API aplicable a este proyecto. [Komoot API for partners](https://support.komoot.com/hc/en-us/articles/10805168381210-komoot-API-for-partners).

Outdooractive exige comprar licencia API y aceptar condiciones. Sus guías requieren atribución de fuente/autor y seguimiento de visualizaciones/descargas en integraciones personalizadas. No basta con obtener una clave de ejemplo. Las tarifas y cuotas concretas deben pedirse para el proyecto. [Guías de licencia e integración](https://developers.outdooractive.com/Overview/Guidelines.html).

La Data API v2 exige **project key + API key**, sirve contenidos del proyecto y documenta descarga GPX. Su documentación v1, marcada **Legacy**, sí describe `/nearby/tour` con `location` (lon,lat), `radius`, límite y filtros. Es evidencia de capacidad geográfica, no de acceso gratuito a todo el catálogo ni de equivalencia automática con v2. Confirmar cobertura, endpoint vigente y licencia con el proveedor antes de implementarlo. [Data API v2](https://developers.outdooractive.com/API-Reference/Data-API.html), [Data API v1 Legacy, NearBy](https://developers.outdooractive.com/API-Reference/Data-API.v1.html).

## OSM: la fuente automática que ya usa FBikeTrain

`route=bicycle` identifica rutas ciclistas señalizadas o con nombre/número; pueden discurrir por carreteras, caminos o vías ciclistas. No acredita una vuelta de carretera ni asfalto. [Etiqueta oficial](https://wiki.openstreetmap.org/wiki/Tag:route=bicycle).

El adaptador existente `src/routes/sources/overpass.ts`, usado por `findRouteReferences`, busca relaciones `type=route`, `route=bicycle`, redes `lcn|rcn|ncn`; filtra vías incompatibles/incompletas, calcula distancia por segmentos y conserva `ascentM: null` cuando falta elevación. Son decisiones del código local; no inventar desnivel cero ni conexiones entre huecos.

Overpass permite consultas geográficas; las instancias públicas tienen políticas de carga y pueden rechazar peticiones. La aplicación debe agregarlas, cachear y respetar límites; no hay SLA de disponibilidad. [Overpass API e instancias](https://wiki.openstreetmap.org/wiki/Overpass_API). Los datos son ODbL: conservar atribución y aviso de licencia, con las obligaciones que correspondan al uso/distribución. [Copyright OSM](https://www.openstreetmap.org/copyright).

## Intervals.icu e iGPSPORT: ¿admiten rutas ajenas?

**Intervals.icu: sí, en un caso concreto verificado.** El desarrollador anunció el **31-03-2026** la carga de recorridos FIT, TCX o GPX en **eventos/carreras compartidos**, con mapa, perfil y descarga GPX; el **05-06-2026** añadió visualización pública de mapas. Por tanto, los hilos de 2025 que decían que no se podían importar rutas han quedado incompletos. [Anuncio del desarrollador](https://forum.intervals.icu/t/add-courses-to-shared-races-events-with-maps/126059).

El propio desarrollador delimitó inicialmente la función a eventos compartidos; no se ha verificado aquí una biblioteca privada general, un buscador de rutas públicas por zona o sincronización de courses hacia iGPSPORT. No publicar un recorrido privado como evento compartido para usarlo como puente. [Alcance explicado por david, 31-03/01-04-2026](https://forum.intervals.icu/t/add-course-to-my-a-type-race/104449). La subida GPX de **actividades grabadas** existe desde 2021, pero no convierte cualquier ruta de terceros en una salida realizada ni en una ruta navegable. [Anuncio de importación de actividades GPX](https://forum.intervals.icu/t/gpx-file-upload-now-supported/3405).

**iGPSPORT: sí, importación manual.** El manual del **BSC200S**, apartado Navegación, documenta importar GPX o TCX en la app y enviarlo al dispositivo. Sirve para un GPX legítimo de Wikiloc o exportado por FBikeTrain; el procedimiento exacto de selección/compartición debe validarse en el teléfono real. [Manual oficial BSC200S en castellano](https://arg.igpsport.com/descargas/BSC200S.pdf).

También existe **iGPSPORT APP Open Platform**, con OAuth 2.0 y solicitud de acceso por correo a `global@igpsport.com`. Pide ficha del desarrollador, logo, introducción, redirect/callback, entidad y web. Corrige la afirmación antigua «iGPSPORT no tiene API»: hay una plataforma por aprobación. La página pública no acredita endpoints de búsqueda/importación de rutas, cuotas, precios ni aceptación de proyectos personales. No se integra ni se promete acceso hasta confirmarlo. [Plataforma oficial](https://www.igpsport.com/support/app/openapi).

## Comprobaciones externas pendientes

1. Respuesta de Wikiloc sobre permisos, metadatos/IA, atribución, posibles acuerdos y coste cero/cuotas.
2. Si se prioriza Ride with GPS: confirmar por correo la existencia o ausencia de búsqueda pública por zona y condiciones de ese uso.
3. Probar el flujo GPX en un Android real: PWA instalada, envío de archivo, login pendiente, biblioteca y exportación a iGPSPORT. Pasos en [pwa-compartir.md](pwa-compartir.md).
4. Confirmar manualmente el menú de importación de iGPSPORT y el envío al BSC200S. No hace falta usar Intervals.icu como intermediario.

No se ha usado la API/MCP de Strava, descargado tracks reales ni activado automatización sobre Wikiloc.
