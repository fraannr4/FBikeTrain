# Rutas de Wikiloc cerca

Preparado el 2026-11-11 en la rama `codex/integracion-rutas`. **Sin publicar.** Plan: [2026-11-11-wikiloc-cerca-adaptar.md](superpowers/plans/2026-11-11-wikiloc-cerca-adaptar.md).

Recomienda rutas de Wikiloc que salen de la zona del usuario o pasan por ella, y adapta la que elija a su punto de partida y a la distancia y el desnivel que escriba. Wikiloc no tiene API pública y su web está detrás de Cloudflare, así que todo se hace en el navegador del usuario, con su sesión y con un toque suyo cada vez.

## Operativa

1. **App, `#/rutas/wikiloc` («Rutas de Wikiloc cerca»).** El usuario escribe la distancia (obligatoria) y, si quiere, el desnivel, y elige el inicio como en Rutas. «Buscar en Wikiloc» abre en otra pestaña (`noopener`) el mapa `es.wikiloc.com/wikiloc/map.do` con un rectángulo de 8 km alrededor del inicio y la actividad 29, ciclismo de carretera (`wikilocSearchUrl`). La app guarda lo pedido en la base de la cuenta para la ventana que abrirá el marcador. Nuestro servidor no interviene.
2. **Wikiloc, primer toque del marcador «→ FBikeTrain».** En la lista o el mapa, el marcador lee las rutas visibles (como mucho 50). Si el mapa no muestra tarjetas, hace **una** consulta del mismo origen a `find.do?event=map` para esa misma vista. Después abre `#/rutas/wikiloc/recibir` y le entrega los datos.
3. **App, recomendación.** `rankForTarget` admite rutas de 0,5× a 1,6× la distancia pedida, porque se pueden recortar o alargar, y las ordena por cercanía a lo pedido: distancia y, si se ha escrito, desnivel. El nivel del usuario solo pone la etiqueta Suave, Media o Dura y desempata; nunca descarta. Cada descarte lleva su motivo. Si hay IA y al menos 3 rutas encajan, la operación `plan` existente elige de 3 a 5, cada una con su motivo (`src/ai/wikilocAdvisor.ts`). Sin IA, sin nivel o con la cuota agotada, se queda el orden local y la pantalla lo dice.
4. **App, «Adaptar esta ruta».** Abre la ficha de esa ruta en Wikiloc.
5. **Wikiloc, segundo toque del marcador.** En la ficha, el marcador sigue el enlace de descarga oficial que ofrece la página, del mismo origen y con la sesión del usuario (`credentials: 'include'`), para una sola ruta. Comprueba que lo recibido es GPX y como mucho de 5 MB, y lo entrega a la app.
6. **App, `#/rutas/wikiloc/adaptar`.** `adaptRoute` deja la ruta como se pide:
   - «Desde mi inicio»: si es un circuito que pasa a menos de 300 m del inicio, lo rota para empezar y acabar ahí. Si pasa más lejos o es lineal, añade conectores de carretera de ORS (`cycling-road`) de ida y de vuelta; una ruta lineal se coge por el extremo más próximo.
   - «Desde el inicio de la ruta»: la ruta tal cual.
   - Si pasa de lo pedido en más de un 8 %, se recorta y se cierra con ORS. Si se queda corta en más de un 20 %, se alarga con un `round_trip` de ORS desde el inicio; si no cabe, se avisa.
   - Se valida: sin autopista, pistas dentro del límite, retroceso como mucho el de `MAX_INTENT_BACKTRACK` y ningún salto de más de 5 km. Si no cumple, la pantalla dice por qué y no la presenta como buena.
   - Como mucho 4 consultas a ORS por adaptación. Los errores de cuota de ORS se muestran con su mensaje.
   - Se ven el mapa CyclOSM y las cifras: km, desnivel, metros de conectores y a qué distancia pasa del inicio.
7. **«Guardar en la biblioteca»** guarda la ruta adaptada con autor y enlace. **«Enviar al iGPSPORT»** comparte el fichero con Web Share en Android si está disponible y, si no, descarga un GPX 1.1 con el exportador actual (`trk`, `trkseg` y `ele`).

En total son 2 toques del marcador y ningún fichero manejado a mano hasta el envío final al dispositivo.

## Límites

- No se elude Cloudflare. No se reutilizan cookies (`cf_clearance`) ni se usan navegador sin cabeza, proxy o rotación de IP. Nada lee wikiloc.com desde nuestro servidor; `WIKILOC_AUTOMATION_AUTHORIZED` sigue sin definir en las Edge Functions.
- El track nunca se extrae del HTML de la página: la geometría llega solo por la descarga oficial del GPX, que hace el usuario con su cuenta.
- Como mucho una petición a Wikiloc por toque del marcador: sin bucles, sin reintentos automáticos y sin recorrer otras zonas o páginas.
- Si la descarga exige Premium, iniciar sesión o una confirmación, el marcador no la salta: avisa y deja el botón «Descargar» de Wikiloc.
- A la IA solo le llegan nombre, fuente, km y desnivel de cada ruta. Nunca coordenadas, enlaces, ids de Wikiloc, autores ni «Casa». Lo comprueba el e2e `e2e/wikiloc-cerca.spec.ts`.
- La lista recibida y la ruta pendiente de adaptar se guardan en la base Dexie de la cuenta (tabla `wikilocNearby`, versión 5) y caducan a los 7 días.
- La app solo acepta mensajes de una ventana `https://*.wikiloc.com` que sea la que la abrió, los valida con los esquemas zod de `src/routes/wikilocNearby.ts` (versión `v: 1`, sin campos de más) y nunca los pinta con `innerHTML`.
- Zona gris respecto a las condiciones de Wikiloc (apartados 1.2 y 1.6). Es para uso personal y académico del TFG, y se envía la solicitud de autorización de [wikiloc-solicitud-acceso.md](wikiloc-solicitud-acceso.md). **Si Wikiloc la deniega, se quita el segundo toque (descarga del GPX)** y se vuelve a la descarga manual y la importación en la biblioteca o el envío desde la PWA ([pwa-compartir.md](pwa-compartir.md)).

## Qué lee el marcador

| Dónde | Qué lee | Peticiones |
|---|---|---|
| Lista de resultados o mapa con tarjetas | Nombre, km, desnivel, dificultad, autor, enlace e id de las rutas visibles, hasta 50 | Ninguna |
| Mapa sin tarjetas visibles | Lo mismo, de la respuesta de la consulta que usa el propio mapa para esa vista | Una, a `find.do?event=map`, del mismo origen |
| Ficha de una ruta | Nombre, autor, enlace e id de la ficha, y el GPX de la descarga oficial | Una, al enlace de descarga de la página |

No lee contraseñas ni cookies y no envía nada a ningún servidor: entrega un único mensaje a la ventana de FBikeTrain que abre, con `postMessage` y el origen exacto de la app, cuando la app responde `fbt-ready`. Si la app no responde en 15 s, lo avisa en la página de Wikiloc. Los avisos se escriben con `textContent`.

El código está en `src/bookmarklet/`:
- `wikilocReader.ts`: lectura pura de la lista, del mapa y de la ficha;
- `trackDownload.ts`: la descarga del GPX;
- `bookmarklet.ts`: decide en qué página está y entrega el mensaje;
- `protocol.ts`: acuerdo con la app y direcciones de producción y desarrollo;
- `installPage.ts`: la página de instalación.

## Instalarlo

`npm run build:bookmarklet` genera `public/wikiloc-marcador.html`; `npm run build` también lo lanza. La app lo enlaza en «Rutas de Wikiloc cerca» como «Instalar el marcador». Publicada, la página queda en `https://fraannr4.github.io/FBikeTrain/wikiloc-marcador.html`.

- **En el ordenador:** mostrar la barra de favoritos (Ctrl+Mayús+B en Chrome) y arrastrar a ella el enlace «→ FBikeTrain». Desde `localhost` la página da el marcador que abre la app de desarrollo (`http://localhost:5173/`).
- **En Chrome para Android:**
  1. Copiar el código con «Copiar el código».
  2. Crear un favorito de cualquier página con la estrella del menú.
  3. Editarlo: nombre «FBikeTrain» y, como dirección, el código copiado.
  4. En Wikiloc, escribir «FBikeTrain» en la barra de direcciones y tocar el favorito que sale con la estrella, no la búsqueda.
- Si el navegador bloquea la ventana de FBikeTrain, hay que permitir las ventanas emergentes en wikiloc.com.

Tras cambiar algo en `src/bookmarklet/`, hay que volver a generar la página y **reinstalar el marcador**: el favorito guarda una copia del código.

## Actualizar `WIKILOC_FORMAT`

Todo lo que depende del HTML o del JSON de Wikiloc está en el objeto `WIKILOC_FORMAT` de `src/bookmarklet/wikilocReader.ts`. Los valores actuales son un supuesto razonable **sin validar contra la página real**. Cuando Wikiloc cambie, o al validarlo por primera vez, se ajusta ese objeto y no la lógica.

1. En el navegador del usuario, con su sesión, abrir las herramientas de desarrollo en la lista o el mapa, en una ficha y en la petición de «Descargar». No se guarda HTML ni respuestas reales en el repositorio.
2. Ajustar lo que haga falta:
   - `paths.map` y `paths.track`: rutas del mapa y de la ficha. El grupo 1 de `track` es el id.
   - `list.card`, `list.idAttribute`, `list.name` y `list.author`: selectores de las tarjetas.
   - `list.fields.*`: selector de cada cifra y, si no lo hay, las etiquetas que la preceden, en minúsculas y sin tildes. `list.label` dice qué elementos hacen de etiqueta.
   - `find.path`, `find.params` y `find.copyParams`: la consulta del mapa y los parámetros de la vista que se copian de su URL.
   - `find.lists`, `find.fields` y `find.distanceUnit`: dónde viene la lista en el JSON, el camino con puntos de cada campo (`author.name`) y si la distancia numérica viene en metros o en km.
   - `track.name`, `track.author` y `track.download`: la ficha y su enlace de descarga oficial.
   - `track.premium`, `track.login` y `blockedPath`: señales de que la descarga necesita Premium, iniciar sesión o confirmar.
   - `difficulties` y `difficultyScale`: textos de dificultad y su escala numérica del 1 al 5.
3. Reproducir el formato nuevo en los fixtures **sintéticos** de `tests/wikilocReader.test.ts` y `tests/trackDownload.test.ts`, con ids, nombres y autores inventados. Primero la prueba que falla y después el ajuste.
4. Ejecutar `npx vitest run tests/wikilocReader.test.ts tests/trackDownload.test.ts tests/bookmarklet.test.ts` y `npx tsc --noEmit`.
5. Regenerar con `npm run build:bookmarklet` y reinstalar el marcador.

Los topes del mensaje (50 rutas, 5 MB de GPX, 120 caracteres de nombre y 80 de autor) están en `src/routes/wikilocLimits.ts`, compartidos por la app y el marcador.

## Pendiente del usuario

- Validar `WIKILOC_FORMAT` y la descarga contra la página real de Wikiloc en su navegador: tarjetas de resultados, respuesta de `find.do?event=map` y la petición de «Descargar» (formato GPX, original o reducido).
- Probar el marcador en Chrome para Android, en el teléfono real, y el envío del GPX a la app de iGPSPORT y al BSC200S.
- Enviar la solicitud de autorización a Wikiloc y anotar la respuesta en `docs/verificaciones.md`.
