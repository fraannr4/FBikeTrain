# Instalar FBikeTrain y recibir ficheros

La app puede instalarse desde Chrome en Android y recibir archivos mediante Web Share Target. No se usa la API de Strava ni se añade soporte offline: abrir la app y completar el acceso requiere conexión. iOS permite añadir la web a inicio, pero **no admite `share_target`**; allí hay que descargar el archivo y elegirlo en Importar o en la biblioteca.

La PWA original **ya está fusionada en main** por `b489fc2` (2026-11-10). Revisada el **2026-11-11** desde `codex/fuentes-externas`: `dd1d0a1` (punta de `codex/pwa-compartir`) es antecesor de main y no tiene cambios exclusivos; no hay nada que rebasar ni otra fusión pendiente de esa rama. Las correcciones descritas aquí están en la nueva worktree, sin commit, push ni despliegue. Aplican a la URL pública cuando se publiquen.

## Android

1. Abre `https://fraannr4.github.io/FBikeTrain/` en Chrome. Entra en Ajustes y pulsa **Instalar la app** cuando esté disponible. También puedes usar el menú de Chrome → Instalar app / Añadir a pantalla de inicio. Acepta el diálogo de instalación. Si solo aparece un acceso directo, comprueba que Chrome ha terminado de reconocer la PWA.
2. Abre la app instalada al menos una vez con conexión para activar el receptor de archivos.
3. En Wikiloc, abre una ruta que puedas descargar legítimamente y exporta su **archivo GPX o TCX**. Comparte el archivo y elige **FBikeTrain** en la hoja de Android. Compartir solo el enlace de la ruta no entrega el track. Los nombres y la disponibilidad de exportación dependen de la versión y permisos de Wikiloc; si no ofrece compartir archivo, descárgalo y compártelo desde Archivos/Descargas.
4. En iGPSPORT, abre el detalle de una actividad y busca Exportar/Compartir archivo original **FIT** (o GPX/TCX). Elige FBikeTrain si la versión de la app ofrece enviar el archivo. Una imagen o un enlace de actividad no sirve; si iGPSPORT solo ofrece esos formatos, descarga el original cuando esté disponible y compártelo desde Archivos. La PWA no puede habilitar una exportación que iGPSPORT no ofrezca.
5. Si falta la sesión, entra en FBikeTrain: el envío sigue en la bandeja local mientras se realiza el login. Para un GPX/TCX descargado para planificar, elige **Ruta de referencia · Biblioteca**, aunque contenga horas. Usa **Actividad realizada · Historial** para tus propias salidas. Pulsa **Importar ficheros** y comprueba el resultado. Antes de importar, prueba a recargar: el envío debe seguir disponible.
6. Prueba también tres archivos juntos y vuelve a enviar una actividad: el informe debe contarla como duplicada. No uses datos reales en el repositorio ni en capturas de pruebas.

7. Como respaldo, en FBikeTrain abre **Rutas → Biblioteca de rutas → Elegir GPX o TCX** y selecciona el fichero en Descargas/Archivos. Puedes añadir un enlace de origen opcional. Si el GPX incluye autor y enlace, se leen automáticamente. Comprueba que aparece como ruta, sin incrementar el número de salidas ni las estadísticas. Este es también el flujo para iPhone: Safari/Archivos → guardar descarga → selector de la biblioteca. No necesita instalar la PWA.

8. Abre Rutas con IA, elige un inicio cercano (hasta 15 km del primer punto de la referencia) y solicita propuestas compatibles con sus kilómetros. Cuando el plan use la referencia, la tarjeta debe mostrar su origen/autor y el enlace si existe. No todas las propuestas tienen que citarla; las cifras no garantizan que el trazado nuevo siga su GPX. Para usar los tramos exactos, abre la biblioteca o Empalmar.

9. Exporta el GPX que quieras navegar, ábrelo/importa en iGPSPORT y envíalo al BSC200S. Verifica en el dispositivo que aparece el recorrido. No se necesita Intervals.icu como puente. Anota versión de Android, Chrome, Wikiloc e iGPSPORT y resultado en `docs/verificaciones.md`.

La instalación y el intercambio desde las apps reales necesitan comprobación en un Android físico. Las pruebas automatizadas usan únicamente archivos sintéticos y no certifican los menús de Wikiloc/iGPSPORT. El flujo IA con fuente `biblioteca` exige publicar además el esquema actualizado de `ai-routes`; este lote no despliega servicios.

## Destino y conservación

- `.fit`: importador de salidas existente, a través del mismo Worker que Importar, con `importFiles` e informe de duplicados.
- `.gpx`: un único track sin tiempos en sus puntos es una referencia; las fechas de metadata no lo convierten en actividad. Si hay horas en los puntos, se trata como actividad. Un único track con autor y enlace a `wikiloc.com` se considera referencia aunque conserve horas.
- `.tcx`: un único `Course` va a la biblioteca; `Activity` va al importador de salidas.
- La biblioteca recibe el `File` original mediante `importReferenceRoute`, sin reescribir XML, autor ni enlaces. Los archivos inválidos o no admitidos muestran un error individual y no impiden procesar los demás.
- GPX/TCX válidos permiten corregir el destino propuesto antes de importar; FIT sigue siendo actividad. La importación manual desde biblioteca trata el fichero como referencia incluso si contiene tiempos.

El SW guarda cada envío multipart bajo un UUID en `fbiketrain-shares-v1`, en la Cache API de este navegador. El envío permanece allí sin sesión; no se sube a ningún servidor. La pantalla autenticada lo lee sin borrarlo: **recargar o cerrar antes de importar conserva los archivos** hasta su caducidad. Después de guardar cada referencia o procesar el lote de actividades, se retiran de la bandeja esos ficheros; un fallo posterior no vuelve a ofrecer los ya procesados. Los destinos elegidos en pantalla se vuelven a detectar al recargar. **Descartar envío** lo elimina expresamente. Un envío completado no vuelve a ofrecerse al regresar a su URL.

La caché temporal pertenece al navegador, no a una cuenta; la cuenta activa importa solo tras confirmarlo. Usa un navegador/perfil propio en un teléfono compartido y descarta envíos que no quieras conservar. Dos ventanas sobre el mismo envío no tienen bloqueo transaccional; importa desde una sola. La escritura en biblioteca y el acuse en Cache API no son una transacción única: si el almacenamiento del acuse falla después de guardar una ruta, revisa la biblioteca antes de reenviar. Las actividades sí conservan su deduplicación habitual.

Límites de recepción: 20 ficheros y 50 MB en total; clasificación XML hasta 10 MB por fichero. Los envíos abandonados caducan a las 24 horas: se eliminan al leerlos o al recibir otro envío. El navegador puede eliminar almacenamiento local por falta de espacio. Los límites de validación de la biblioteca y del importador siguen aplicándose.

## Implementación y pruebas locales

`public/manifest.webmanifest` usa URLs relativas a su propia ubicación (`./`), de modo que `start_url`, `scope`, iconos y `share_target.action` respetan tanto la raíz de desarrollo como `/FBikeTrain/` en Pages. El SW calcula la misma base desde su URL. No se necesitan reescrituras de servidor para el POST, porque lo intercepta el SW activo.

Los colores proceden de `tokens.css`: fondo/tema oscuro `#14221F`, claro `#F7F4EA`. El manifest usa el oscuro inicial; la barra del navegador sigue el tema elegido mediante el meta `theme-color` y el mecanismo ya existente. Los PNG 192 y 512 se generan desde `public/brand-mark.svg` con `node scripts/generate-pwa-icons.mjs` (Playwright ya instalado), sobre el fondo claro de marca.

`index.html` enlaza el manifest y carga el registro. El registro del SW solo se ejecuta en producción; **`npm run dev` no activa el receptor**. Ejecuta `npm run build` y `npm run preview -- --host 127.0.0.1`, abre la URL local y espera a que `navigator.serviceWorker.ready` se resuelva. En DevTools → Application comprueba manifest, iconos, scope y SW. Para verificar Pages: `$env:BASE_PATH='/FBikeTrain/'; npm run build`; sirve el build bajo esa subruta. HTTPS (o localhost) es obligatorio.

El SW solo intercepta `POST <base>/share-target`. Guarda el multipart, devuelve un 303 a `<base>#/compartido?envio=<uuid>` y no añade precaché, fallback de navegación ni manejadores de GET. La web conserva su actualización por red habitual. Tras cambiar manifest o SW, abre Chrome con conexión y permite que se actualice la instalación.

Pruebas: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, e2e afectados. `e2e/compartido.spec.ts` comprueba login pendiente, recarga, destino manual, descarte, informe mixto con duplicados y POST real al SW. Capturas en `test-results/pwa-compartir/`: 360, 390, 412 y 430 px y apaisado 844×390 × claro/oscuro × un archivo/tres/no admitido. `e2e/fuentes-externas.spec.ts` verifica el selector manual con un GPX sintético con tiempos/autor/enlace, persistencia, recuperación tras error y ausencia de actividades ficticias; captura biblioteca vacía/importada en los cuatro anchos, apaisado y ambos temas. Resultado de la ejecución actual en `docs/verificaciones.md`.

Referencias: [Chrome: Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target), [MDN: share_target y compatibilidad](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target).

## Ficheros del lote

- PWA: `public/manifest.webmanifest`, `public/sw.js`, `public/brand-mark-192.png`, `public/brand-mark-512.png`, `scripts/generate-pwa-icons.mjs`, `src/pwa/register.ts`, `src/pwa/sharedFiles.ts`.
- Integración: `index.html`, `src/App.tsx`, `src/main.tsx`, `src/auth/AccountBoundary.tsx`, `src/ui/shell/screens.ts`.
- Interfaz: `src/ui/pages/Compartido.tsx`, `src/ui/styles/compartido.css`, `src/ui/components/InstallApp.tsx`, `src/ui/pages/Ajustes.tsx`.
- Pruebas: `tests/sharedFiles.test.ts`, `e2e/compartido.spec.ts`.
- Documentación: `docs/pwa-compartir.md`, `docs/ESTADO.md`, `docs/verificaciones.md`.
