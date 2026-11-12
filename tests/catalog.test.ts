import JSZip from 'jszip';
import { db } from '../src/db/db';
import type { AdaptedRoute } from '../src/routes/adapt';
import { buildCatalogQuery, chainLines, parseCatalog, roundedCentre } from '../src/routes/catalog/osm';
import { rankCatalog, recommendFromCatalog } from '../src/routes/catalog/recommend';
import { importReferenceRoutes, listReferenceRoutes, saveCatalogRoutes, type ReferenceRoute } from '../src/routes/library';
import { OrsError } from '../src/routes/ors';

// Datos sintéticos: rutas inventadas en el mar frente a la costa, cerca de (41, 2.5).
const START = { lat: 41.0, lng: 2.5 };
const DEG_LAT_M = 111_195;
/** Línea hacia el norte desde (lat, lng), con un punto cada ~100 m. */
const north = (lat: number, lng: number, km: number) => Array.from({ length: km * 10 + 1 }, (_, i) => ({ lat: lat + (i * 100) / DEG_LAT_M, lng }));
const geom = (pts: { lat: number; lng: number }[]) => pts.map((p) => ({ lat: p.lat, lon: p.lng }));

function relation(id: number, route: 'bicycle' | 'mtb', lines: { lat: number; lng: number }[][], extra: Record<string, string> = {}) {
  return { type: 'relation', id, tags: { type: 'route', route, name: `Ruta sintética ${id}`, ...extra }, members: lines.map((l) => ({ type: 'way', ref: id * 10, role: '', geometry: geom(l) })) };
}

beforeEach(async () => {
  await db.referenceRoutes.clear();
});

describe('consulta de OpenStreetMap', () => {
  it('redondea el centro a 2 decimales y pide bicycle y mtb a 15 km', () => {
    expect(roundedCentre({ lat: 41.6321, lng: 2.1634 })).toEqual({ lat: 41.63, lng: 2.16 });
    const q = buildCatalogQuery({ lat: 41.6321, lng: 2.1634 });
    expect(q).toContain('rel(around:15000,41.63,2.16)');
    expect(q).toContain('route~"^(bicycle|mtb)$"');
    expect(q).not.toContain('41.6321');
  });
});

describe('chainLines', () => {
  it('encadena tramos desordenados y dados la vuelta', () => {
    const a = north(41, 2.5, 2);
    const b = north(a[a.length - 1].lat, 2.5, 2);
    const chain = chainLines([b.slice().reverse(), a]);
    expect(chain.length).toBe(a.length + b.length);
    const ends = [chain[0].lat, chain[chain.length - 1].lat].sort();
    expect(ends[0]).toBeCloseTo(41, 6);
    expect(ends[1]).toBeCloseTo(b[b.length - 1].lat, 6);
  });
  it('no une huecos de más de 300 m: se queda con la cadena más larga', () => {
    const a = north(41, 2.5, 1);
    const b = north(41.1, 2.5, 3);
    expect(chainLines([a, b])).toEqual(b);
  });
});

describe('parseCatalog', () => {
  it('convierte relaciones en rutas con atribución, tipo y cercanía', () => {
    const raw = { elements: [
      relation(2, 'mtb', [north(41.05, 2.5, 8)]),
      relation(1, 'bicycle', [north(41.0, 2.5, 6)], { operator: 'Consell sintètic' }),
      relation(3, 'bicycle', [north(41.0, 2.5, 2)]),
      relation(4, 'bicycle', [north(41.3, 2.5, 10)]),
    ] };
    const routes = parseCatalog(raw, START);
    expect(routes.map((r) => r.ref)).toEqual(['osm-relation-1', 'osm-relation-2']);
    expect(routes[0]).toMatchObject({ tipo: 'carretera', url: 'https://www.openstreetmap.org/relation/1', author: '© OpenStreetMap contributors; Consell sintètic' });
    expect(routes[1].tipo).toBe('btt');
    expect(routes[0].distanceM).toBeGreaterThan(5900);
  });
  it('ignora el sentido backward y los cortes del rectángulo', () => {
    const line = north(41, 2.5, 6);
    const rel = relation(5, 'bicycle', [line]);
    rel.members.push({ type: 'way', ref: 99, role: 'backward', geometry: geom(line) });
    const routes = parseCatalog({ elements: [rel] }, START);
    expect(routes[0].distanceM).toBeLessThan(6100);
  });
  it('rechaza una respuesta que no se entiende o un error de Overpass', () => {
    expect(() => parseCatalog({ nada: 1 }, START)).toThrow();
    expect(() => parseCatalog({ elements: [], remark: 'runtime error: timed out' }, START)).toThrow(/saturado/);
  });
});

describe('importación por lotes', () => {
  const gpx = (name: string, lat: number) => `<gpx version="1.1"><trk><name>${name}</name><trkseg><trkpt lat="${lat}" lon="2.5"><ele>1</ele></trkpt><trkpt lat="${lat + 0.01}" lon="2.5"><ele>5</ele></trkpt></trkseg></trk></gpx>`;
  it('importa varios GPX y un ZIP, e informa de cada error sin parar', async () => {
    const zip = new JSZip();
    zip.file('rutas/a.gpx', gpx('Zip A', 41));
    zip.file('rutas/b.gpx', gpx('Zip B', 41.1));
    zip.file('__MACOSX/rutas/._a.gpx', 'basura');
    zip.file('leeme.txt', 'nada');
    const zipFile = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'wikiloc.zip');
    const files = [new File([gpx('Suelta', 41.2)], 'suelta.gpx'), new File(['<gpx'], 'rota.gpx'), new File(['x'], 'foto.jpg'), zipFile];
    const { imported, failed } = await importReferenceRoutes(files);
    expect(imported.map((r) => r.name).sort()).toEqual(['Suelta', 'Zip A', 'Zip B']);
    expect(failed.map((f) => f.name).sort()).toEqual(['foto.jpg', 'rota.gpx']);
    expect(await db.referenceRoutes.count()).toBe(3);
  });
});

describe('recomendación desde el catálogo', () => {
  const route = (id: string, km: number, gain: number | null, lat = 41): ReferenceRoute => {
    const points = north(lat, 2.5, Math.max(1, Math.round(km))).map((p) => ({ ...p }));
    return { id, name: `R${id}`, format: 'gpx', sourceFileName: `${id}.gpx`, originalXml: '', originalPoints: points, points,
      summary: { distanceM: km * 1000, elevGainM: gain, elevLossM: gain, closed: false, pointCount: points.length }, createdAt: 0, updatedAt: 0 };
  };
  const ok = (r: ReferenceRoute, shift = 0): AdaptedRoute => ({
    coords: r.points.map((p) => ({ lat: p.lat, lng: p.lng + shift })), distanceM: r.summary.distanceM, elevGainM: r.summary.elevGainM,
    connectorM: 0, passesNearM: 0, rotated: false, warnings: [],
  });
  const target = { start: START, distanceKm: 60, elevGainM: 800 };

  it('ordena por km y desnivel pedidos y descarta lo lejano', () => {
    const { ranked } = rankCatalog([route('a', 60, 300), route('b', 62, 790), route('c', 20, 800), route('d', 60, 800, 41.5)], target);
    expect(ranked.map((r) => r.card.id)).toEqual(['b', 'a']);
  });

  it('propone 3 distintas, salta las rechazadas o repetidas y espera por el límite por minuto', async () => {
    const routes = ['a', 'b', 'c', 'd', 'e'].map((id, i) => route(id, 58 + i, 800));
    let rateHits = 0;
    const waits: number[] = [];
    const adapt = vi.fn(async (points: { lat: number; lng: number }[]) => {
      const r = routes.find((x) => x.points === points)!;
      if (r.id === 'c' && rateHits++ === 0) throw new OrsError('rate_minute', 'límite');
      if (r.id === 'b') return { ...ok(r), rejected: 'Repite demasiado.' };
      return ok(r, r.id === 'c' ? 0 : r.id === 'd' ? 0.0001 : r.id === 'a' ? 0.05 : 0.1);
    });
    const updates: string[] = [];
    const result = await recommendFromCatalog(routes, target, {
      ors: 'clave', adapt: adapt as never, wait: async (ms) => { waits.push(ms); }, onUpdate: (u) => updates.push(u.kind),
    });
    // Orden por cercanía a 60 km: c, b, d, a, e. c espera y vale; b rechazada; d casi igual que c; a y e valen.
    expect(result.proposals.map((p) => p.route.id)).toEqual(['c', 'a', 'e']);
    expect(result.rejected.map((r) => r.id)).toEqual(['b', 'd']);
    expect(waits).toEqual([60_000]);
    expect(updates).toContain('waiting');
  });

  it('sin cuota del día se para con el mensaje de ORS', async () => {
    const adapt = vi.fn(async () => { throw new OrsError('quota_day', 'Sin cuota'); });
    await expect(recommendFromCatalog([route('a', 60, 800)], target, { ors: 'clave', adapt: adapt as never })).rejects.toThrow('Sin cuota');
  });
});

describe('saveCatalogRoutes', () => {
  it('sustituye por ref y conserva las rutas propias', async () => {
    const pts = north(41, 2.5, 6);
    await saveCatalogRoutes([{ name: 'Puerto', points: pts, sourceUrl: 'https://www.openstreetmap.org/node/1', author: '© OpenStreetMap contributors', catalog: { kind: 'puerto', ref: 'osm-pass-1', tipo: 'puerto' } }]);
    await saveCatalogRoutes([{ name: 'Puerto nuevo', points: pts, sourceUrl: 'https://www.openstreetmap.org/node/1', author: '© OpenStreetMap contributors', catalog: { kind: 'puerto', ref: 'osm-pass-1', tipo: 'puerto' } }]);
    const all = await listReferenceRoutes();
    expect(all.map((r) => r.name)).toEqual(['Puerto nuevo']);
  });
});
