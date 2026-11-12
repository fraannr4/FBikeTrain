import { describe, expect, it } from 'vitest';
import type { LatLng } from '../src/domain/types';
import { angleGap, bearingDeg, fitsDiversity, MIN_HEADING_GAP_DEG, routeBearing, sameRoute } from '../src/routes/diversity';
import * as rwgps from '../src/routes/sources/rwgpsProposals';

// Inicio sintético en el mar, no es el de nadie.
const START: LatLng = { lat: 41, lng: 2.5 };
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((START.lat * Math.PI) / 180);

/** Línea recta de ida y vuelta de `km` hacia `deg` (0 norte, 90 este). */
function spoke(km: number, deg: number, n = 40): LatLng[] {
  const a = (deg * Math.PI) / 180;
  const pts: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (km * 1000 * i) / n;
    pts.push({ lat: START.lat + (Math.cos(a) * d) / M_LAT, lng: START.lng + (Math.sin(a) * d) / M_LNG });
  }
  return [...pts, ...[...pts].reverse()];
}

describe('diversity', () => {
  it('usa 45 grados como separación mínima', () => {
    expect(MIN_HEADING_GAP_DEG).toBe(45);
  });

  it('calcula rumbo y diferencia angular a través del norte', () => {
    expect(Math.round(bearingDeg(START, { lat: 41.1, lng: 2.5 }))).toBe(0);
    expect(Math.round(bearingDeg(START, { lat: 41, lng: 2.6 }))).toBe(90);
    expect(angleGap(350, 10)).toBe(20);
    expect(Math.round(routeBearing(spoke(10, 90), START))).toBe(90);
  });

  it('una línea vacía da rumbo 0 sin lanzar', () => {
    expect(routeBearing([], START)).toBe(0);
  });

  it('reexporta bearingDeg y routeBearing desde rwgpsProposals', () => {
    expect(rwgps.bearingDeg).toBe(bearingDeg);
    expect(rwgps.routeBearing).toBe(routeBearing);
  });

  it('dos líneas a 40 grados no caben con 45, y a 50 sí', () => {
    const a = spoke(20, 0);
    expect(fitsDiversity(spoke(20, 40), START, [a])).toBe(false);
    expect(fitsDiversity(spoke(20, 50), START, [a])).toBe(true);
  });

  it('dos líneas que se solapan no caben aunque estén a 90 grados', () => {
    // Mismo tramo de ida y vuelta, pero el punto más lejano de `b` queda en otro rumbo.
    const a = spoke(20, 0);
    const b = [...a.slice(0, 41), ...spoke(1, 90).slice(0, 5)];
    expect(sameRoute(b, a)).toBe(true);
    expect(fitsDiversity(b, START, [a], 0)).toBe(false);
  });

  it('sameRoute distingue rutas separadas', () => {
    expect(sameRoute(spoke(20, 0), spoke(20, 180))).toBe(false);
  });

  it('admite cualquier línea si no hay elegidas', () => {
    expect(fitsDiversity(spoke(20, 0), START, [])).toBe(true);
  });
});
