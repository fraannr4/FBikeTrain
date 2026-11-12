# Fixtures del proveedor de IA

**Sintéticos y provisionales.** La tarea 1 de F5 (grabar respuestas reales de Groq con la clave del
usuario) no se ha podido hacer porque el usuario no tiene clave. Estos ficheros imitan la forma
documentada de `POST /openai/v1/chat/completions` (compatible con OpenAI) para el modelo de ejemplo
`openai/gpt-oss-20b`, y **se sustituirán por respuestas reales** cuando se haga la tarea 1. Al cambiarlos,
revisar `tests/llm.test.ts`, que depende de algunas cifras y textos concretos.

Ninguno lleva claves, coordenadas ni datos del usuario. Se ha quitado el `id` de la respuesta.

| Fichero | Estado HTTP | Contenido |
|---|---|---|
| `plan-ok.json` | 200 | `choices[0].message.content` con un `RoutePlan` válido de 3 opciones y `message.reasoning` (propio de gpt-oss en Groq), que el cliente ignora. |
| `explain-ok.json` | 200 | `content` con `{ explicaciones: [{ id, texto }] }` para `r1` y `r2`. |
| `plan-not-json.json` | 200 | `content` cortado (`finish_reason: "length"`) que no se puede leer como JSON. |
| `plan-bad-schema.json` | 200 | JSON legible pero con `subidaPct: 20` en la primera opción: zod lo rechaza. |
| `unauthorized-401.json` | 401 | `{ error: { message: "Invalid API Key", type, code } }`. |
| `workouts-ok.json` | 200 | Entrenos de la semana: 3 entrenos (`dia` 0, 2 y 5) y `motivo` que cita la media; la salida larga (70 km) y el desnivel de subidas (800 m) pasan del 15 % para probar el recorte. |
| `splice-ok.json` | 200 | Recomendación de empalme: `{ recomendada: "c2", motivo }` con una frase que cita cifras. |
| `waypoints-ok.json` | 200 | Combinaciones de puntos de paso: `w1`+`w2` al noreste y `w3` al sur, con títulos sin cifras. |
| `waypoints-bad-schema.json` | 200 | JSON legible con una combinación de 4 puntos: zod lo rechaza y el servicio responde `invalid_response`. |
| `rate-limit-429.json` | 429 | Límite de peticiones por minuto. La cabecera `retry-after` la pone cada prueba. |
| `schema-mismatch-400.json` | 400 | «Generated JSON does not match the expected schema. Please adjust your prompt.» (texto de la documentación de Groq). |
| `model-unsupported-400.json` | 400 | Modelo sin `json_schema`. **El texto es inventado**: la documentación de Groq no lo publica. |
| `server-503.json` | 503 | Servicio no disponible. |

Fuentes de la forma: https://console.groq.com/docs/errors (`{ error: { message, type } }`),
https://console.groq.com/docs/structured-outputs y https://console.groq.com/docs/rate-limits.

Supuestos que la tarea 1 debe confirmar:
- el texto real del 400 de un modelo que no admite `json_schema` (el cliente busca `response_format` o `json_schema` en el mensaje);
- que `retry-after` es legible desde el navegador (`access-control-expose-headers`); si no lo es, el mensaje dice «Prueba dentro de un minuto»;
- los límites del plan gratuito para `openai/gpt-oss-20b` (el cliente cita 30 por minuto y 1.000 al día, los del plan Developer).
