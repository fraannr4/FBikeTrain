import type { Coord3 } from '../src/routes/analyze';
import { geometryQuality } from '../src/routes/quality';

// Dibujo matemático sintético en el mar. Distancias en metros, ninguna ruta GPS real.
const at = ([x, y]: number[]): Coord3 => [2.5 + x / (111320 * Math.cos(41 * Math.PI / 180)), 41 + y / 111320, 100];
const path = (p: number[][]) => p.map(at);
const loop = [[0, 0], [5000, 0], [5000, 5000], [0, 5000], [0, 0]];

describe('geometryQuality', () => {
  it('does not penalize a simple loop or sparse straight segments', () => {
    expect(geometryQuality(path(loop)).penalty).toBe(0);
    expect(geometryQuality(path([[0, 0], [10000, 0]] )).penalty).toBe(0);
    expect(geometryQuality([]).penalty).toBe(0);
  });

  it('detects an out-and-back spur inside an otherwise circular route', () => {
    const q = geometryQuality(path([[0,0], [0,-1000], [0,0], ...loop.slice(1)]));
    expect(q.backtrackM).toBeGreaterThan(800);
    expect(q.penalty).toBeGreaterThan(0);
  });

  it('detects local loops on adjacent streets without requiring exact repeated coordinates', () => {
    const q = geometryQuality(path([[0,0], [1000,0], [1000,200], [1200,200], [1200,8], [1000,8], ...loop.slice(1)]));
    expect(q.localLoops).toBeGreaterThan(0);
    expect(q.penalty).toBeGreaterThan(0);
  });

  it('does not confuse a normal figure eight, a crossing or a hairpin with retracing a road', () => {
    const eight = [[0,0], [3000,3000], [6000,0], [3000,-3000], [0,0], [-3000,3000], [-6000,0], [-3000,-3000], [0,0]];
    expect(geometryQuality(path(eight)).penalty).toBe(0);
    expect(geometryQuality(path([[0,0], [1000,0], [1000,80], [0,80]])).penalty).toBe(0);
  });

  it('has the same result with dense or sparse ORS vertices and preserves the geometry', () => {
    const sparse = path([[0,0], [1000,0], [0,0], ...loop.slice(1)]);
    const before = structuredClone(sparse);
    const dense: Coord3[] = [];
    for (let i = 1; i < sparse.length; i++) for (let j = 0; j < 100; j++) {
      const a = sparse[i - 1], b = sparse[i];
      dense.push([a[0] + (b[0] - a[0]) * j / 100, a[1] + (b[1] - a[1]) * j / 100, 100]);
    }
    dense.push(sparse[sparse.length - 1]);
    const a = geometryQuality(dense), b = geometryQuality(sparse);
    expect(a.backtrackM).toBe(b.backtrackM);
    expect(a.localLoops).toBe(b.localLoops);
    expect(a.penalty).toBeCloseTo(b.penalty, 6);
    expect(sparse).toEqual(before);
  });
});
