import Dexie from 'dexie';
import { CyclingDb, db } from '../src/db/db';
import {
  parseReferenceRoute, analyzeReferenceRoutePoints, importReferenceRoute, listReferenceRoutes,
  getReferenceRoute, saveReferenceRoute, deleteReferenceRoute, trimReferenceRoute,
  reverseReferenceRoute, changeReferenceRouteStart, restoreReferenceRoute,
  replaceReferenceRoutePoints, referenceRouteToGpx, type ReferenceRoute,
} from '../src/routes/library';

const points = [
  { lat: 41, lng: 2.5, ele: 10 },
  { lat: 41.001, lng: 2.5, ele: 30 },
  { lat: 41.001, lng: 2.501, ele: 20 },
  { lat: 41, lng: 2.5, ele: 10 },
];
const trk = (body: string) => `<gpx><trk><name>Ruta &amp; costa</name><trkseg>${body}</trkseg></trk></gpx>`;
const pts = points.map(p => `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele></trkpt>`).join('');
const xml = trk(pts);
function route(): ReferenceRoute {
  return { ...parseReferenceRoute(xml, 'ruta.gpx'), id: 'route-1', createdAt: 1, updatedAt: 1 };
}

describe('biblioteca de rutas de referencia', () => {
  beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())); });
  it('lee GPX sin horas, conserva origen y no inventa duración', () => {
    const parsed = parseReferenceRoute(xml, 'ruta.gpx', 'https://www.wikiloc.com/trail/example');
    expect(parsed.name).toBe('Ruta & costa');
    expect(parsed.points).toEqual(points);
    expect(parsed.originalXml).toBe(xml);
    expect(parsed.sourceUrl).toBe('https://www.wikiloc.com/trail/example');
    expect(parsed.summary).toMatchObject({ elevGainM: 20, elevLossM: 20, closed: true, pointCount: 4 });
    expect(parsed.summary.distanceM).toBeGreaterThan(200);
    expect(parsed.summary).not.toHaveProperty('movingTimeS');
  });
  it('rechaza GPX de waypoints y lee TCX Course sin marcas de tiempo', () => {
    const rte = `<gpx><rte><name>Plan</name>${points.slice(0, 2).map(p => `<rtept lat="${p.lat}" lon="${p.lng}"/>`).join('')}</rte></gpx>`;
    expect(() => parseReferenceRoute(rte, 'plan.gpx')).toThrow(/waypoints.*track detallado/i);
    const tcx = `<TrainingCenterDatabase><Courses><Course><Name>Curso</Name><Track>${points.slice(0, 2).map(p => `<Trackpoint><Position><LatitudeDegrees>${p.lat}</LatitudeDegrees><LongitudeDegrees>${p.lng}</LongitudeDegrees></Position></Trackpoint>`).join('')}</Track></Course></Courses></TrainingCenterDatabase>`;
    expect(parseReferenceRoute(tcx, 'curso.tcx')).toMatchObject({ name: 'Curso', format: 'tcx' });
  });
  it('el desnivel es desconocido si falta alguna altura', () => {
    const summary = analyzeReferenceRoutePoints([{ lat: 41, lng: 2.5, ele: 10 }, { lat: 41.001, lng: 2.5 }]);
    expect(summary.elevGainM).toBeNull(); expect(summary.elevLossM).toBeNull();
  });
  it.each([
    ['vacío', ''],
    ['coordenadas inválidas', trk('<trkpt lat="91" lon="2"/><trkpt lat="41" lon="2.5"/>')],
    ['sin latitud', trk('<trkpt lon="2.5"/><trkpt lat="41" lon="2.5"/>')],
    ['multisegmento', '<gpx><trk><trkseg>'+pts+'</trkseg><trkseg>'+pts+'</trkseg></trk></gpx>'],
    ['múltiples rutas', '<gpx><rte><rtept lat="41" lon="2.5"/><rtept lat="41.001" lon="2.5"/></rte><rte><rtept lat="41" lon="2.5"/><rtept lat="41.001" lon="2.5"/></rte></gpx>'],
    ['salto espacial', trk('<trkpt lat="41" lon="2.5"/><trkpt lat="42" lon="2.5"/>')],
    ['sin extensión compatible', '<fit/>'],
  ])('rechaza %s explícitamente', (_label, input) => {
    expect(() => parseReferenceRoute(input, 'route.gpx')).toThrow();
  });
  it('rechaza DOCTYPE, enlaces peligrosos y una geometría inmóvil', () => {
    expect(() => parseReferenceRoute('<!DOCTYPE gpx [<!ENTITY x "secret">]>'+xml, 'route.gpx')).toThrow();
    expect(() => parseReferenceRoute(xml, 'route.gpx', 'javascript:alert(1)')).toThrow();
    expect(() => analyzeReferenceRoutePoints([{ lat: 41, lng: 2.5 }, { lat: 41, lng: 2.5 }])).toThrow();
    expect(() => analyzeReferenceRoutePoints([{ lat: 41, lng: 2.5, ele: 1e308 }, { lat: 41.001, lng: 2.5, ele: -1e308 }])).toThrow();
  });
  it('impone límites de tamaño y número de puntos antes de guardar', async () => {
    const file = { name: 'huge.gpx', size: 10 * 1024 * 1024 + 1, text: vi.fn() } as unknown as File;
    await expect(importReferenceRoute(file)).rejects.toThrow();
    expect(file.text).not.toHaveBeenCalled();
    expect(() => analyzeReferenceRoutePoints(Array.from({ length: 50_001 }, () => ({ lat: 41, lng: 2.5 })))).toThrow();
    expect(await listReferenceRoutes()).toEqual([]);
  });
  it('importa en tabla independiente sin crear actividades ni tracks del historial', async () => {
    const file = new File([xml], 'ruta.gpx');
    const imported = await importReferenceRoute(file);
    expect((await listReferenceRoutes()).map(r => r.id)).toEqual([imported.id]);
    expect(await getReferenceRoute(imported.id)).toEqual(imported);
    expect(await db.activities.count()).toBe(0); expect(await db.tracks.count()).toBe(0);
    await deleteReferenceRoute(imported.id);
    expect(await getReferenceRoute(imported.id)).toBeUndefined();
  });
  it('recorta e invierte conservando original y recalculando cifras', () => {
    const original = route();
    const trimmed = trimReferenceRoute(original, 0, 1);
    expect(trimmed.points).toEqual(points.slice(0, 2));
    expect(trimmed.summary.distanceM).toBeLessThan(original.summary.distanceM);
    const reversed = reverseReferenceRoute(trimmed);
    expect(reversed.points).toEqual(points.slice(0, 2).reverse());
    expect(reversed.summary.elevGainM).toBe(0); expect(reversed.summary.elevLossM).toBe(20);
    expect(original.points).toEqual(points);
    expect(reversed.originalPoints).toEqual(points);
    expect(restoreReferenceRoute(reversed).points).toEqual(points);
  });
  it('cambia el inicio circular sin saltos y no cierra rutas abiertas automáticamente', () => {
    const shifted = changeReferenceRouteStart(route(), 1);
    expect(shifted.points).toEqual([points[1], points[2], points[0], points[1]]);
    expect(shifted.summary.distanceM).toBeCloseTo(route().summary.distanceM);
    expect(() => changeReferenceRouteStart(trimReferenceRoute(route(), 0, 2), 1)).toThrow();
    expect(() => trimReferenceRoute(route(), 2, 1)).toThrow();
    expect(() => trimReferenceRoute(route(), 1.5, 2)).toThrow();
  });
  it('permite sustituir geometría validada sin perder original y rechaza saltos nuevos', () => {
    const changed = replaceReferenceRoutePoints(route(), points.slice(0, 2));
    expect(changed.originalXml).toBe(xml); expect(changed.summary.pointCount).toBe(2);
    expect(() => replaceReferenceRoutePoints(route(), [{ lat: 41, lng: 2.5 }, { lat: 42, lng: 2.5 }])).toThrow();
  });
  it('guarda ediciones y exporta GPX sin tiempos ni altitudes inventadas', async () => {
    const item = route();
    await saveReferenceRoute(item);
    await saveReferenceRoute({ ...trimReferenceRoute(item, 0, 1), originalXml: 'changed', originalPoints: points.slice(0, 2) });
    expect((await getReferenceRoute(item.id))?.originalXml).toBe(xml);
    expect((await getReferenceRoute(item.id))?.originalPoints).toEqual(points);
    await saveReferenceRoute(item);
    expect((await getReferenceRoute(item.id))?.points).toEqual(points);
    const withoutElevation = replaceReferenceRoutePoints(item, points.map(({ lat, lng }) => ({ lat, lng })));
    const exported = referenceRouteToGpx({ ...withoutElevation, name: '<Ruta & prueba>' });
    expect(exported).toContain('&lt;Ruta &amp; prueba&gt;');
    expect(exported).not.toContain('<time>'); expect(exported).not.toContain('<ele>');
    expect(parseReferenceRoute(exported, 'result.gpx').points).toEqual(withoutElevation.points);
    const tinyCoordinates = replaceReferenceRoutePoints(item, [{ lat: 0.0000001, lng: 2.5 }, { lat: 0.001, lng: 2.5 }]);
    expect(referenceRouteToGpx(tinyCoordinates)).toContain('lat="0.0000001"');
  });
  it('la versión nueva conserva datos de una base v3', async () => {
    const name = 'test-route-library-upgrade';
    const old = new Dexie(name);
    old.version(3).stores({ activities:'id,startTime', tracks:'activityId', settings:'key', meta:'key', climbEfforts:'id,activityId', routeSigs:'activityId,distanceM', calendar:'id,date', goals:'id,kind' });
    await old.table('meta').put({ key: 'keep', value: 42 }); old.close();
    const upgraded = new CyclingDb(name);
    try {
      expect((await upgraded.meta.get('keep'))?.value).toBe(42);
      expect(await upgraded.referenceRoutes.count()).toBe(0);
    } finally { await upgraded.delete(); }
  });
});
