import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { Encoder, Profile, type FileIdMesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import { db } from '../src/db/db';
import { getMeta, getTrack, listActivities } from '../src/db/repo';
import { parseGpx } from '../src/import/gpx';
import { importFiles, type ImportPhase } from '../src/import/importService';
import { MIN_RIDE_DISTANCE_M } from '../src/import/summary';
import type { TrackPoint } from '../src/domain/types';
import { routeGpx } from './fixtures/stravaRoutes';

// El Blob de jsdom no trae arrayBuffer(); el del navegador y el del Worker, sí.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

const rideGpx = readFileSync('tests/fixtures/ride.gpx', 'utf8');
const fixture = (name: string) => new File([new Uint8Array(readFileSync(`tests/fixtures/${name}`))], name);
const gpxFile = (name = 'ride.gpx', xml = rideGpx) => new File([xml], name);

const START = Date.parse('2026-01-04T08:00:00Z');

/** FIT sintético en memoria, en el mar frente a la costa (lat 41.0, lng 2.5): 5 registros cada 30 s, 120 s. */
function encodeFit(opts: { startOffsetS?: number; totalDistance: number; sport?: string; gps?: boolean }): Uint8Array<ArrayBuffer> {
  const t0 = START + (opts.startOffsetS ?? 0) * 1000;
  const at = (s: number) => new Date(t0 + s * 1000);
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: at(0) } as FileIdMesg);
  for (let i = 0; i < 5; i++) {
    const gps = opts.gps === false ? {} : { positionLat: Math.round(((41 + i * 0.0009) * 2 ** 31) / 180), positionLong: Math.round((2.5 * 2 ** 31) / 180) };
    enc.onMesg(Profile.MesgNum.RECORD, { timestamp: at(i * 30), distance: i * 300, speed: 10, ...gps } as RecordMesg);
  }
  enc.onMesg(Profile.MesgNum.SESSION, {
    timestamp: at(120), startTime: at(0), sport: opts.sport ?? 'cycling', totalDistance: opts.totalDistance, totalTimerTime: 120, totalElapsedTime: 120,
  } as SessionMesg);
  return new Uint8Array(enc.close());
}

async function stravaZip(files: Record<string, string | Uint8Array>): Promise<File> {
  const zip = new JSZip();
  const rows = Object.keys(files).map((f, i) => `${i + 1},Salida ${i + 1},Ride,${f}`);
  zip.file('activities.csv', ['Activity ID,Activity Name,Activity Type,Filename', ...rows].join('\n'));
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return new File([await zip.generateAsync({ type: 'blob' })], 'export_123.zip');
}

/** Distancia entre dos puntos (m), independiente de la del código bajo prueba. */
function metres(a: TrackPoint, b: TrackPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat! - a.lat!) * rad;
  const dLng = (b.lng! - a.lng!) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat! * rad) * Math.cos(b.lat! * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

describe('importFiles', () => {
  beforeEach(async () => {
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.meta.clear()]);
  });

  it('imports gpx and stores activity and track', async () => {
    const report = await importFiles([gpxFile()]);
    expect(report).toEqual({ added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 1, routesAdded: 0 });

    const [a] = await listActivities();
    expect(a).toMatchObject({ sport: 'cycling', source: 'gpx', name: 'Salida sintetica', startTime: START, hasTrack: true });
    expect(a.totals.distanceM).toBeGreaterThan(1900);
    const track = await getTrack(a.id);
    expect(track).toHaveLength(20);
    expect(track![0]).toMatchObject({ lat: 41, lng: 2.5 });
  });

  it('dedupes same ride from archive and loose fit', async () => {
    const gpxDistance = parseGpx(rideGpx).totals.distanceM;
    const archive = await stravaZip({ 'activities/1.gpx': rideGpx });
    const looseFit = new File([encodeFit({ startOffsetS: 30, totalDistance: gpxDistance * 1.01 })], 'ride.fit');

    const report = await importFiles([archive, looseFit]);
    expect(report).toMatchObject({ added: 1, duplicates: 1, skipped: [] });
    expect(await listActivities()).toHaveLength(1);
  });

  it('imports the whole archive at once and counts the rest as not cycling', async () => {
    const zip = new JSZip();
    zip.file(
      'activities.csv',
      [
        'Activity ID,Activity Name,Activity Type,Filename',
        '1,"Cabo, faro y ""vuelta""",Bicicleta,activities/1.gpx',
        '2,Trote,Carrera,activities/2.gpx',
        '3,Paseo,Caminata,activities/3.gpx',
      ].join('\n'),
    );
    zip.file('activities/1.gpx', rideGpx);
    zip.file('activities/2.gpx', rideGpx);
    zip.file('activities/3.gpx', rideGpx);
    // Windows etiqueta los ZIP como application/x-zip-compressed.
    const file = new File([await zip.generateAsync({ type: 'blob' })], 'export_123.zip', { type: 'application/x-zip-compressed' });

    expect(await importFiles([file])).toEqual({ added: 1, duplicates: 0, notCycling: 2, tooShort: 0, skipped: [], noGps: [], withCadence: 1, routesAdded: 0 });
    const [a] = await listActivities();
    expect(a.name).toBe('Cabo, faro y "vuelta"');
  });

  it('imports an unzipped archive folder by relative path', async () => {
    const csv = ['Activity ID,Activity Name,Activity Type,Filename', '1,Salida,Ride,activities/1.gpx', '2,Trote,Run,activities/2.gpx'].join('\n');
    const inFolder = (path: string, data: string) => ({ path: `export_123/${path}`, file: new File([data], path.split('/').pop()!) });
    const report = await importFiles([
      inFolder('activities.csv', csv),
      inFolder('activities/1.gpx', rideGpx),
      inFolder('activities/2.gpx', rideGpx),
      inFolder('profile.jpg', 'jpg'),
      inFolder('bikes.csv', 'a,b'),
    ]);
    expect(report).toEqual({ added: 1, duplicates: 0, notCycling: 1, tooShort: 0, skipped: [], noGps: [], withCadence: 1, routesAdded: 0 });
    expect((await listActivities())[0]).toMatchObject({ name: 'Salida', source: 'strava-archive' });
  });

  it('folder without activities.csv imports its files one by one', async () => {
    const report = await importFiles([
      { path: 'activities/1.gpx', file: gpxFile('1.gpx') },
      { path: 'activities/2.fit', file: new File([encodeFit({ totalDistance: 5000, sport: 'running', startOffsetS: 7200 })], '2.fit') },
    ]);
    expect(report).toEqual({ added: 1, duplicates: 0, notCycling: 1, tooShort: 0, skipped: [], noGps: [], withCadence: 1, routesAdded: 0 });
  });

  it('same ride imported again in another call is a duplicate', async () => {
    await importFiles([gpxFile()]);
    expect(await importFiles([gpxFile()])).toEqual({ added: 0, duplicates: 1, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0, routesAdded: 0 });
  });

  it('different ride starting at the same time is not a duplicate', async () => {
    await importFiles([gpxFile()]);
    const other = new File([encodeFit({ totalDistance: 30_000 })], 'otra.fit');
    expect(await importFiles([other])).toMatchObject({ added: 1, duplicates: 0 });
  });

  it('corrupt file is reported and others import', async () => {
    const report = await importFiles([fixture('corrupt.fit'), gpxFile()]);
    expect(report.added).toBe(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].file).toBe('corrupt.fit');
    expect(report.skipped[0].reason).not.toBe('');
  });

  it('unknown extension reported as "formato no soportado"', async () => {
    const report = await importFiles([new File(['hola'], 'notas.txt')]);
    expect(report).toEqual({ added: 0, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [{ file: 'notas.txt', reason: 'formato no soportado' }], noGps: [], withCadence: 0, routesAdded: 0 });
  });

  it('non-cycling loose file is counted, not reported as an error', async () => {
    const run = new File([encodeFit({ totalDistance: 5000, sport: 'running' })], 'carrera.fit');
    const report = await importFiles([run]);
    expect(report).toEqual({ added: 0, duplicates: 0, notCycling: 1, tooShort: 0, skipped: [], noGps: [], withCadence: 0, routesAdded: 0 });
  });

  it('ride under the minimum distance or moving time is discarded as too short, not as an error', async () => {
    // Como la del archivo real: 2 s y 0 km.
    const blip = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="41.000000" lon="2.500000"><time>2026-03-01T08:00:00Z</time></trkpt>
      <trkpt lat="41.000000" lon="2.500000"><time>2026-03-01T08:00:02Z</time></trkpt></trkseg></trk></gpx>`;
    const report = await importFiles([gpxFile('blip.gpx', blip), gpxFile()]);
    expect(report).toEqual({ added: 1, duplicates: 0, notCycling: 0, tooShort: 1, skipped: [], noGps: [], withCadence: 1, routesAdded: 0 });
    expect(await listActivities()).toHaveLength(1);
  });

  it('too short ride inside a Strava archive is counted as too short', async () => {
    const blip = new File([encodeFit({ totalDistance: MIN_RIDE_DISTANCE_M - 1, startOffsetS: 7200 })], 'x');
    const archive = await stravaZip({ 'activities/1.fit': new Uint8Array(await blip.arrayBuffer()) });
    expect(await importFiles([archive])).toEqual({ added: 0, duplicates: 0, notCycling: 0, tooShort: 1, skipped: [], noGps: [], withCadence: 0, routesAdded: 0 });
  });

  it('ride without gps counts but has no track', async () => {
    const indoor = new File([encodeFit({ totalDistance: 20_000, gps: false })], 'rodillo.fit');
    expect(await importFiles([indoor])).toMatchObject({ added: 1 });
    const [a] = await listActivities();
    expect(a.hasTrack).toBe(false);
    expect(a.totals.distanceM).toBe(20_000);
    expect(await getTrack(a.id)).toBeUndefined();
  });

  it('reads gzipped loose files', async () => {
    const { gzipSync } = await import('fflate');
    const gz = new File([gzipSync(new TextEncoder().encode(rideGpx))], 'ride.gpx.gz');
    expect(await importFiles([gz])).toMatchObject({ added: 1 });
  });

  it('downsamples track to >=15 m spacing', async () => {
    // 80 puntos a ~5 m uno de otro (0,000045° de latitud), uno por segundo: ~395 m en 79 s.
    const pts = Array.from({ length: 80 }, (_, i) => {
      const time = new Date(START + i * 1000).toISOString();
      return `<trkpt lat="${(41 + i * 0.000045).toFixed(6)}" lon="2.500000"><ele>0</ele><time>${time}</time></trkpt>`;
    });
    const dense = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
    await importFiles([gpxFile('denso.gpx', dense)]);

    const [a] = await listActivities();
    const track = (await getTrack(a.id))!;
    expect(track.length).toBeLessThan(80);
    expect(track[0].lat).toBe(41);
    expect(track.at(-1)!.lat).toBeCloseTo(41 + 79 * 0.000045, 6);
    for (let i = 1; i < track.length - 1; i++) expect(metres(track[i - 1], track[i])).toBeGreaterThanOrEqual(15);
  });

  it('reports progress per file and per archive activity', async () => {
    const archive = await stravaZip({ 'activities/1.gpx': rideGpx, 'activities/2.fit': encodeFit({ startOffsetS: 3600, totalDistance: 9000 }) });
    const calls: [number, number, ImportPhase][] = [];
    await importFiles([gpxFile('suelto.gpx', rideGpx.replace(/2026-01-04/g, '2026-02-01')), archive], (done, total, phase) =>
      calls.push([done, total, phase]),
    );
    expect(calls).toEqual([[1, 2, 'activities'], [1, 2, 'open'], [2, 3, 'activities'], [3, 3, 'activities'], [3, 3, 'finish']]);
  });

  it('progress reports phases in order', async () => {
    const archive = await stravaZip({ 'activities/1.gpx': rideGpx, 'activities/2.fit': encodeFit({ startOffsetS: 3600, totalDistance: 9000 }) });
    const phases: ImportPhase[] = [];
    await importFiles([archive], (_d, _t, phase) => phases.push(phase));
    expect(phases[0]).toBe('open');
    expect(phases[1]).toBe('activities');
    expect(phases.at(-1)).toBe('finish');
    expect(phases.filter((p) => p === 'finish')).toHaveLength(1);

    const loosePhases: ImportPhase[] = [];
    await importFiles([gpxFile('otra.gpx', rideGpx.replace(/2026-01-04/g, '2026-03-01'))], (_d, _t, phase) => loosePhases.push(phase));
    expect(loosePhases).toEqual(['activities', 'finish']);
  });

  it('report lists rides without gps', async () => {
    // Rodillo sintético: puntos con tiempo y distancia, sin <Position>.
    const iso = (s: number) => new Date(START + s * 1000).toISOString();
    const pts = [0, 150, 300, 450, 600]
      .map((s, i) => `<Trackpoint><Time>${iso(s)}</Time><DistanceMeters>${i * 1250}</DistanceMeters></Trackpoint>`)
      .join('');
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities>
      <Activity Sport="Biking"><Id>${iso(0)}</Id><Lap StartTime="${iso(0)}"><TotalTimeSeconds>600</TotalTimeSeconds>
      <DistanceMeters>5000</DistanceMeters><Track>${pts}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const report = await importFiles([new File([tcx], 'indoor.tcx')]);
    expect(report.added).toBe(1);
    expect(report.noGps).toEqual([{ file: 'indoor.tcx', startTime: START }]);
  });

  it('archive ride without gps is listed with its path', async () => {
    const archive = await stravaZip({ 'activities/7.fit': encodeFit({ totalDistance: 20_000, gps: false }) });
    const report = await importFiles([archive]);
    expect(report.added).toBe(1);
    expect(report.noGps).toEqual([{ file: 'activities/7.fit', startTime: START }]);
  });

  it('withCadence counts added rides with cadence', async () => {
    expect((await importFiles([gpxFile()])).withCadence).toBe(1);
    const noCadence = new File([encodeFit({ totalDistance: 30_000, startOffsetS: 7200 })], 'sin-cadencia.fit');
    expect((await importFiles([noCadence])).withCadence).toBe(0);
  });

  it('updates lastImportAt', async () => {
    expect(await getMeta()).toEqual({});
    const before = Date.now();
    await importFiles([gpxFile()]);
    const { lastImportAt } = await getMeta();
    expect(lastImportAt).toBeGreaterThanOrEqual(before);
    expect(lastImportAt).toBeLessThanOrEqual(Date.now());
  });

  it('listActivities filters by range, both ends included', async () => {
    await importFiles([gpxFile()]);
    expect(await listActivities({ from: START, to: START })).toHaveLength(1);
    expect(await listActivities({ from: START + 1, to: START + 10_000 })).toHaveLength(0);
  });
});

describe('importFiles: rutas de Strava (routes/)', () => {
  /** Exportación con una salida en bici y las rutas indicadas, que no van en activities.csv. */
  async function exportZip(routes: Record<string, string>, name = 'export_1.zip'): Promise<File> {
    const zip = new JSZip();
    zip.file('export_1/activities.csv', 'Activity ID,Activity Name,Activity Type,Filename\n1,Salida,Ride,activities/1.gpx');
    zip.file('export_1/activities/1.gpx', rideGpx);
    for (const [path, data] of Object.entries(routes)) zip.file(`export_1/${path}`, data);
    return new File([await zip.generateAsync({ type: 'blob' })], name);
  }
  const stravaRoutes = async () => (await db.referenceRoutes.toArray()).filter((r) => r.origin?.kind === 'strava');

  beforeEach(async () => {
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.meta.clear(), db.referenceRoutes.clear()]);
  });

  it('guarda las rutas en la biblioteca con origen Strava y las cuenta', async () => {
    const report = await importFiles([await exportZip({ 'routes/1.gpx': routeGpx('Cabo'), 'routes/2.gpx': routeGpx('Faro', { offset: 0.1 }) })]);
    expect(report).toMatchObject({ added: 1, routesAdded: 2, skipped: [] });
    expect((await stravaRoutes()).map((r) => r.name).sort()).toEqual(['Cabo', 'Faro']);
  });

  it('no duplica rutas al reimportar, aunque vengan renumeradas', async () => {
    await importFiles([await exportZip({ 'routes/1.gpx': routeGpx('Cabo'), 'routes/2.gpx': routeGpx('Faro', { offset: 0.1 }) })]);
    const again = await importFiles([await exportZip({ 'routes/1.gpx': routeGpx('Cabo'), 'routes/2.gpx': routeGpx('Faro', { offset: 0.1 }) })]);
    const renumbered = await importFiles([await exportZip({ 'routes/1.gpx': routeGpx('Faro', { offset: 0.1 }), 'routes/2.gpx': routeGpx('Cabo') })]);
    expect(again.routesAdded).toBe(0);
    expect(renumbered.routesAdded).toBe(0);
    expect(await stravaRoutes()).toHaveLength(2);
  });

  it('una ruta repetida dentro de la misma exportación se guarda una vez', async () => {
    const report = await importFiles([await exportZip({ 'routes/1.gpx': routeGpx('Cabo'), 'routes/2.gpx': routeGpx('Cabo copia') })]);
    expect(report.routesAdded).toBe(1);
  });

  it('lee las rutas de una carpeta descomprimida', async () => {
    const inFolder = (path: string, data: string) => ({ path: `export_1/${path}`, file: new File([data], path.split('/').pop()!) });
    const report = await importFiles([
      inFolder('activities.csv', 'Activity ID,Activity Name,Activity Type,Filename\n1,Salida,Ride,activities/1.gpx'),
      inFolder('activities/1.gpx', rideGpx),
      inFolder('routes/1.gpx', routeGpx('Cabo')),
    ]);
    expect(report).toMatchObject({ added: 1, routesAdded: 1 });
  });

  it('una ruta corrupta se anota y no impide guardar la salida ni las demás rutas', async () => {
    const report = await importFiles([await exportZip({ 'routes/1.gpx': routeGpx('Cabo'), 'routes/3.gpx': '<gpx><trk>' })]);
    expect(report.added).toBe(1);
    expect(report.routesAdded).toBe(1);
    expect(report.skipped).toEqual([{ file: 'export_1/routes/3.gpx', reason: expect.any(String) }]);
  });

  it('importa cientos de rutas', async () => {
    const routes = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`routes/${i + 1}.gpx`, routeGpx(`Ruta ${i + 1} 🚴`, { offset: i * 0.01 })]));
    const report = await importFiles([await exportZip(routes)]);
    expect(report.routesAdded).toBe(300);
    expect(await stravaRoutes()).toHaveLength(300);
  }, 60_000);

  it('una exportación sin routes/ deja el informe de siempre y la biblioteca igual', async () => {
    const report = await importFiles([await exportZip({})]);
    expect(report).toEqual({ added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 1, routesAdded: 0 });
    expect(await db.referenceRoutes.count()).toBe(0);
  });
});

describe('import worker', () => {
  it('posts progress and done', async () => {
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.meta.clear()]);
    const posted: unknown[] = [];
    const spy = vi.spyOn(self, 'postMessage').mockImplementation((msg: unknown) => void posted.push(msg));
    await import('../src/import/import.worker');

    self.dispatchEvent(new MessageEvent('message', { data: { files: [gpxFile()] } }));
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ type: 'done' }));

    expect(posted).toEqual([
      { type: 'progress', done: 1, total: 1, phase: 'activities' },
      { type: 'progress', done: 1, total: 1, phase: 'finish' },
      { type: 'done', report: { added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 1, routesAdded: 0 } },
    ]);
    spy.mockRestore();
  });

  it('posts error when importFiles throws', async () => {
    await Promise.all([db.activities.clear(), db.tracks.clear(), db.meta.clear()]);
    const posted: unknown[] = [];
    const spy = vi.spyOn(self, 'postMessage').mockImplementation((msg: unknown) => void posted.push(msg));
    const put = vi.spyOn(db.meta, 'put').mockRejectedValue(new Error('IndexedDB lleno'));
    await import('../src/import/import.worker');

    self.dispatchEvent(new MessageEvent('message', { data: { files: [gpxFile()] } }));
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ type: 'error', message: 'IndexedDB lleno' }));

    put.mockRestore();
    spy.mockRestore();
  });
});
