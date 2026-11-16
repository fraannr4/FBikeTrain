import { describe, expect, it } from 'vitest';
import type { LatLng } from '../src/domain/types';
import { acceptanceReport, type AcceptanceItem } from '../src/routes/library/acceptance';
import { cellOverlap } from '../src/routes/library/cells';
import type { GeneratorTarget } from '../src/routes/library/generate';

const START: LatLng = { lat: 41.6327, lng: 2.1677 };
const D60: GeneratorTarget = { start: START, distanceKm: 60, elevGainM: null };
const G800: GeneratorTarget = { ...D60, elevGainM: 800 };

/** Línea recta hacia el este de `km` km, desplazada `northKm` al norte del inicio: líneas separadas no comparten celdas. */
function line(northKm: number, km = 10, eastFromKm = 0): LatLng[] {
  const lat = START.lat + northKm / 111.195;
  const kmLng = 111.195 * Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: 21 }, (_, i) => ({ lat, lng: START.lng + (eastFromKm + (km * i) / 20) / kmLng }));
}

const cleanRoad = { unpavedM: 0, trackM: 0, mainRoadPct: 5, motorway: false };
let nextLine = 0;
function item(over: Partial<AcceptanceItem> = {}): AcceptanceItem {
  return { kind: 'nueva', distanceM: 60_000, elevGainM: 800, road: cleanRoad, backtrackM: 0, line: line(3 * nextLine++), ...over };
}
const validity = (target: GeneratorTarget, items: AcceptanceItem[]) => acceptanceReport(target, items).rows.map(r => r.valid);

describe('acceptanceReport', () => {
  it('admite 54,0 y 66,0 km con 60 km y rechaza 53,9 y 66,1', () => {
    const report = acceptanceReport(D60, [53_900, 54_000, 66_000, 66_100].map(distanceM => item({ distanceM })));
    expect(report.rows.map(r => r.valid)).toEqual([false, true, true, false]);
    expect(report.rows[0].reasons).toContain('longitud');
  });

  it('con 800 m admite de 600 a 1.000 m y no un desnivel desconocido', () => {
    expect(validity(G800, [599, 600, 1_000, 1_001].map(elevGainM => item({ elevGainM })))).toEqual([false, true, true, false]);
    const unknown = acceptanceReport(G800, [item({ elevGainM: null })]).rows[0];
    expect(unknown.valid).toBe(false);
    expect(unknown.reasons).toContain('desnivel');
  });

  it('sin desnivel pedido no lo exige', () => {
    expect(validity(D60, [item({ elevGainM: null })])).toEqual([true]);
  });

  it('rechaza un 21 % de carretera principal y 150 m sin asfaltar', () => {
    const rows = acceptanceReport(D60, [
      item({ road: { ...cleanRoad, mainRoadPct: 21 } }),
      item({ road: { ...cleanRoad, unpavedM: 150 } }),
      item({ road: { ...cleanRoad, mainRoadPct: 20, unpavedM: 100 } }),
    ]).rows;
    expect(rows.map(r => r.valid)).toEqual([false, false, true]);
    expect(rows[0].reasons).toContain('carretera principal');
    expect(rows[1].reasons).toContain('sin asfaltar');
  });

  it('rechaza una vuelta sin datos de carretera', () => {
    expect(validity(D60, [item({ road: null })])).toEqual([false]);
  });

  it('rechaza más de un 15 % de retroceso', () => {
    expect(validity(D60, [item({ backtrackM: 9_000 }), item({ backtrackM: 9_100 })])).toEqual([true, false]);
  });

  it('de dos vueltas que comparten el 75 % de las celdas de la corta solo vale la primera', () => {
    const base = line(40, 20);
    // Tres cuartos sobre la primera y el último cuarto hacia el norte.
    const east = line(40, 7.5);
    const end = east[east.length - 1];
    const shared = [...east, ...Array.from({ length: 10 }, (_, i) => ({ lat: end.lat + (0.25 * (i + 1)) / 111.195, lng: end.lng }))];
    const overlap = cellOverlap(shared, base);
    expect(overlap).toBeGreaterThan(0.72);
    expect(overlap).toBeLessThan(0.8);
    const report = acceptanceReport(D60, [item({ line: base }), item({ line: shared })]);
    expect(report.rows.map(r => r.valid)).toEqual([true, false]);
    expect(report.rows[1].reasons).toContain('solape');
    expect(report.rows[0].maxOverlap).toBeCloseTo(overlap, 5);
    expect(report.rows[1].maxOverlap).toBeCloseTo(overlap, 5);
  });

  it('una vuelta no válida por otra causa no quita la siguiente por solape', () => {
    const base = line(50, 20);
    expect(validity(D60, [item({ line: base, distanceM: 40_000 }), item({ line: base })])).toEqual([false, true]);
  });

  it('pasa con 3 válidas y no con 2', () => {
    const two = acceptanceReport(D60, [item(), item(), item({ distanceM: 1_000 })]);
    expect(two.valid).toBe(2);
    expect(two.passed).toBe(false);
    const three = acceptanceReport(D60, [item(), item(), item()]);
    expect(three.valid).toBe(3);
    expect(three.passed).toBe(true);
  });
});
