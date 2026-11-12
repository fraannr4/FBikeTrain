import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { gzipSync } from 'fflate';
import { ParseError } from '../src/domain/types';
import { readArchiveEntries, readStravaArchive, zipEntries, type ArchiveItem } from '../src/import/stravaArchive';

const gpx = readFileSync('tests/fixtures/ride.gpx', 'utf8');
const fit = new Uint8Array(readFileSync('tests/fixtures/ride.fit'));

// Cabecera en castellano, como la del archivo real (docs/verificaciones.md), con un nombre repetido
// (`Distancia`) y columnas de relleno para que los índices no coincidan con los de la tabla.
const HEADER_ES = 'ID de actividad,Fecha de la actividad,Nombre de la actividad,Tipo de actividad,Distancia,Nombre del archivo,Distancia';
const row = (id: string, name: string, type: string, file: string) => `${id},"31 oct 2026, 7:48:29",${name},${type},"44,86",${file},44860.5`;

async function makeZip(csv: string[], files: Record<string, Uint8Array | string> = {}): Promise<Blob> {
  const zip = new JSZip();
  zip.file('activities.csv', csv.join('\n'));
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'blob' });
}

async function collect(zip: Blob, onProgress?: (done: number, total: number) => void): Promise<ArchiveItem[]> {
  const items: ArchiveItem[] = [];
  for await (const item of readStravaArchive(zip, onProgress)) items.push(item);
  return items;
}

const ok = (items: ArchiveItem[]) => items.flatMap((i) => (i.ok ? [i.activity] : []));

describe('readStravaArchive', () => {
  it('reads csv rows and linked files', async () => {
    const zip = await makeZip(
      [HEADER_ES, row('1', 'Vuelta al cabo', 'Bicicleta', 'activities/1.gpx'), row('2', 'Rodillo martes', 'Ride', 'activities/2.fit.gz')],
      { 'activities/1.gpx': gpx, 'activities/2.fit.gz': gzipSync(fit) },
    );
    const items = await collect(zip);
    expect(items).toHaveLength(2);
    const [a, b] = ok(items);
    expect(a.name).toBe('Vuelta al cabo');
    expect(a.externalId).toBe('1');
    expect(a.startTime).toBe(Date.parse('2026-01-04T08:00:00Z'));
    expect(a.points).toHaveLength(20);
    expect(b.name).toBe('Rodillo martes');
    expect(b.externalId).toBe('2');
    // Totales del fichero: la sesión del FIT, no el CSV.
    expect(b.totals.distanceM).toBe(1950.5);
    for (const act of [a, b]) {
      expect(act.sport).toBe('cycling');
      expect(act.source).toBe('strava-archive');
    }
  });

  it('accepts english headers', async () => {
    const zip = await makeZip(
      ['Activity ID,Activity Date,Activity Name,Activity Type,Filename', '7,"Oct 31, 2026",Morning Ride,Ride,activities/7.gpx'],
      { 'activities/7.gpx': gpx },
    );
    const [a] = ok(await collect(zip));
    expect(a.externalId).toBe('7');
    expect(a.name).toBe('Morning Ride');
  });

  it('marks non-cycling rows without reading their files', async () => {
    const zip = await makeZip(
      [HEADER_ES, row('3', 'Trote', 'Carrera', 'activities/3.gpx'), row('4', 'Paseo', 'Caminata', 'activities/4.gpx')],
      { 'activities/3.gpx': 'no es un gpx', 'activities/4.gpx': 'tampoco' },
    );
    expect(await collect(zip)).toEqual([
      { ok: false, notCycling: true, file: 'activities/3.gpx' },
      { ok: false, notCycling: true, file: 'activities/4.gpx' },
    ]);
  });

  it('reads names with commas, quotes and line breaks', async () => {
    const zip = await makeZip(
      // El nombre va entre comillas, como lo escribe Strava, porque lleva comas, comillas y un salto de línea.
      [HEADER_ES, row('10', '"Cabo, faro y ""vuelta""\nal puerto"', 'Bicicleta', 'activities/10.gpx')],
      { 'activities/10.gpx': gpx },
    );
    const [a] = ok(await collect(zip));
    expect(a.name).toBe('Cabo, faro y "vuelta"\nal puerto');
    expect(a.externalId).toBe('10');
  });

  it('finds activities.csv and files inside a top folder', async () => {
    const zip = new JSZip();
    zip.file('export_123/activities.csv', [HEADER_ES, row('11', 'Dentro', 'Bicicleta', 'activities/11.gpx')].join('\n'));
    zip.file('export_123/activities/11.gpx', gpx);
    const [a] = ok(await collect(await zip.generateAsync({ type: 'blob' })));
    expect(a.externalId).toBe('11');
  });

  it('row without file yields ok:false reason "sin fichero"', async () => {
    const zip = await makeZip([HEADER_ES, row('5', 'Manual', 'Bicicleta', ''), row('6', 'Perdida', 'Bicicleta', 'activities/6.gpx')]);
    const items = await collect(zip);
    expect(items).toHaveLength(2);
    for (const item of items) expect(item).toMatchObject({ ok: false, reason: 'sin fichero' });
    expect(items[1]).toMatchObject({ file: 'activities/6.gpx' });
  });

  it('corrupt file is reported and the rest continue', async () => {
    const zip = await makeZip(
      [HEADER_ES, row('8', 'Rota', 'Bicicleta', 'activities/8.fit'), row('9', 'Buena', 'Bicicleta', 'activities/9.gpx')],
      { 'activities/8.fit': fit.slice(0, fit.length / 2), 'activities/9.gpx': gpx },
    );
    const items = await collect(zip);
    expect(items[0]).toMatchObject({ ok: false, file: 'activities/8.fit' });
    expect(items[1].ok).toBe(true);
  });

  it('reports progress', async () => {
    const zip = await makeZip(
      [HEADER_ES, row('1', 'A', 'Bicicleta', 'activities/1.gpx'), row('3', 'Trote', 'Run', 'activities/3.gpx'), row('2', 'B', 'Ride', 'activities/2.gpx')],
      { 'activities/1.gpx': gpx, 'activities/2.gpx': gpx, 'activities/3.gpx': gpx },
    );
    const calls: [number, number][] = [];
    await collect(zip, (done, total) => calls.push([done, total]));
    expect(calls.length).toBeGreaterThan(0);
    for (const [, total] of calls) expect(total).toBe(2);
    expect(calls.at(-1)).toEqual([2, 2]);
  });

  it('archive without activities.csv throws ParseError unsupported', async () => {
    const zip = new JSZip();
    zip.file('otra.txt', 'hola');
    const blob = await zip.generateAsync({ type: 'blob' });
    await expect(collect(blob)).rejects.toMatchObject({ reason: 'unsupported' });
    await expect(collect(blob)).rejects.toBeInstanceOf(ParseError);
  });
});

describe('readArchiveEntries', () => {
  it('reads an unzipped folder by relative path', async () => {
    const enc = (t: string) => async () => new TextEncoder().encode(t).buffer as ArrayBuffer;
    const entries = new Map([
      ['export_123/activities.csv', enc([HEADER_ES, row('12', 'Carpeta', 'Bicicleta', 'activities/12.gpx'), row('13', 'Trote', 'Carrera', 'activities/13.gpx')].join('\n'))],
      ['export_123/activities/12.gpx', enc(gpx)],
      ['export_123/activities/13.gpx', enc(gpx)],
      ['export_123/profile.jpg', enc('jpg')],
    ]);
    const items: ArchiveItem[] = [];
    for await (const item of readArchiveEntries(entries)) items.push(item);
    expect(items).toHaveLength(2);
    expect(ok(items)[0]).toMatchObject({ externalId: '12', name: 'Carpeta', sport: 'cycling', source: 'strava-archive' });
    expect(items[1]).toEqual({ ok: false, notCycling: true, file: 'activities/13.gpx' });
  });

  it('ok items carry their file path', async () => {
    const enc = (t: string) => async () => new TextEncoder().encode(t).buffer as ArrayBuffer;
    const entries = new Map([
      ['export_123/activities.csv', enc([HEADER_ES, row('12', 'Carpeta', 'Bicicleta', 'activities/12.gpx')].join('\n'))],
      ['export_123/activities/12.gpx', enc(gpx)],
    ]);
    const items: ArchiveItem[] = [];
    for await (const item of readArchiveEntries(entries)) items.push(item);
    expect(items[0]).toMatchObject({ ok: true, file: 'activities/12.gpx' });
  });
});

describe('zipEntries', () => {
  it('lists the files of the zip and reads each one on demand', async () => {
    const zip = new JSZip();
    zip.file('export_1/activities.csv', 'csv');
    zip.file('export_1/routes/1.gpx', '<gpx/>');
    const entries = await zipEntries(await zip.generateAsync({ type: 'blob' }));
    expect([...entries.keys()].sort()).toEqual(['export_1/activities.csv', 'export_1/routes/1.gpx']);
    expect(new TextDecoder().decode(await entries.get('export_1/routes/1.gpx')!())).toBe('<gpx/>');
  });
});
