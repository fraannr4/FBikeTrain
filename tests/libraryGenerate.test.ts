import { describe, expect, it, vi } from 'vitest';
import { abortError } from '../src/ai/abort';
import type { LatLng } from '../src/domain/types';
import { MAX_ADAPT_REQUESTS, type AdaptDeps, type AdaptedRoute, type AdaptOptions } from '../src/routes/adapt';
import type { RouteCandidate } from '../src/routes/analyze';
import type { RoutePoint } from '../src/routes/library';
import { cellOverlap } from '../src/routes/library/cells';
import {
  generateProposals, GENERATOR_ORS_BUDGET, LIBRARY_ORS_BUDGET, libraryRadiusM, meetsRoad, meetsTarget, toParsedReference,
  type GeneratorDeps, type GeneratorTarget, type GeneratorUpdate,
} from '../src/routes/library/generate';
import { candidateRings, loopPerimeterM } from '../src/routes/library/ring';
import type { LibraryZone } from '../src/routes/library/schema';
import { fetchPathFeature, OrsError } from '../src/routes/ors';
import {
  circleLoop, fakeOrs, featureFrom, gridCells, libRoute, offset, pathLengthM, pathThrough, START, withElevation, zoneOf, type FakeOrsOptions,
} from './fixtures/libraryGenerator';

const target: GeneratorTarget = { start: START, distanceKm: 60, elevGainM: null };

function adapted(coords: RoutePoint[], over: Partial<AdaptedRoute> = {}): AdaptedRoute {
  const gains = coords.every(p => p.ele !== undefined);
  let gain = 0;
  if (gains) for (let i = 1; i < coords.length; i++) gain += Math.max(0, coords[i].ele! - coords[i - 1].ele!);
  return {
    coords, distanceM: pathLengthM(coords), elevGainM: gains ? gain : null, connectorM: 0, passesNearM: 0, rotated: false,
    warnings: [], requestsUsed: 0, ...over,
  };
}

function run(zone: LibraryZone, ors: FakeOrsOptions = {}, over: Partial<GeneratorDeps> & { target?: GeneratorTarget } = {}) {
  const fake = fakeOrs(ors);
  const updates: GeneratorUpdate[] = [];
  const library = vi.fn(async () => zone);
  const wait = vi.fn(async () => {});
  const deps: GeneratorDeps = { ors: fake.access, library, reference: null, visited: new Set(), onUpdate: u => updates.push(u), wait, ...over };
  return { fake, updates, library, wait, result: generateProposals(over.target ?? target, deps) };
}

const nuevas = <T extends { kind: string }>(cards: T[]) => cards.filter(c => c.kind === 'nueva');

describe('generador: utilidades', () => {
  it('el radio de la biblioteca es 0,45 veces la distancia, entre 8 y 40 km', () => {
    expect(libraryRadiusM(60)).toBe(27_000);
    expect(libraryRadiusM(10)).toBe(8_000);
    expect(libraryRadiusM(200)).toBe(40_000);
  });

  it('el objetivo admite ±10 % en distancia y ±25 % en desnivel, y un desnivel desconocido no cumple', () => {
    expect(meetsTarget(54_500, null, target)).toBe(true);
    expect(meetsTarget(66_500, null, target)).toBe(false);
    const climb = { ...target, elevGainM: 800 };
    expect(meetsTarget(60_000, 610, climb)).toBe(true);
    expect(meetsTarget(60_000, 590, climb)).toBe(false);
    expect(meetsTarget(60_000, null, climb)).toBe(false);
  });

  it('la carretera admite hasta 100 m sin asfaltar o de pista, sin autopista y hasta un 20 % de principal', () => {
    const base = { motorway: false, unpavedM: 0, trackM: 0, mainRoadPct: 0, distanceM: 60_000 } as RouteCandidate;
    expect(meetsRoad(base)).toBe(true);
    expect(meetsRoad({ ...base, distanceM: 1 })).toBe(true);
    expect(meetsRoad({ ...base, unpavedM: 150 })).toBe(false);
    expect(meetsRoad({ ...base, trackM: 150 })).toBe(false);
    expect(meetsRoad({ ...base, mainRoadPct: 25 })).toBe(false);
    expect(meetsRoad({ ...base, motorway: true })).toBe(false);
  });

  it('una ruta de la biblioteca se convierte en referencia para guardarla, con autor y fuente', () => {
    const ref = toParsedReference(libRoute(1));
    expect(ref.name).toBe('Vuelta sintética 1');
    expect(ref.author).toBe('Autor sintético en Ride with GPS');
    expect(ref.sourceUrl).toBe('https://ridewithgps.com/routes/900001');
    expect(ref.catalog).toEqual({ kind: 'rwgps', ref: 'rwgps-900001', tipo: 'carretera' });
    expect(ref.points.length).toBe(libRoute(1).line.length);
    expect(ref.originalXml).toContain('<trkpt');
  });
});

describe('generador: vueltas nuevas (A)', () => {
  it('corrige la longitud con una segunda consulta cuando el anillo sale corto', async () => {
    const { fake, result } = run(zoneOf({ cells: gridCells({ stepM: 500 }), factor: 1.75 }), { factor: 1 });
    const res = await result;
    const [first, second] = fake.calls;
    const firstPerim = loopPerimeterM(first.slice(0, -1));
    const measured = pathLengthM(first);
    expect(Math.abs(measured - 60_000)).toBeGreaterThan(6_000);
    const expected = firstPerim * 60_000 / measured;
    expect(Math.abs(loopPerimeterM(second.slice(0, -1)) - expected) / expected).toBeLessThanOrEqual(0.05);
    // La corrección es el mismo anillo (mismo eje), no el siguiente.
    const axis = (wps: LatLng[]) => {
      const inner = wps.slice(1, -1);
      const lat = inner.reduce((s, p) => s + p.lat, 0) / inner.length - START.lat;
      const lng = (inner.reduce((s, p) => s + p.lng, 0) / inner.length - START.lng) * Math.cos((START.lat * Math.PI) / 180);
      return (Math.atan2(lng, lat) * 180) / Math.PI;
    };
    expect(Math.abs(axis(second) - axis(first))).toBeLessThan(10);
    const card = res.cards[0];
    expect(card.kind).toBe('nueva');
    if (card.kind === 'nueva') expect(card.route.coords).toEqual(fake.responses[1].geometry.coordinates);
    expect(res.cards.length).toBeGreaterThanOrEqual(3);
  });

  it('descarta una vuelta que comparte el 75 % de las celdas con una aceptada y admite una del 65 %', async () => {
    const cells = gridCells({ stepM: 500 });
    const first = candidateRings(START, cells, { distanceKm: 60, factor: 1.75, elevGainM: null, sparse: false, broad: false })[0];
    const ringPath = pathThrough([START, ...first.waypoints, START], 1.75);
    /** Vuelta B que comparte la parte `q` del anillo y sigue 800 m por fuera de él. */
    const sharing = (q: number): RoutePoint[] => {
      const cut = Math.round(ringPath.length * q);
      const c = { lat: first.waypoints.reduce((s, p) => s + p.lat, 0) / 5, lng: first.waypoints.reduce((s, p) => s + p.lng, 0) / 5 };
      const outside = ringPath.slice(cut).map(p => {
        const d = Math.hypot((p.lat - c.lat) * 111_195, (p.lng - c.lng) * 85_180) || 1;
        return offset(p, ((p.lng - c.lng) * 85_180 / d) * 800, ((p.lat - c.lat) * 111_195 / d) * 800);
      });
      return withElevation([...ringPath.slice(0, cut), ...outside, START], 300);
    };
    for (const [q, enters] of [[0.73, false], [0.6, true]] as const) {
      const b = sharing(q);
      const overlap = cellOverlap(b, ringPath);
      expect(enters ? overlap < 0.7 && overlap > 0.6 : overlap > 0.7 && overlap < 0.8).toBe(true);
      const adapt = vi.fn(async () => adapted(b));
      const { fake, result } = run(zoneOf({ cells, routes: [libRoute(1)] }), { respond: (_, n) => (n === 0 ? featureFrom(b) : undefined) }, { adapt });
      const res = await result;
      expect(res.cards[0].kind).toBe('biblioteca');
      const ringResponse = fake.responses[1].geometry.coordinates;
      expect(nuevas(res.cards).some(c => c.kind === 'nueva' && c.route.coords === ringResponse)).toBe(enters);
    }
  });

  it('no admite principal de más del 20 %, 150 m sin asfaltar ni un 20 % de retroceso', async () => {
    const zone = zoneOf({ cells: gridCells() });
    for (const defect of [{ mainRoadPct: 25 }, { unpavedM: 150 }, { spur: 0.2 }] as FakeOrsOptions[]) {
      const res = await run(zone, defect).result;
      expect(nuevas(res.cards)).toHaveLength(0);
      expect(res.warnings.length).toBeGreaterThan(0);
    }
    expect(nuevas((await run(zone).result).cards).length).toBeGreaterThan(0);
  });

  it('sin datos del firme no entra', async () => {
    const res = await run(zoneOf({ cells: gridCells() }), { noExtras: true }).result;
    expect(res.cards).toHaveLength(0);
  });

  it('con un desnivel imposible no propone vueltas y dice cuánto se ha conseguido', async () => {
    const climb = { ...target, elevGainM: 800 };
    const res = await run(zoneOf({ cells: gridCells({ climbMPerKm: 7 }) }), { gainM: 400 }, { target: climb }).result;
    expect(nuevas(res.cards)).toHaveLength(0);
    expect(res.warnings.join(' ')).toMatch(/400 m/);
    expect(res.warnings.join(' ')).toMatch(/800 m ±25 %/);
  });
});

describe('generador: rutas de la biblioteca (B)', () => {
  const loops = [circleLoop(0, 60_000), circleLoop(120, 60_000), circleLoop(240, 60_000)];
  const retraceSame = (bs: RoutePoint[][]) => (_: LatLng[], n: number) => (n < bs.length ? featureFrom(bs[n]) : undefined);

  it('mezcla como mucho 2 rutas de la biblioteca, primero, y completa con vueltas nuevas hasta 3-5', async () => {
    const adapt = vi.fn(async (_p: RoutePoint[], _o: AdaptOptions) => adapted(loops[adapt.mock.calls.length - 1]));
    const zone = zoneOf({ cells: gridCells(), routes: [libRoute(1), libRoute(2), libRoute(3)] });
    const res = await run(zone, { respond: retraceSame(loops) }, { adapt }).result;
    expect(res.cards.slice(0, 2).map(c => c.kind)).toEqual(['biblioteca', 'biblioteca']);
    expect(res.cards.filter(c => c.kind === 'biblioteca')).toHaveLength(2);
    expect(res.cards.length).toBeGreaterThanOrEqual(3);
    expect(res.cards.length).toBeLessThanOrEqual(5);
    expect(adapt).toHaveBeenCalledTimes(2);
    expect(adapt.mock.calls[0][1]).toMatchObject({ start: START, mode: 'mi-inicio', targetKm: 60 });
  });

  it('una ruta cuyo re-trazado comparte menos del 60 % de las celdas no entra', async () => {
    const adapt = vi.fn(async () => adapted(loops[0]));
    const far = withElevation(pathThrough(loops[0].map(p => offset(p, 1500, 0)).filter((_, i) => i % 50 === 0)), 300);
    const res = await run(zoneOf({ routes: [libRoute(1)] }), { respond: () => featureFrom(far) }, { adapt }).result;
    expect(res.cards).toHaveLength(0);
  });

  it('el re-trazado pide 8 puntos repartidos que empiezan y acaban en el inicio', async () => {
    const adapt = vi.fn(async () => adapted(loops[0]));
    const { fake, result } = run(zoneOf({ routes: [libRoute(1)] }), { respond: retraceSame([loops[0]]) }, { adapt });
    const res = await result;
    expect(fake.calls[0]).toHaveLength(8);
    expect(fake.calls[0][0]).toEqual(START);
    expect(fake.calls[0][7]).toEqual(START);
    expect(res.cards.map(c => c.kind)).toEqual(['biblioteca']);
  });

  it('con desnivel pedido una ruta sin altitud no entra; sin desnivel pedido, sí', async () => {
    const flat = loops[0].map(p => ({ lat: p.lat, lng: p.lng }));
    const zone = zoneOf({ routes: [libRoute(1, { elevGainM: null })] });
    const adapt = vi.fn(async () => adapted(flat));
    const withGain = await run(zone, { respond: retraceSame([flat]) }, { adapt, target: { ...target, elevGainM: 600 } }).result;
    expect(withGain.cards).toHaveLength(0);
    const without = await run(zone, { respond: retraceSame([flat]) }, { adapt }).result;
    expect(without.cards.map(c => c.kind)).toEqual(['biblioteca']);
  });
});

describe('generador: presupuesto y errores', () => {
  it('nunca pasa de 20 consultas aunque todas fallen', async () => {
    const { fake, result } = run(zoneOf({ cells: gridCells() }), { fail: () => new OrsError('no_route', 'Sin ruta') });
    const res = await result;
    expect(res.requestsUsed).toBeLessThanOrEqual(GENERATOR_ORS_BUDGET);
    expect(fake.calls.length).toBe(res.requestsUsed);
    expect(res.cards).toHaveLength(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('el gasto en rutas de la biblioteca (adaptaciones y re-trazados) no pasa de 8', async () => {
    for (const spent of [4, 2, 0]) {
      const adapt = vi.fn(async () => adapted(circleLoop(0, 60_000), { requestsUsed: spent }));
      const far = featureFrom(withElevation(pathThrough([offset(START, 9000, 9000), offset(START, 9000, 19_000)]), 300));
      const routes = [1, 2, 3, 4, 5, 6].map(n => libRoute(n));
      const { fake, result } = run(zoneOf({ routes }), { respond: () => far }, { adapt });
      const res = await result;
      const spentB = adapt.mock.calls.length * spent + fake.calls.length;
      expect(res.requestsUsed).toBe(spentB);
      expect(spentB).toBeLessThanOrEqual(LIBRARY_ORS_BUDGET);
    }
  });

  it('una adaptación que falla con consultas hechas las cuenta y no se repite', async () => {
    const errors = [new OrsError('server', 'Fallo de ORS', 502), new OrsError('rate_minute', 'Límite por minuto', 429, 5)];
    for (const error of errors) {
      for (const cells of [[], gridCells()]) {
        const adapt = vi.fn(async (_p: RoutePoint[], o: AdaptOptions, d: AdaptDeps) => {
          for (let i = 0; i < MAX_ADAPT_REQUESTS; i++) await fetchPathFeature(d.ors, [o.start, offset(o.start, 3000, 0)], d.signal);
          throw error;
        });
        const routes = [1, 2, 3, 4, 5, 6].map(n => libRoute(n));
        const { fake, wait, result } = run(zoneOf({ cells, routes }), {}, { adapt });
        const res = await result;
        const spentB = adapt.mock.calls.length * MAX_ADAPT_REQUESTS;
        expect(spentB).toBeLessThanOrEqual(LIBRARY_ORS_BUDGET);
        expect(fake.calls.length).toBeLessThanOrEqual(GENERATOR_ORS_BUDGET);
        expect(fake.calls.length).toBe(res.requestsUsed);
        if (cells.length === 0) expect(fake.calls.length).toBe(spentB);
        if (error.kind === 'rate_minute') expect(wait).toHaveBeenCalledTimes(adapt.mock.calls.length);
      }
    }
  });

  it('con la zona vacía no consulta ORS y lo dice', async () => {
    const { fake, result } = run(zoneOf());
    const res = await result;
    expect(res.cards).toHaveLength(0);
    expect(res.requestsUsed).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/No hay rutas de referencia en esta zona todavía/);
    expect(res.warnings[0]).not.toMatch(/Ride with GPS/);
    const unavailable = await run(zoneOf({ fill: 'unavailable' })).result;
    expect(unavailable.warnings[0]).toMatch(/no se ha podido buscar en Ride with GPS/);
  });

  it('pide la biblioteca con el radio de la distancia y avisa de cada paso', async () => {
    const { library, updates, result } = run(zoneOf({ cells: gridCells() }));
    await result;
    expect(library).toHaveBeenCalledWith({ lat: START.lat, lon: START.lng, radiusM: 27_000, distanceKm: 60, elevGainM: null }, undefined);
    expect(updates[0]).toEqual({ kind: 'library' });
    expect(updates[1]).toMatchObject({ kind: 'library-ready', routes: 40 });
    expect(updates.some(u => u.kind === 'trying' && u.budget === GENERATOR_ORS_BUDGET)).toBe(true);
    expect(updates.some(u => u.kind === 'card')).toBe(true);
  });

  it('si ORS no encuentra ruta en ningún anillo, no lanza y avisa', async () => {
    const res = await run(zoneOf({ cells: gridCells() }), { fail: () => new OrsError('no_route', 'Sin ruta') }).result;
    expect(res.cards).toHaveLength(0);
    expect(res.warnings.join(' ')).toMatch(/60 km ±10 %/);
  });

  it('con el límite por minuto espera lo que dice ORS y sigue sin gastar presupuesto', async () => {
    const limit = new OrsError('rate_minute', 'Límite por minuto', 429, 5);
    const { fake, wait, updates, result } = run(zoneOf({ cells: gridCells() }), { fail: n => (n === 2 ? limit : undefined) });
    const res = await result;
    expect(wait).toHaveBeenCalledWith(6000, undefined);
    expect(updates).toContainEqual({ kind: 'waiting', seconds: 6 });
    expect(fake.calls.length).toBe(res.requestsUsed + 1);
    expect(res.cards.length).toBeGreaterThanOrEqual(3);
  });

  it('cancelar durante la espera lanza AbortError', async () => {
    const controller = new AbortController();
    const limit = new OrsError('rate_minute', 'Límite por minuto', 429, 5);
    const wait = vi.fn(async () => { controller.abort(); throw abortError(); });
    const { result } = run(zoneOf({ cells: gridCells() }), { fail: n => (n === 2 ? limit : undefined) }, { wait, signal: controller.signal });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('con la cuota diaria agotada conserva las aceptadas y avisa', async () => {
    const quota = new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.');
    const res = await run(zoneOf({ cells: gridCells() }), { fail: n => (n >= 2 ? quota : undefined) }).result;
    expect(res.cards).toHaveLength(2);
    expect(res.warnings).toContain(quota.message);
  });

  it('un fallo de la biblioteca se lanza', async () => {
    const fake = fakeOrs();
    const boom = new Error('route-sources caído');
    await expect(generateProposals(target, { ors: fake.access, library: async () => { throw boom; }, reference: null, visited: new Set() })).rejects.toBe(boom);
  });
});
