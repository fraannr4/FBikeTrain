# Ride with GPS como fuente de rutas (consultado el 2026-11-11)

## Qué permite la API oficial

Documentación: https://ridewithgps.com/api/v1/doc (OpenAPI: https://ridewithgps.com/api/v1/openapi.yaml).

- Detalle de ruta con `track_points` (`x` lng, `y` lat, `d` m, `e` m, `S` firme, `R` tipo de vía): `GET /api/v1/routes/{id}.json` ([Routes](https://ridewithgps.com/api/v1/doc/endpoints/routes), [Track points](https://ridewithgps.com/api/v1/doc/reference/track_points)). También `/routes/{id}.gpx|tcx|fit|kml` y `polyline.json`. `privacy_code` abre rutas no públicas.
- Autenticación: obligatoria. Cabeceras `x-rwgps-api-key` + `x-rwgps-auth-token`, u OAuth Bearer ([Authentication](https://ridewithgps.com/api/v1/doc/authentication)). Clave desde https://ridewithgps.com/api/api_clients. La documentación no dice si una ruta pública se lee sin token.
- Búsqueda por zona: no existe. `GET /routes.json` solo lista las rutas de la cuenta autenticada (filtros por nombre, distancia, desnivel).
- CORS: no documentado. Hay que probarlo con una clave real.
- Límites y atribución ([Terms](https://ridewithgps.com/api/v1/doc/terms)): sin límite fijo hoy, pero pueden estrangular o añadir límites; atribución no obligatoria; el uso de logos sigue sus guías; los datos solo se usan como el usuario autorice.
- `robots.txt` bloquea `/routes/*.json`, `*.gpx`, `*.tcx` de la web: solo se usa `/api/v1`, nunca esas URL.

## Implementado (2026-11-12): cuenta común en el servidor

- Edge Function `rwgps` (`supabase/functions/rwgps`, handler `src/routes/sources/rwgpsService.ts`). Lista cerrada: solo `GET /api/v1/routes/{id}.json` y `/api/v1/collections/{id}.json`, con `privacy_code` opcional. JWT de la app (sin sesiones anónimas) y cuota diaria (300 por usuario, 3.000 en total). Sin `privacy_code`, solo devuelve rutas y colecciones con `visibility: public`: el token común abre también lo privado de la cuenta común.
- Secrets (Dashboard → Edge Functions → Secrets): `RWGPS_API_KEY` y `RWGPS_AUTH_TOKEN`, o `RWGPS_EMAIL` + `RWGPS_PASSWORD`. Nunca llegan al navegador ni a la base; la respuesta solo lleva nombre, autor y puntos.
- `src/routes/sources/rwgpsImport.ts`: `parseRwgpsLinks`, `fetchRwgpsCollection` y `fetchRwgpsRoutes` (lote de 150 como máximo) llaman a la función.
- La colección fijada ya no se ofrece: sería la de la cuenta común. Solo colecciones públicas o con `privacy_code`.
- El CORS de la API v1 está abierto (2026-11-11), pero el navegador ya no la llama.

## Pendiente del usuario

1. Crear los secrets en Supabase.
2. Pegar los enlaces de las rutas cercanas, o una colección pública, y comprobar las 3 propuestas.
3. Si se quiere un buscador por zona, pedirlo a developers@ridewithgps.com. Hoy la API no lo ofrece.
