import { db } from '../src/db/db';
import { getReferenceRoute, parseReferenceRoute, restoreReferenceRoute, saveAdaptedRoute } from '../src/routes/library';

// GPX sintético en el mar: el de Wikiloc va de sur a norte; la versión adaptada añade un tramo al este.
const GPX = '<gpx version="1.1"><trk><name>Vuelta sintética</name><trkseg><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt><trkpt lat="41.01" lon="2.5"><ele>20</ele></trkpt></trkseg></trk></gpx>';
const ADAPTED = [
  { lat: 41, lng: 2.5, ele: 10 },
  { lat: 41.01, lng: 2.5, ele: 20 },
  { lat: 41.01, lng: 2.51, ele: 25 },
];

beforeEach(async () => {
  await db.referenceRoutes.clear();
});

it('guarda la ruta adaptada con su autor y su enlace, y conserva el GPX de Wikiloc como original', async () => {
  const original = parseReferenceRoute(GPX, 'wikiloc-1001.gpx');
  const saved = await saveAdaptedRoute(original, ADAPTED, {
    name: 'Vuelta sintética adaptada', sourceUrl: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-1001', author: 'Autor de prueba',
  });
  const stored = await getReferenceRoute(saved.id);
  expect(stored).toMatchObject({
    name: 'Vuelta sintética adaptada', sourceUrl: 'https://es.wikiloc.com/rutas-ciclismo/vuelta-sintetica-1001', author: 'Autor de prueba',
    sourceFileName: 'wikiloc-1001.gpx', originalXml: GPX, points: ADAPTED,
  });
  expect(stored!.summary.pointCount).toBe(3);
  // «Volver al trazado original» en la biblioteca devuelve la ruta tal como llegó de Wikiloc.
  expect(restoreReferenceRoute(stored!).points).toEqual(original.points);
});

it('sin autor no inventa uno y rechaza un enlace que no es de Wikiloc', async () => {
  const original = parseReferenceRoute(GPX, 'wikiloc-1001.gpx');
  const saved = await saveAdaptedRoute(original, ADAPTED, { name: 'Vuelta', sourceUrl: 'https://es.wikiloc.com/x-1001', author: null });
  expect(saved.author).toBeUndefined();
  await expect(saveAdaptedRoute(original, ADAPTED, { name: 'Vuelta', sourceUrl: 'https://wikiloc.com.evil.io/x', author: null })).rejects.toThrow();
});
