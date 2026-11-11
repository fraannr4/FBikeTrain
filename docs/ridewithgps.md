# Ride with GPS como fuente de rutas (consultado el 2026-11-11)

## Qué permite la API oficial

Documentación: https://ridewithgps.com/api/v1/doc (OpenAPI: https://ridewithgps.com/api/v1/openapi.yaml).

- Detalle de ruta con `track_points` (`x` lng, `y` lat, `d` m, `e` m, `S` firme, `R` tipo de vía): `GET /api/v1/routes/{id}.json` ([Routes](https://ridewithgps.com/api/v1/doc/endpoints/routes), [Track points](https://ridewithgps.com/api/v1/doc/reference/track_points)). También `/routes/{id}.gpx|tcx|fit|kml` y `polyline.json`. `privacy_code` abre rutas no públicas.
- Autenticación: obligatoria. Cabeceras `x-rwgps-api-key` + `x-rwgps-auth-token`, u OAuth Bearer ([Authentication](https://ridewithgps.com/api/v1/doc/authentication)). Clave desde https://ridewithgps.com/api/api_clients. La documentación no dice si una ruta pública se lee sin token.
- Búsqueda por zona: no existe. `GET /routes.json` solo lista las rutas de la cuenta autenticada (filtros por nombre, distancia, desnivel).
- CORS: no documentado. Hay que probarlo con una clave real.
- Límites y atribución ([Terms](https://ridewithgps.com/api/v1/doc/terms)): sin límite fijo hoy, pero pueden estrangular o añadir límites; atribución no obligatoria; el uso de logos sigue sus guías; los datos solo se usan como el usuario autorice.
- `robots.txt` bloquea `/routes/*.json`, `*.gpx`, `*.tcx` de la web: solo se usa `/api/v1`, nunca esas URL.

## Implementado (publicado el 2026-11-11)

- CORS de la API v1 abierto (`access-control-allow-origin: *`, cabeceras `x-rwgps-api-key` y `x-rwgps-auth-token`): el navegador llama directamente, sin Edge Function.
- `src/routes/sources/ridewithgps.ts`: `parseRwgpsRouteId`, `rwgpsRouteToLibraryInput` y `fetchRwgpsRoute`.
- `src/routes/sources/rwgpsImport.ts`:
  - `createRwgpsToken`: `POST /auth_tokens.json`; la contraseña no se guarda.
  - `parseRwgpsLinks`: rutas y colecciones en un texto pegado.
  - `fetchRwgpsCollection`: `/collections/{id}.json` y `/collections/pinned.json`.
  - `fetchRwgpsRoutes`: lote de 150 como máximo; una ruta que falla no para el resto, un 401 sí.
- `src/routes/sources/rwgpsCredentials.ts`: la clave y el token se guardan en la tabla `meta` de la cuenta. No van a la copia de seguridad.
- La UI está en `#/rutas/catalogo`, sección «Rutas de Ride with GPS».
- Pruebas con fixtures sintéticos: `tests/ridewithgps.test.ts`, `tests/rwgpsImport.test.ts` y `e2e/rwgps.spec.ts`.

## Pendiente del usuario

1. Crear un API client en https://ridewithgps.com/api/api_clients y conectar la cuenta desde el catálogo.
2. Pegar los enlaces de las rutas cercanas, o guardarlas en una colección y añadirla.
3. Si se quiere un buscador por zona, pedirlo a developers@ridewithgps.com. Hoy la API no lo ofrece.
