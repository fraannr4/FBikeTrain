# Instalar FBikeTrain y recibir ficheros

La app puede instalarse desde Chrome en Android y recibir archivos mediante Web Share Target. No se usa la API de Strava ni se añade soporte offline: abrir la app y completar el acceso requiere conexión. iOS permite añadir la web a inicio, pero **no admite `share_target`**; allí hay que descargar el archivo y elegirlo en Importar o en la biblioteca.

Estos cambios están preparados en `codex/pwa-compartir`, sin push ni despliegue. Los pasos sobre la URL pública se aplican después de publicarlos.

## Android

1. Abre `https://fraannr4.github.io/FBikeTrain/` en Chrome. Entra en Ajustes y pulsa **Instalar la app** cuando esté disponible. También puedes usar el menú de Chrome → Instalar app / Añadir a pantalla de inicio. Acepta el diálogo de instalación. Si solo aparece un acceso directo, comprueba que Chrome ha terminado de reconocer la PWA.
2. Abre la app instalada al menos una vez con conexión para activar el receptor de archivos.
3. En Wikiloc, abre una ruta que puedas descargar legítimamente y exporta su **archivo GPX o TCX**. Comparte el archivo y elige **FBikeTrain** en la hoja de Android. Compartir solo el enlace de la ruta no entrega el track. Los nombres y la disponibilidad de exportación dependen de la versión y permisos de Wikiloc; si no ofrece compartir archivo, descárgalo y compártelo desde Archivos/Descargas.
4. En iGPSPORT, abre el detalle de una actividad y busca Exportar/Compartir archivo original **FIT** (o GPX/TCX). Elige FBikeTrain si la versión de la app ofrece enviar el archivo. Una imagen o un enlace de actividad no sirve; si iGPSPORT solo ofrece esos formatos, descarga el original cuando esté disponible y compártelo desde Archivos. La PWA no puede habilitar una exportación que iGPSPORT no ofrezca.
5. Si falta la sesión, entra en FBikeTrain: el envío sigue en la bandeja local mientras se realiza el login, también al volver de Google en la misma pestaña. Revisa los destinos y pulsa **Importar ficheros**. La pantalla muestra el resultado y los accesos a biblioteca e historial.
6. Prueba también tres archivos juntos y vuelve a enviar una actividad: el informe debe contarla como duplicada. No uses datos reales en el repositorio ni en capturas de pruebas.

La instalación y el intercambio desde las apps reales necesitan comprobación en un Android físico. Las pruebas automatizadas usan únicamente archivos sintéticos y no certifican los menús de Wikiloc/iGPSPORT.

## Destino y conservación

- `.fit`: importador de salidas existente, a través del mismo Worker que Importar, con `importFiles` e informe de duplicados.
- `.gpx`: un único track sin tiempos en sus puntos es una referencia; las fechas de metadata no lo convierten en actividad. Si hay horas en los puntos, se trata como actividad. Un único track con autor y enlace a `wikiloc.com` se considera referencia aunque conserve horas.
- `.tcx`: un único `Course` va a la biblioteca; `Activity` va al importador de salidas.
- La biblioteca recibe el `File` original mediante `importReferenceRoute`, sin reescribir XML, autor ni enlaces. Los archivos inválidos o no admitidos muestran un error individual y no impiden procesar los demás.

El SW guarda cada envío multipart bajo un UUID en `fbiketrain-shares-v1`, en la Cache API de este navegador. El envío permanece allí sin sesión; no se sube a ningún servidor. La pantalla autenticada lee y borra la entrada, y conserva los archivos en memoria para confirmar o reintentar la importación. **Si recargas o cierras antes de importar, tendrás que volver a compartirlos.** Un envío completado no vuelve a ofrecerse al regresar a su URL.

Límites de recepción: 20 ficheros y 50 MB en total; clasificación XML hasta 10 MB por fichero. Los envíos abandonados caducan a las 24 horas: se eliminan al leerlos o al recibir otro envío. El navegador puede eliminar almacenamiento local por falta de espacio. Los límites de validación de la biblioteca y del importador siguen aplicándose.

## Implementación y pruebas locales

`public/manifest.webmanifest` usa URLs relativas a su propia ubicación (`./`), de modo que `start_url`, `scope`, iconos y `share_target.action` respetan tanto la raíz de desarrollo como `/FBikeTrain/` en Pages. El SW calcula la misma base desde su URL. No se necesitan reescrituras de servidor para el POST, porque lo intercepta el SW activo.

Los colores proceden de `tokens.css`: fondo/tema oscuro `#14221F`, claro `#F7F4EA`. El manifest usa el oscuro inicial; la barra del navegador sigue el tema elegido mediante el meta `theme-color` y el mecanismo ya existente. Los PNG 192 y 512 se generan desde `public/brand-mark.svg` con `node scripts/generate-pwa-icons.mjs` (Playwright ya instalado), sobre el fondo claro de marca.

`index.html` enlaza el manifest y carga el registro. El registro del SW solo se ejecuta en producción; **`npm run dev` no activa el receptor**. Ejecuta `npm run build` y `npm run preview -- --host 127.0.0.1`, abre la URL local y espera a que `navigator.serviceWorker.ready` se resuelva. En DevTools → Application comprueba manifest, iconos, scope y SW. Para verificar Pages: `$env:BASE_PATH='/FBikeTrain/'; npm run build`; sirve el build bajo esa subruta. HTTPS (o localhost) es obligatorio.

El SW solo intercepta `POST <base>/share-target`. Guarda el multipart, devuelve un 303 a `<base>#/compartido?envio=<uuid>` y no añade precaché, fallback de navegación ni manejadores de GET. La web conserva su actualización por red habitual. Tras cambiar manifest o SW, abre Chrome con conexión y permite que se actualice la instalación.

Pruebas: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npx playwright test`. La suite `e2e/compartido.spec.ts` siembra archivos en Cache API, comprueba el login pendiente, el informe mixto con duplicados, el POST real al SW y genera 18 capturas en `test-results/pwa-compartir/`: 360, 390 y 430 px × claro/oscuro × un archivo/tres/no admitido.

Referencias: [Chrome: Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target), [MDN: share_target y compatibilidad](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target).

## Ficheros del lote

- PWA: `public/manifest.webmanifest`, `public/sw.js`, `public/brand-mark-192.png`, `public/brand-mark-512.png`, `scripts/generate-pwa-icons.mjs`, `src/pwa/register.ts`, `src/pwa/sharedFiles.ts`.
- Integración: `index.html`, `src/App.tsx`, `src/main.tsx`, `src/auth/AccountBoundary.tsx`, `src/ui/shell/screens.ts`.
- Interfaz: `src/ui/pages/Compartido.tsx`, `src/ui/styles/compartido.css`, `src/ui/components/InstallApp.tsx`, `src/ui/pages/Ajustes.tsx`.
- Pruebas: `tests/sharedFiles.test.ts`, `e2e/compartido.spec.ts`.
- Documentación: `docs/pwa-compartir.md`, `docs/ESTADO.md`, `docs/verificaciones.md`.
