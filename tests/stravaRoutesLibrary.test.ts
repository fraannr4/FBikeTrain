import { db } from '../src/db/db';
import { clipRouteName, parseReferenceRoute, saveStravaRoute, stravaRouteRefs } from '../src/routes/library';

// Ruta sintética en el mar frente a la costa (lat 41.0, lng 2.5).
const gpx = (name: string) =>
  `<gpx><trk><name>${name}</name><trkseg>` +
  '<trkpt lat="41" lon="2.5"><ele>0</ele></trkpt><trkpt lat="41.001" lon="2.5"><ele>0</ele></trkpt>' +
  '</trkseg></trk></gpx>';

/** UTF-16 bien formado: un sustituto suelto hace lanzar a encodeURIComponent. */
const wellFormed = (s: string) => {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
};

describe('clipRouteName', () => {
  it('no parte un emoji al recortar a 120 unidades', () => {
    const name = clipRouteName('a'.repeat(119) + '😀');
    expect(name).toBe('a'.repeat(119));
    expect(wellFormed(name)).toBe(true);
  });

  it('recorta un nombre largo a 120 caracteres', () => {
    expect(clipRouteName('b'.repeat(200))).toHaveLength(120);
  });

  it('parseReferenceRoute recorta un nombre de emojis sin dejar sustitutos sueltos', () => {
    // La «x» desplaza los pares sustitutos para que el corte en 120 caiga en medio de un emoji.
    const { name } = parseReferenceRoute(gpx('x' + '🚴'.repeat(130)), '1.gpx');
    expect(name.length).toBeLessThanOrEqual(120);
    expect(wellFormed(name)).toBe(true);
  });
});

describe('rutas de Strava en la biblioteca', () => {
  beforeEach(async () => {
    await db.referenceRoutes.clear();
  });

  it('guarda la ruta con su origen Strava', async () => {
    const saved = await saveStravaRoute(parseReferenceRoute(gpx('Vuelta al cabo'), '1.gpx'), 'ref-1');
    const stored = await db.referenceRoutes.get(saved.id);
    expect(stored?.origin).toEqual({ kind: 'strava', ref: 'ref-1' });
    expect(stored?.name).toBe('Vuelta al cabo');
  });

  it('stravaRouteRefs devuelve solo las huellas de las rutas de Strava', async () => {
    await saveStravaRoute(parseReferenceRoute(gpx('Strava'), '1.gpx'), 'ref-1');
    const now = Date.now();
    await db.referenceRoutes.add({ ...parseReferenceRoute(gpx('Propia'), 'propia.gpx'), id: 'otra', createdAt: now, updatedAt: now });
    expect(await stravaRouteRefs()).toEqual(new Set(['ref-1']));
  });
});
