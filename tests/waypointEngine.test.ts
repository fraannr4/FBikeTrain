import { describe, expect, it } from 'vitest';
import type { LatLng } from '../src/domain/types';
import type { RouteCandidate } from '../src/routes/analyze';
import type { OsmWaypoint } from '../src/routes/sources/waypoints';
import type { HistoryWaypoint } from '../src/routes/historyWaypoints';
import { codeCombos, comboWaypoints, estimateLoopKm, fitsTarget, rankCombos, ROAD_FACTOR, toWaypoints, waypointBand, type Waypoint, ringWaypoints } from '../src/routes/waypointEngine';

// Inicio sintético en el mar, no es el de nadie.
const START: LatLng = { lat: 41, lng: 2.5 };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((START.lat * Math.PI) / 180);
const at = (km: number, deg: number): LatLng => {
  const a = (deg * Math.PI) / 180;
  return { lat: START.lat + (Math.cos(a) * km * 1000) / M_LAT, lng: START.lng + (Math.sin(a) * km * 1000) / M_LNG };
};
const BAND = waypointBand(60);

function osm(id: string, kind: OsmWaypoint['kind'], km: number, deg: number, interes: OsmWaypoint['interes']): OsmWaypoint {
  const p = at(km, deg);
  return { id, kind, name: `Punto ${id}`, lat: p.lat, lng: p.lng, ele: kind === 'pueblo' ? null : 1000, distanceM: km * 1000, interes };
}
const build = (points: (OsmWaypoint | HistoryWaypoint)[]): Waypoint[] => toWaypoints(START, points, BAND);

describe('waypointBand', () => {
  it('va de 0,10 a 0,42 de la distancia en línea recta', () => {
    const b = waypointBand(60);
    expect(b.minM).toBeCloseTo(6_000, 6);
    expect(b.maxM).toBeCloseTo(25_200, 6);
  });
});

describe('toWaypoints', () => {
  it('filtra por banda y añade rumbo y dirección', () => {
    const wps = build([osm('cerca', 'puerto', 5, 0, 3), osm('lejos', 'puerto', 40, 0, 3), osm('bien', 'puerto', 20, 90, 3)]);
    expect(wps.map((w) => w.id)).toEqual(['bien']);
    expect(wps[0].direccion).toBe('este');
    expect(Math.round(wps[0].bearing)).toBe(90);
  });

  it('quita duplicados a menos de 300 m y gana el del historial', () => {
    const near = at(20, 0);
    const hist: HistoryWaypoint = { id: 'hist-cell-1', kind: 'habitual', name: 'Tramo habitual 1', lat: near.lat + 0.001, lng: near.lng, ele: null, distanceM: 20_000 };
    const wps = build([osm('p1', 'puerto', 20, 0, 3), hist]);
    expect(wps.map((w) => w.id)).toEqual(['hist-cell-1']);
  });
});

describe('estimateLoopKm', () => {
  it('suma el recorrido recto del bucle por el factor de carretera', () => {
    expect(estimateLoopKm(START, [at(20, 0)])).toBeCloseTo(40 * ROAD_FACTOR, 0);
    expect(estimateLoopKm(START, [at(20, 0)], 1)).toBeCloseTo(40, 0);
  });
});

describe('codeCombos', () => {
  const eight = () => build([0, 45, 90, 135, 180, 225, 270, 315].map((d, i) => osm(`w${i}`, 'puerto', 23, d, 3)));

  it('da una combinación por rumbo en las 8 primeras, sin repetir dirección', () => {
    const combos = codeCombos(START, eight(), { distanceKm: 60, elevGainM: null });
    expect(combos.length).toBeGreaterThanOrEqual(8);
    expect(new Set(combos.slice(0, 8).map((c) => c.direccion)).size).toBe(8);
    expect(combos.every((c) => c.source === 'codigo')).toBe(true);
  });

  it('sin desnivel pedido pasa por el puerto de más interés antes que por el pueblo de interés 0', () => {
    const wps = build([osm('puerto', 'puerto', 23, 0, 3), osm('pueblo', 'pueblo', 23, 10, 0)]);
    const [first] = codeCombos(START, wps, { distanceKm: 60, elevGainM: null });
    expect(first.waypointIds).toEqual(['puerto']);
  });

  it('con desnivel pedido prefiere el puerto aunque el pueblo tenga más interés', () => {
    const wps = build([osm('puerto', 'puerto', 23, 0, 1), osm('pueblo', 'pueblo', 23, 10, 2)]);
    expect(codeCombos(START, wps, { distanceKm: 60, elevGainM: null })[0].waypointIds).toEqual(['pueblo']);
    expect(codeCombos(START, wps, { distanceKm: 60, elevGainM: 800 })[0].waypointIds).toEqual(['puerto']);
  });

  it('ninguna combinación se sale de ±15 % de la distancia pedida', () => {
    const wps = build([0, 30, 60, 90, 120, 150, 180, 270].map((d, i) => osm(`w${i}`, 'puerto', 12 + i * 2, d, 2)));
    const combos = codeCombos(START, wps, { distanceKm: 60, elevGainM: null });
    expect(combos.length).toBeGreaterThan(0);
    const byId = new Map(wps.map((w) => [w.id, w]));
    for (const c of combos) {
      const km = estimateLoopKm(START, c.waypointIds.map((id) => byId.get(id)!).map((w) => ({ lat: w.lat, lng: w.lng })));
      expect(km).toBeGreaterThanOrEqual(51);
      expect(km).toBeLessThanOrEqual(69);
    }
  });

  it('une dos puntos con rumbos separados 20 a 90 grados, en orden de giro', () => {
    const wps = build([osm('a', 'puerto', 14.5, 0, 3), osm('b', 'puerto', 14.5, 60, 3)]);
    const combos = codeCombos(START, wps, { distanceKm: 60, elevGainM: null });
    expect(combos.find((c) => c.waypointIds.length === 2)?.waypointIds).toEqual(['a', 'b']);
  });

  it('devuelve como mucho 16', () => {
    const many = build(Array.from({ length: 40 }, (_, i) => osm(`w${i}`, 'puerto', 23, (i * 9) % 360, 2)));
    expect(codeCombos(START, many, { distanceKm: 60, elevGainM: null }).length).toBeLessThanOrEqual(16);
  });
});

describe('ringWaypoints', () => {
  it('da 12 rumbos a dos distancias dentro de la banda, con las que salen parejas de la distancia pedida', () => {
    const ring = ringWaypoints(START, 60);
    expect(ring).toHaveLength(24);
    expect(new Set(ring.map((p) => Math.round(p.distanceM / 1000)))).toEqual(new Set([12, 17]));
    expect(build(ring)).toHaveLength(24);
    expect(ring[0].name).toBe('rumbo norte');
    const ranked = rankCombos(START, build(ring), { distanceKm: 60, elevGainM: null }, { roadFactor: 1.7 });
    expect(new Set(ranked.map((r) => r.combo.direccion)).size).toBe(8);
  });
});

describe('rankCombos', () => {
  const target = { distanceKm: 60, elevGainM: null };
  const rings = () => build([0, 180].flatMap((d) => [osm(`lejos${d}`, 'puerto', 23, d, 2), osm(`cerca${d}`, 'puerto', 16, d, 2)]));

  it('con un factor de carretera mayor elige los puntos más cercanos', () => {
    expect(rankCombos(START, rings(), target, { roadFactor: 1.3 }).map((r) => r.combo.id).sort()).toEqual(['lejos0', 'lejos180']);
    const twisty = rankCombos(START, rings(), target, { roadFactor: 1.85 });
    expect(twisty.map((r) => r.combo.id).sort()).toEqual(['cerca0', 'cerca180']);
    expect(twisty[0].estimateKm).toBeCloseTo(2 * 16 * 1.85, 0);
  });

  it('admite un factor distinto para cada rumbo', () => {
    const ranked = rankCombos(START, rings(), target, { roadFactor: (bearing) => (bearing < 90 || bearing > 270 ? 1.85 : 1.3) });
    expect(ranked.map((r) => r.combo.id).sort()).toEqual(['cerca0', 'lejos180']);
  });

  it('entre dos parejas iguales prefiere la de puntos a distancia parecida: la otra suele ir y volver por la misma carretera', () => {
    // Las dos parejas estiman lo mismo (59 km) con el mismo interés.
    const wps = build([osm('a', 'puerto', 13.7, 0, 2), osm('b', 'puerto', 13.7, 60, 2), osm('cerca', 'puerto', 6.5, 180, 2), osm('lejos', 'puerto', 18.6, 240, 2)]);
    const pairs = rankCombos(START, wps, target).filter((r) => r.points.length === 2);
    expect(pairs.map((r) => r.combo.id)).toEqual(expect.arrayContaining(['a+b', 'cerca+lejos']));
    expect(pairs[0].combo.id).toBe('a+b');
    expect(pairs[0].score).toBeGreaterThan(pairs.find((r) => r.combo.id === 'cerca+lejos')!.score);
  });

  it('con una estimación de desnivel ordena por lo que se acerca al pedido, no por puertos', () => {
    const wps = build([osm('puerto', 'puerto', 23, 0, 3), osm('pueblo', 'pueblo', 23, 10, 0)]);
    const gainM = (points: Waypoint[]) => (points.some((w) => w.kind === 'puerto') ? 1500 : 750);
    const ranked = rankCombos(START, wps, { distanceKm: 60, elevGainM: 800 }, { gainM });
    expect(ranked[0].combo.waypointIds).toEqual(['pueblo']);
    expect(ranked[0].gainM).toBe(750);
  });

  it('salta lo que indique skip y da el rumbo del punto más lejano', () => {
    const wps = build([osm('a', 'puerto', 12, 0, 3), osm('b', 'puerto', 17, 60, 3)]);
    const [pair] = rankCombos(START, wps, target, { skip: (c) => c.points.length === 1 });
    expect(pair.combo.waypointIds).toEqual(['a', 'b']);
    expect(pair.bearing).toBeCloseTo(60, 0);
  });
});

describe('comboWaypoints', () => {
  it('sale y vuelve al inicio, con approach y departure del historial', () => {
    const p = at(20, 0);
    const approach = at(18, 0);
    const departure = at(18, 5);
    const hist: HistoryWaypoint = { id: 'hist-climb-1', kind: 'habitual', name: 'Subida habitual 1', lat: p.lat, lng: p.lng, ele: 900, distanceM: 20_000, approach, departure };
    const wps = build([hist, osm('p', 'puerto', 20, 90, 3)]);
    const byId = new Map(wps.map((w) => [w.id, w]));
    const line = comboWaypoints(START, { id: 'x', waypointIds: ['hist-climb-1', 'p'], direccion: 'norte', source: 'codigo' }, byId);
    expect(line[0]).toEqual(START);
    expect(line[line.length - 1]).toEqual(START);
    expect(line.slice(1, 4)).toEqual([approach, { lat: p.lat, lng: p.lng }, departure]);
    expect(line).toHaveLength(6);
  });
});

describe('fitsTarget', () => {
  const cand = (distanceKm: number, elevGainM: number, over: Partial<RouteCandidate> = {}): RouteCandidate => ({
    id: 'c', seed: 1, coords: [], distanceM: distanceKm * 1000, elevGainM, unpavedM: 0, trackM: 0, mainRoadPct: 0, unknownSurfacePct: 0,
    motorway: false, steep: [], profile: [], maxSteepCls: 0, ...over,
  });

  it('acepta ±10 % de la distancia', () => {
    const t = { distanceKm: 60, elevGainM: null };
    expect(fitsTarget(cand(54, 0), t)).toBe(true);
    expect(fitsTarget(cand(66, 0), t)).toBe(true);
    expect(fitsTarget(cand(53.9, 0), t)).toBe(false);
    expect(fitsTarget(cand(66.1, 0), t)).toBe(false);
  });

  it('acepta ±25 % del desnivel si se pide', () => {
    const t = { distanceKm: 60, elevGainM: 800 };
    expect(fitsTarget(cand(60, 600), t)).toBe(true);
    expect(fitsTarget(cand(60, 1000), t)).toBe(true);
    expect(fitsTarget(cand(60, 599), t)).toBe(false);
    expect(fitsTarget(cand(60, 1001), t)).toBe(false);
  });

  it('rechaza una candidata con 150 m sin asfaltar', () => {
    expect(fitsTarget(cand(60, 800, { unpavedM: 150 }), { distanceKm: 60, elevGainM: 800 })).toBe(false);
  });
});
