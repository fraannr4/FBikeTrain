# Fixtures de ORS

**Sintéticos y provisionales.** La tarea 1 de F4 (grabar respuestas reales con la clave del usuario) aún
no se ha hecho porque el usuario no tiene clave de ORS. Estos ficheros imitan la forma documentada de
`POST /v2/directions/cycling-road/geojson` con `elevation: true` y `extra_info: ['surface', 'waytype', 'steepness']`,
y **se sustituirán por las respuestas reales** cuando se haga la tarea 1. Al cambiarlos, revisar las
pruebas que dependen de cifras concretas.

| Fichero | Contenido |
|---|---|
| `round-trip-ok.json` | `FeatureCollection` con una `Feature`: `LineString` de 61 puntos `[lng, lat, ele]`, círculo de unos 30 km que empieza y acaba en la Puerta del Sol (lat 40.4168, lng −3.7038), un punto público. No sigue carreteras reales. `properties.extras` trae `surface`, `waytypes` (en plural, como la API) y `steepness`, con `values: [desde, hasta, valor][]` por índice de punto y `summary: { value, distance, amount }[]`. |
| `path-alternatives-ok.json` | Trayecto de dos puntos (`path`) con `alternative_routes` (`target_count` 3) y `extra_info` con `waycategory`: dos `Feature`, la directa (unos 1,3 km) y un desvío por el norte (unos 1,46 km, un 11 % más) con un tramo de «State Road». Para los conectores de los empalmes. |
| `no-route-404.json` | Cuerpo de un 404 con `error.code` 2010 (punto no encontrado), como el de un inicio en el mar (lat 40.0, lng 1.5). |

Supuestos que la tarea 1 debe confirmar: la clave `round_trip`, la forma `[lng, lat, ele]`, el nombre
`waytypes` y que el cuerpo de error es `{ error: { code, message }, info }`. Para los empalmes, además:
que `alternative_routes` devuelve una `Feature` por ruta y que `waycategory` llega como campo de bits.

Para regenerarlos: `node tests/fixtures/ors/make-ors-fixtures.mjs`.
