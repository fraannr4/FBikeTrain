# Bienvenida «Cumbre», claves en el servidor y empalme de rutas

Fecha: 2026-11-09. Decisiones del usuario en esta sesión:
- Animación de bienvenida tras el login, con silueta ciclista.
- Nadie configura claves: la IA (Groq) y el motor de carreteras (ORS) se usan desde el servidor (Supabase Edge Functions).
- Empalmar dos rutas: solo bici de carretera, nunca autopistas ni autovías. Si hay dos caminos parecidos, se proponen como alternativas.
- Los datos antiguos de la base local `ciclismo` no se migran: eran de ejemplo.
- Próximo lote, fuera de este plan: referencias de Wikiloc (análisis de los GPX públicos de sus usuarios, con OpenStreetMap como respaldo), entrenos con IA y conector de intervals.icu.

Reglas que se mantienen:
- La IA recibe solo cifras resumidas y nunca tracks GPS ni «Casa».
- Mobile-first con capturas a 360-430 px.
- Ninguna clave en el repositorio ni en el bundle.
- Pruebas con `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run test:db` y Playwright.

## Task 1: Escena de bienvenida «Cumbre»

Objetivo: cuando alguien termina de entrar (correo/contraseña, Google o enlace de confirmación), ve una escena de bienvenida de un solo disparo, distinta del loader. No aparece al recargar con la sesión guardada.

Ficheros:
- crear `src/auth/WelcomeScene.tsx`;
- crear `src/auth/welcome.css`;
- crear `src/auth/useFreshSignIn.ts`;
- modificar `src/auth/AccountBoundary.tsx`;
- modificar `src/ui/shell/BrandMark.tsx`, que exporta la forma del trazo para reutilizarla sin duplicarla y acepta `className`;
- crear `tests/welcomeScene.test.tsx`;
- ampliar `tests/accountBoundary.test.tsx`.

Storyboard (1,8 s en total, sin esperas añadidas):

| Momento | Qué pasa |
|---|---|
| 0-180 ms | La tarjeta de acceso se funde |
| 0-900 ms | El trazo B Trazado, grande y centrado, se dibuja de abajo arriba con `stroke-dashoffset` y `pathLength=1`, `cubic-bezier(.23,1,.32,1)` |
| 120-900 ms | Una silueta ciclista sube por el mismo trazo (`offset-path` y `offset-distance`, solo transform). Si `offset-path` no tiene soporte, se oculta |
| 820-1100 ms | El punto de cumbre hace un pulso (escala .7, 1.12 y 1) y un anillo se expande y desvanece |
| 900-1300 ms | Aparece «Hola, {nombre}.» con fundido y 10 px de subida |
| 1100-1500 ms | Subtítulo «Tu próxima cima empieza aquí.» |
| 1500-1800 ms | Fundido cruzado a Inicio: la escena sale con opacity y -8 px, e Inicio entra con opacity |

Reglas de la escena:
- **Cuándo sale.** Solo con un `SIGNED_IN` tras una acción real. Nunca con `INITIAL_SESSION` ni con el `SIGNED_IN` que Supabase repite al volver a la pestaña. Para OAuth y el enlace de correo, la marca se arma antes de redirigir, en `sessionStorage` con try/catch y caducidad de 10 minutos.
- **Nombre.** Se usa `display_name` del perfil o de los metadatos. Si falta, la parte local del correo. Si tampoco hay, «Hola.». Un nombre largo se corta a 2 líneas con elipsis.
- **Saltar.** Un toque o una tecla saltan la escena. Desde los 400 ms se ve un botón «Continuar» de al menos 44 px. La escena tiene `role="status"` y `aria-live="polite"`.
- **En paralelo con la base.** La escena corre a la vez que la base de la cuenta se abre. Si al terminar la base no está lista, aparece `CyclingLoader`; si lo está, la escena nunca espera.
- **Movimiento reducido.** Trazo ya completo, sin ciclista ni pulso, y saludo con fundido de 200 ms. Dura 900 ms como máximo.
- **Rendimiento.** Solo transform, opacity y stroke-dashoffset, con keyframes CSS. Ningún `setState` por fotograma y nada de `filter: blur`.
- **Tokens.** Se usan los de `.account-page` (`--account-route`, `--account-paper`, `--ink`), con tema claro y oscuro. En móvil, el trazo mide `min(70vw, 280px)` y el saludo `clamp(32px, 9vw, 44px)`.
- `CyclingLoader` queda solo para las esperas reales.

Pruebas:
- Aparece tras un `SIGNED_IN` con la marca de acción y no con `INITIAL_SESSION`.
- Termina sola con temporizadores falsos.
- Se salta con clic y con Escape.
- Con movimiento reducido usa el temporizador corto.
- Un nombre de 60 caracteres o con emoji no desborda.
- El cambio de usuario sigue recargando.

Verificación: capturas con Playwright a 360, 390 y 430 px, en apaisado, en los dos temas y con movimiento reducido.

## Task 2: IA y motor de carreteras desde el servidor

Objetivo: con sesión iniciada, Rutas y Rutas con IA funcionan sin pedir claves. La clave personal queda como opción avanzada y como respaldo.

Ficheros:
- crear `supabase/functions/ors-proxy/index.ts`, con el mismo patrón que `ai-routes`:
  - CORS con `APP_ALLOWED_ORIGINS` y JWT validado con `auth.getUser`;
  - zod estricto con dos operaciones: `round_trip` (start, lengthM, points, seed) y `path` (de 2 a 8 waypoints, más `alternatives` opcional);
  - el cuerpo de ORS lo construye el servidor, con perfil `cycling-road`, `extra_info` y elevación; el cliente nunca envía la URL ni las opciones;
  - secretos `ORS_API_KEY` y `SHARED_ORS_ENABLED`;
  - no registra coordenadas ni devuelve errores crudos de ORS.
- crear `supabase/migrations/202611100001_shared_ors_quota.sql`:
  - función `consume_shared_ors_quota(account_id uuid, cost int)` que reutiliza `shared_ai_usage`, con buckets `ors:user:<id>:day|minute` y `ors:global:day|minute`;
  - límites: global 1.800 al día y 35 por minuto; por usuario 150 al día y 8 por minuto;
  - ejecutable solo por `service_role`;
  - pruebas en `supabase/tests/shared_ors_quota.sql`, con su llamada desde `scripts/test-account-sql.mjs`.
- crear `src/routes/orsProxy.ts`, cliente con la misma firma que `fetchRoadFeature`, que traduce 401/429/503 a `OrsError`.
- modificar `src/routes/ors.ts`, el generador, `src/routes/roadPath.ts` y el hook de búsqueda:
  - selector: con cuenta y `VITE_SHARED_ORS_ENABLED === 'true'` va por el proxy, si no con la clave personal;
  - la clave pasa a ser opcional.
- modificar `src/ai/routePlanner.ts` y `src/ui/pages/RutasIa.tsx`: si la IA compartida falla por red o porque el servicio no está disponible y existe una clave personal, se reintenta con ella. Con 429 (cuota agotada) se muestra el límite y no se reintenta.
- modificar `src/ui/pages/Rutas.tsx`, `RutasIa.tsx` y `Ajustes.tsx`: con el modo compartido activo no se piden claves; Ajustes las muestra plegadas como «Avanzado: usar mis propias claves».
- modificar `.github/workflows/deploy.yml`: `VITE_SHARED_AI_ENABLED` y `VITE_SHARED_ORS_ENABLED` salen de las variables del repositorio (`vars.*`) y están apagadas por defecto.
- actualizar `supabase/functions/ai-routes/README.md` con el despliegue de las dos funciones. Para Windows con `npx supabase`: login, link, `db push --dry-run`, `db push`, `secrets set`, y `functions deploy` sin `--no-verify-jwt`.

Pruebas:
- `tests/orsProxy.test.ts` con fetch simulado.
- El selector de modo.
- Volver a la clave personal ante un 503 y no ante un 429.
- La interfaz no pide claves con el modo compartido.
- Que el bundle no contiene secretos (`grep` sobre `dist`).
- Ninguna petición a la IA lleva coordenadas.

## Task 3: Empalmar dos rutas (bici de carretera)

Objetivo: el usuario elige dos rutas guardadas (de la biblioteca o generadas con IA) y obtiene una sola ruta continua y válida para el BSC200S, con los conectores calculados por carretera real.

Ficheros:
- crear `src/routes/splice.ts`, puro y probado:
  - **Orden y sentido.** Calcula las 4 combinaciones (A y luego B, B y luego A, cada una en su sentido o invertida), solo con las inversiones permitidas: una ruta circular se puede recorrer al revés, un tramo de sentido único no.
  - **Puntos de unión.** Busca los extremos más cercanos o, si las rutas se cruzan o pasan a menos de 300 m, el punto de unión más cercano sobre cada ruta.
  - **Conector.** Lo pide a ORS (`path` con `alternatives`, perfil `cycling-road`).
  - **Validez.** Descarta un conector si su `extra_info` `waytype`/`waycategory` incluye autopista o autovía (`motorway`, `trunk`, o el equivalente que devuelva ORS), o si tiene saltos de más de 50 m entre puntos.
  - **Regreso.** Con la opción «Volver al inicio», añade un conector de regreso.
  - **Cifras.** Recalcula distancia, desnivel, duración estimada y dificultad con las funciones existentes de `src/metrics`. Descuenta solapes y detecta retrocesos (el mismo tramo en sentido contrario durante más de 500 m).
- **Alternativas.** Si ORS devuelve dos conectores cuya diferencia de distancia es de un 15 % o menos y que comparten menos del 70 % del trazado, se presentan las dos con sus cifras (distancia, desnivel y porcentaje de vías principales) y el usuario elige.
- **Papel de la IA.** Si está disponible, solo recibe cifras de cada candidato (distancia, desnivel, tipos de vía, solape) y devuelve cuál recomienda y por qué, en una frase. Nunca recibe coordenadas. Sin IA, gana la combinación más corta sin vías principales.
- crear la interfaz de empalme en `src/ui/pages/BibliotecaRutas.tsx`, o una pantalla nueva `src/ui/pages/Empalmar.tsx` con ruta `/rutas/empalmar`:
  - selección de las dos rutas;
  - mapa CyclOSM con los tramos originales y los conectores en otro color, y una leyenda del origen de cada tramo;
  - tarjetas de las alternativas, con su resumen de cifras, la recomendación de la IA y su limitación;
  - exportación GPX con las funciones existentes.
  - Mobile-first.
- **Rutas generadas en la biblioteca.** En Rutas y en Rutas con IA, la acción «Guardar en la biblioteca» (`saveGeneratedRoute` en `src/routes/library.ts`, hook `src/ui/routes/useSaveRoute.ts`) guarda la ruta del carrusel con su GPX como original, para empalmarla sin exportar e importar el fichero.
- Pruebas `tests/splice.test.ts` con geometrías sintéticas:
  - rutas desconectadas;
  - sentidos opuestos;
  - conector con autopista (descartado);
  - conector imposible;
  - solapes;
  - rutas sin altitud;
  - dos alternativas parecidas (se proponen las dos);
  - cuota agotada;
  - cancelación;
  - un GPX final continuo, sin saltos de más de 50 m.
- Pruebas e2e en `e2e/empalmar.spec.ts` a 390x844, con ORS simulado.

## Comprobaciones del usuario (anotar en `docs/verificaciones.md`)

1. [x] (hecho 2026-11-10) Aplicar las migraciones 0001, 0002 y la nueva de ORS en Supabase (SQL Editor o `npx supabase db push`).
2. [x] (hecho 2026-11-10) Crear la clave de Groq en el plan gratuito, sin método de pago, y la clave de ORS. Guardarlas con `supabase secrets set`.
3. [x] (hecho 2026-11-10) Desplegar `ai-routes` y `ors-proxy`. Activar las variables del repositorio `VITE_SHARED_AI_ENABLED` y `VITE_SHARED_ORS_ENABLED`.
4. Probar en el móvil el login real con la escena de bienvenida, una ruta sin claves y un empalme exportado al BSC200S.
