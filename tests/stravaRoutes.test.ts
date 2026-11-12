import type { ArchiveEntries } from '../src/import/stravaArchive';
import { readArchiveRoutes, stravaRouteRef, type ArchiveRouteItem } from '../src/import/stravaRoutes';
import { routeGpx, routeTcx } from './fixtures/stravaRoutes';

const CSV = 'Activity ID,Activity Name,Activity Type,Filename';

function entries(files: Record<string, string>): ArchiveEntries {
  return new Map(Object.entries(files).map(([path, data]) => [path, async () => new TextEncoder().encode(data).buffer as ArrayBuffer]));
}

async function collect(files: Record<string, string>): Promise<ArchiveRouteItem[]> {
  const items: ArchiveRouteItem[] = [];
  for await (const item of readArchiveRoutes(entries(files))) items.push(item);
  return items;
}

describe('readArchiveRoutes', () => {
  it('lee las rutas GPX y TCX de routes/ con su nombre, huella y fichero', async () => {
    const items = await collect({ 'activities.csv': CSV, 'routes/1.gpx': routeGpx('Vuelta al cabo'), 'routes/2.tcx': routeTcx('Faro') });
    expect(items.map((i) => (i.ok ? [i.file, i.route.name] : i))).toEqual([
      ['routes/1.gpx', 'Vuelta al cabo'],
      ['routes/2.tcx', 'Faro'],
    ]);
    expect(items.every((i) => i.ok && i.ref.length > 0)).toBe(true);
  });

  it('busca routes/ junto a activities.csv cuando va dentro de una carpeta', async () => {
    const items = await collect({ 'export_1/activities.csv': CSV, 'export_1/routes/1.gpx': routeGpx('Dentro') });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ok: true, file: 'export_1/routes/1.gpx' });
  });

  it('anota las rutas vacías, de un punto o en FIT sin cortar la lectura', async () => {
    const items = await collect({
      'activities.csv': CSV,
      'routes/3.gpx': '',
      'routes/4.gpx': routeGpx('Un punto', { points: 1 }),
      'routes/5.fit': 'binario',
      'routes/6.gpx': routeGpx('Buena'),
    });
    expect(items).toHaveLength(4);
    const failed = items.flatMap((i) => (!i.ok && 'reason' in i ? [i.file] : []));
    expect(failed).toEqual(['routes/3.gpx', 'routes/4.gpx', 'routes/5.fit']);
    expect(items.find((i) => i.file === 'routes/5.fit')).toMatchObject({ reason: 'formato de ruta no soportado' });
    expect(items.at(-1)).toMatchObject({ ok: true, file: 'routes/6.gpx' });
  });

  it('marca como no ciclismo solo las rutas de otro deporte', async () => {
    const items = await collect({
      'activities.csv': CSV,
      'routes/1.gpx': routeGpx('Trote', { type: 'Run' }),
      'routes/2.gpx': routeGpx('Bici', { type: 'cycling', offset: 0.1 }),
      'routes/3.gpx': routeGpx('Número', { type: '1', offset: 0.2 }),
      'routes/4.gpx': routeGpx('Sin tipo', { offset: 0.3 }),
    });
    expect(items[0]).toEqual({ ok: false, notCycling: true, file: 'routes/1.gpx' });
    expect(items.slice(1).every((i) => i.ok)).toBe(true);
  });

  it('ignora ficheros ocultos y no emite nada sin routes/', async () => {
    expect(await collect({ 'activities.csv': CSV, 'activities/1.gpx': routeGpx('Salida') })).toEqual([]);
    expect(await collect({ 'activities.csv': CSV, 'routes/.DS_Store': 'x', '__MACOSX/routes/._1.gpx': 'x' })).toEqual([]);
  });
});

describe('stravaRouteRef', () => {
  it('la misma geometría da la misma huella aunque cambien el fichero y el nombre', async () => {
    const [a] = await collect({ 'activities.csv': CSV, 'routes/1.gpx': routeGpx('Uno') });
    const [b] = await collect({ 'activities.csv': CSV, 'routes/7.gpx': routeGpx('Otro nombre') });
    const [c] = await collect({ 'activities.csv': CSV, 'routes/1.gpx': routeGpx('Uno', { offset: 0.5 }) });
    if (!a.ok || !b.ok || !c.ok) throw new Error('rutas no leídas');
    expect(a.ref).toBe(b.ref);
    expect(a.ref).not.toBe(c.ref);
    expect(stravaRouteRef(a.route)).toBe(a.ref);
  });
});
