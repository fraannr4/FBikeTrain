# Fixtures de prueba

Todos los fixtures son sintéticos: el recorrido está en el mar frente a la costa (lat 41.0, lng 2.5),
para no revelar ninguna ubicación real. Ningún fichero de aquí sale de un dispositivo ni de Strava.

| Fichero | Origen |
|---|---|
| `ride.gpx`, `ride.tcx` | Escritos a mano: 20 puntos, uno cada 10 s, altitud de 0 a 40 m. |
| `ride.fit` | Generado con el `Encoder` de `@garmin/fitsdk` por `make-ride-fit.mjs`: el mismo recorrido, actividad de ciclismo con mensajes de lap y de sesión. Los totales de la sesión (1950,5 m, 185 s de cronómetro, 200 s totales, 41 m de desnivel) difieren a propósito de los calculados desde los puntos. |
| `corrupt.fit` | `ride.fit` truncado a la mitad, generado por el mismo script. |
| `stravaRoutes.ts` | Genera en memoria rutas planificadas GPX y TCX con la forma supuesta de `routes/` de Strava, sin horas. |

Para regenerar los FIT: `node tests/fixtures/make-ride-fit.mjs`.

## `ors/`

Respuestas de OpenRouteService **sintéticas y provisionales**, generadas por `ors/make-ors-fixtures.mjs`
con la forma documentada de la API. Se sustituirán por respuestas reales cuando el usuario tenga clave
y se haga la tarea 1 de F4. A diferencia de los demás, su recorrido está en tierra: empieza en la Puerta
del Sol de Madrid, un punto público. Detalle en `ors/README.md`.

## `llm/`

Respuestas del proveedor de IA (formato OpenAI `chat/completions`, como las de Groq) **sintéticas y
provisionales**, escritas a mano: éxito del plan y de la explicación, JSON ilegible, JSON que zod
rechaza, 401, 429, 400 de esquema, 400 de modelo sin `json_schema` y 503. Se sustituirán por respuestas
reales cuando el usuario tenga clave de Groq y se haga la tarea 1 de F5. Detalle en `llm/README.md`.
