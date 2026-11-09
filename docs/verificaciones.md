# Verificaciones (tarea 1, F0)

Resultados de las comprobaciones previas. No contiene filas del archivo ni tracks reales.

## Paso 1. Archivo «Descargar tu cuenta» de Strava

- Fecha: 2026-11-06.
- Disponible sin suscripción: sí. Llega por correo con un enlace firmado a S3 que caduca en 7 días (`X-Amz-Expires=604800`).
- Tamaño de esta cuenta: 3,8 MB, 96 entradas, ZIP sin compresión (`store`).

## Paso 2. Contenido del archivo

### Carpetas y ficheros de primer nivel

`activities/`, `media/`, `clubs/`, `routes/`, `activities.csv`, `profile.jpg`, `messaging.json` y unos 35 CSV más (`bikes.csv`, `goals.csv`, `routes.csv`, `segments.csv`…). Solo usamos `activities.csv` y `activities/`.

### `activities.csv`

- Codificación UTF-8, sin BOM. Separador coma. Los textos con comas van entre comillas.
- **La cabecera está traducida al idioma de la cuenta (castellano), no en inglés.** El lector no puede depender de los nombres en inglés que suponía el plan (`Activity ID`, `Activity Type`, `Filename`…).
- 104 columnas. **Hay nombres repetidos**: `Tiempo transcurrido` (5 y 15), `Distancia` (6 y 17), `Frecuencia cardiaca máxima` (7 y 30), `Esfuerzo Relativo` (8 y 37), `Desplazamiento` (9 y 50). Al construir el índice por nombre, gana la **primera** aparición.

Columnas que usa el lector (`STRAVA_COLUMNS`):

| Campo | Cabecera en castellano | Cabecera en inglés (cuentas en inglés) | Índice en este archivo |
|---|---|---|---|
| `id` | `ID de actividad` | `Activity ID` | 0 |
| `name` | `Nombre de la actividad` | `Activity Name` | 2 |
| `type` | `Tipo de actividad` | `Activity Type` | 3 |
| `filename` | `Nombre del archivo` | `Filename` | 12 |

Recomendación: `STRAVA_COLUMNS` acepta las dos variantes de cada campo y localiza la columna por nombre (primera aparición), no por índice.

Otros formatos observados, por si se usan más adelante:
- `Fecha de la actividad`: texto localizado, por ejemplo `31 oct 2026, 7:48:29`, con meses `ene feb mar abr may jun jul ago sept oct nov dic`. No se usa: la hora de inicio sale del fichero, como dice el plan.
- `Hora de inicio`: vacía en todas las filas.
- La primera `Distancia` (6) va en km con coma decimal (`44,86`). La segunda (17) va en metros con punto (`44860.5`).
- `Tiempo en movimiento` (16), `Velocidad máxima` (18) y `Velocidad promedio` (19) van en segundos y m/s, con punto decimal. `Desnivel positivo` (20) va en metros.
- `Cadencia promedio` vacía en las filas observadas.

### Valores de `Tipo de actividad`

| Valor | Filas | ¿Ciclismo? |
|---|---|---|
| `Bicicleta` | 8 | sí |
| `Carrera` | 36 | no (running) |
| `Caminata` | 3 | no |

`CYCLING_TYPES` debe incluir los valores en inglés del plan (`Ride`, `Virtual Ride`, `E-Bike Ride`, `Gravel Ride`, `Mountain Bike Ride`) y los equivalentes en castellano. Solo `Bicicleta` está confirmado; los demás nombres en castellano (bicicleta virtual, eléctrica, gravel, montaña) no aparecen en este archivo y se añadirán cuando salgan. Las carreras y caminatas se descartan.

Segundo filtro, por si el tipo del CSV es desconocido: los GPX de Strava traen `<type>` (`cycling`, `running`, `walking`) y los FIT traen `sport`. Solo entra lo que sea ciclismo.

### Ficheros en `activities/`

- Ruta en el CSV: `activities/<id>.<ext>`.
- Extensiones encontradas: `.gpx` (45) y `.fit` (2). **Sin `.gz`** en este archivo; el lector debe seguir aceptando `.fit.gz`, `.gpx.gz` y `.tcx.gz`, que Strava usa en otras cuentas.
- Cruce tipo y extensión: `Bicicleta` 6 GPX y 2 FIT; `Carrera` 36 GPX; `Caminata` 3 GPX.
- GPX: `creator="StravaGPX"`, con `<type>` igual a `cycling`, `running` o `walking`.
- FIT: cabecera `.FIT` válida (archivos de 551 KB y 39 KB).

## Paso 3. iGPSPORT BSC200S por USB

Primer intento, 2026-11-06: el usuario conectó el dispositivo encendido y por USB, a través del dock HP USB-C. Windows no lo detectó: no apareció ninguna unidad, ningún dispositivo portátil (WPD/MTP) ni ningún dispositivo USB nuevo en el Administrador de dispositivos. El único almacenamiento USB que había era un CD virtual «GO! Suite» (VID_0EA0), que es otro aparato.

Segundo intento, el mismo día: puerto USB del propio portátil, sin dock, y con otro cable. El dispositivo solo muestra que está cargando y Windows sigue sin detectar nada.

Conclusión: en la práctica, el BSC200S no ofrece sus datos por USB a este PC. **La app no dependerá del USB:**
- las salidas llegan por Strava, que es la copia maestra;
- las rutas GPX se pasan al dispositivo desde la app móvil de iGPSPORT;
- la tarea 1 de F4 comprueba ese paso con un GPX de prueba.

Mientras tanto, no bloquea nada. Las salidas llegan a la app por Strava, que es la copia maestra. Las rutas en GPX se pueden pasar al dispositivo desde la app móvil de iGPSPORT.

## Paso 4. Política de datos de Groq

Fuente: https://console.groq.com/docs/your-data (consultada el 2026-11-06).

- Por defecto, Groq no conserva los datos de las peticiones de inferencia.
- Excepción: puede registrar entradas y salidas durante un máximo de 30 días para resolver problemas de fiabilidad o investigar abusos.
- Cualquier cliente puede activar Zero Data Retention (ZDR) en Data Controls. Con ZDR desaparece también ese registro de 30 días. Recomendación: activarlo, porque la app no usa lotes ni ajuste fino.
- Entrenamiento: la página oficial no lo dice. Según resúmenes de terceros, el contrato de servicio (Services Agreement y DPA) prohíbe entrenar con lo que envía el cliente sin su permiso. No está comprobado en el texto original.
- En cualquier caso, la IA solo recibe cifras resumidas, nunca tracks ni la dirección de «Casa».

## Paso 5. CORS de ORS y Groq desde el navegador

Comprobado el 2026-11-06 con `curl`, sin claves, simulando `Origin: http://localhost:5173`.

| Llamada | Preflight `OPTIONS` | Respuesta sin clave |
|---|---|---|
| ORS `POST /v2/directions/cycling-road` | 204, `access-control-allow-origin: *`, permite `Authorization` y `Content-Type` | 403 **sin** cabecera `access-control-allow-origin` |
| Groq `GET /openai/v1/models` | 204, `access-control-allow-origin: *`, permite `authorization` | 401 con `access-control-allow-origin: *` |
| Groq `POST /openai/v1/chat/completions` | 204, `access-control-allow-origin: *`, permite `authorization` y `content-type` | (no probado) |

Conclusiones:
- Groq acepta llamadas directas desde el navegador. No hace falta el plan B (Cloudflare Worker) para la IA.
- ORS acepta el preflight. Queda pendiente confirmar con una clave válida que la respuesta 200 también trae `access-control-allow-origin`.
- **Consecuencia para `probeOrs`:** la respuesta 403 de ORS por clave mala no trae cabecera CORS, así que el navegador la ve como un error de red (`TypeError`), no como 403. Una clave ORS incorrecta aparecerá como `network` o `cors`, no como `unauthorized`. El mensaje de Ajustes debe decir «Clave rechazada o sin conexión».
