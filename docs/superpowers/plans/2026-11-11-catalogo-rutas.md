# Catálogo de rutas y Wikiloc sin marcador (2026-11-11, noche)

Sustituye «Rutas de Wikiloc cerca» y el marcador «→ FBikeTrain». Decisión del usuario en el traspaso
(«DECISIÓN 2026-11-11 noche: rehacer Wikiloc»). Nunca se accede a wikiloc.com desde la app ni desde el servidor.

## Objetivo

1. **Catálogo** en la biblioteca de la cuenta (IndexedDB por cuenta; nunca en el repositorio):
   - importación por lotes: varios GPX/TCX o un ZIP en una sola acción;
   - precarga desde la app de rutas reales de OpenStreetMap: relaciones `route=bicycle` y `route=mtb`
     que pasan a menos de 15 km del inicio, y subidas a los puertos cercanos (circuito por ORS);
     unas 100 como máximo, con atribución «© OpenStreetMap contributors».
2. **Recomendar**: ordena el catálogo por los km y el desnivel pedidos (`rankForTarget`, sin nivel),
   adapta con `adaptRoute` (sale y vuelve a casa) y enseña 3 propuestas para guardar o enviar al iGPSPORT.
3. **Wikiloc**: botón «Buscar en Wikiloc» con los filtros puestos (zona, bici de carretera, km) y
   «Subir el GPX descargado», que se adapta y se guarda o envía sin otra descarga.
4. **Quitar** el marcador (`src/bookmarklet`, `public/wikiloc-marcador.html`, `build:bookmarklet`),
   las pantallas `#/rutas/wikiloc/recibir` y `#/rutas/wikiloc/adaptar` y el asesor de IA de la lista.
   Se conservan `adaptRoute`, `rankForTarget` y la vista de la ruta adaptada.

## Decisiones técnicas

- **Overpass directo desde el navegador** (CORS abierto). El centro se redondea a 0,01° (~1 km) y no
  se envía nada más. Sin cambios en Edge Functions ni migraciones.
  - Consulta: `rel(around:15000,lat,lng)[type=route][route~"^(bicycle|mtb)$"]; out geom;`.
  - Los tramos se encadenan en una sola línea, uniendo extremos a menos de 300 m. Si no se puede, se
    queda el tramo continuo más largo.
  - Las relaciones de más de 150 km se recortan al tramo a menos de 25 km del inicio.
  - Se descarta lo que quede por debajo de 5 km.
- **Puertos**: `buildPassQuery` y `parsePasses` (ya existen) contra Overpass. Para los 5 más cercanos,
  un circuito ORS inicio → vertiente de subida → puerto → vertiente de bajada → inicio, que trae
  elevación. Se usan 5 consultas ORS como máximo.
- **Desnivel de OSM**: OSM no trae altitud.
  - Se toman muestras cada ~150 m del modelo de terreno de Open-Meteo (`/v1/elevation`, 100 puntos
    por petición, sin clave).
  - La altitud de cada punto se interpola por distancia y la ruta se marca `elevation: 'dem'`.
  - La interfaz la presenta como «desnivel estimado».
  - Si Open-Meteo falla, la ruta se guarda sin desnivel.
- `ReferenceRoute` gana `catalog?: { kind: 'osm' | 'puerto'; ref: string; tipo: 'carretera' | 'btt' | 'puerto' }`
  y `elevation?: 'dem'`. Volver a cargar sustituye lo de OSM por `ref`, sin duplicar. No cambia el
  índice de Dexie.
- **Recomendación**: `rankForTarget` pasa a ser genérico (`{ id, km, desnivelM }`). Se adaptan los
  candidatos de uno en uno hasta tener 3 válidos, con 8 intentos como máximo. Las rutas que ya pasan
  por casa no gastan ORS.
  - Con el ORS compartido (8/min) un `rate_minute` no es un error: se espera 60 s y se sigue,
    avisándolo en pantalla.
- **Pantalla nueva** `#/rutas/catalogo`. `#/rutas/wikiloc*` redirige allí.

## Tareas

1. `src/routes/catalog/osm.ts` (consulta, encadenado, recorte, DEM) y `passes`, con pruebas de fixtures sintéticos.
2. `importReferenceRoutes(files)` con ZIP (jszip) y límites (200 ficheros, 10 MB cada uno, 50 MB el ZIP); input múltiple en Biblioteca.
3. `src/routes/catalog/recommend.ts` (rank genérico + adaptación secuencial con espera por límite).
4. Página `Catalogo.tsx`: estado del catálogo, precarga, importación, petición, 3 propuestas, Wikiloc (botón + subir GPX).
5. Retirar el marcador, las páginas y las pruebas antiguas; actualizar `Rutas.tsx`, `App.tsx`, `package.json` y la documentación.
6. Verificar: vitest, tsc, build, e2e de Playwright a 360 y 430 px con Overpass, Open-Meteo y ORS simulados.

## Pendiente del usuario

- Pegar la URL de Wikiloc con sus filtros. Hasta entonces se usa el mapa actual: rectángulo alrededor del inicio y `act=29`.
- Probar la precarga real desde su cuenta: Overpass, Open-Meteo y ORS reales.
