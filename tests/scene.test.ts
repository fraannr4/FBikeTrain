import type { ProfilePoint } from '../src/ui/profile';
import {
  climbs,
  DECOR_PROFILE,
  mulberry32,
  nearRidge,
  placeSummitLabel,
  ridgeLayers,
  roadPoints,
} from '../src/ui/scene/scene';

const BOX = { width: 1_000, height: 432, top: 60, bottom: 330 };

/** Números de un `d` de SVG. */
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const vertices = (d: string) => (d.match(/[ML]/g) ?? []).length;

/** Perfil lineal entre nodos [km, m], un punto cada 100 m. */
function profileOf(nodes: [number, number][]): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const [d0, e0] = nodes[k];
    const [d1, e1] = nodes[k + 1];
    for (let d = d0 * 1000; d < d1 * 1000; d += 100) out.push({ dM: d, ele: e0 + ((e1 - e0) * (d - d0 * 1000)) / ((d1 - d0) * 1000) });
  }
  const [dl, el] = nodes[nodes.length - 1];
  out.push({ dM: dl * 1000, ele: el });
  return out;
}

const TWO_CLIMBS = profileOf([
  [0, 100],
  [10, 300],
  [15, 150],
  [25, 400],
  [30, 200],
]);

describe('scene', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('same seed gives same far ridge', () => {
    expect(ridgeLayers(800, 432, 300, 11)[0].d).toBe(ridgeLayers(800, 432, 300, 11)[0].d);
    expect(ridgeLayers(800, 432, 300, 11)[0].d).not.toBe(ridgeLayers(800, 432, 300, 12)[0].d);
  });

  it('four ridge layers, each lower than the one behind', () => {
    for (const seed of [1, 11, 42, 99]) {
      const layers = ridgeLayers(1_000, 432, 300, seed);
      expect(layers).toHaveLength(4);
      for (let k = 1; k < 4; k++) expect(layers[k].mistTop).toBeGreaterThan(layers[k - 1].mistTop);
      for (const l of layers) expect(nums(l.d).every(Number.isFinite)).toBe(true);
    }
  });

  it('near ridge summit is the highest point', () => {
    const profile = profileOf([
      [0, 120],
      [30, 600],
      [52, 992],
      [70, 300],
      [87.6, 60],
    ]);
    const r = nearRidge(profile, BOX);
    expect(r.summit.ele).toBe(992);
    expect(r.summit.dM).toBe(52_000);
    expect(r.summit.x).toBeCloseTo((52 / 87.6) * 1_000, 0);
    // La cima es el punto más alto (menor y) de la línea.
    const ys = nums(r.line).filter((_, i) => i % 2 === 1);
    expect(r.summit.y).toBeCloseTo(Math.min(...ys), 6);
  });

  it('flat profile has no NaN', () => {
    const r = nearRidge(
      [
        { dM: 0, ele: 200 },
        { dM: 5_000, ele: 200 },
      ],
      BOX,
    );
    for (const d of [r.fill, r.line, ...r.contours]) expect(d).not.toContain('NaN');
    expect(Number.isFinite(r.summit.x) && Number.isFinite(r.summit.y)).toBe(true);
  });

  it('single point profile has no NaN', () => {
    const r = nearRidge([{ dM: 0, ele: 200 }], BOX);
    for (const d of [r.fill, r.line, ...r.contours]) expect(d).not.toContain('NaN');
    expect(Number.isFinite(r.summit.x) && Number.isFinite(r.summit.y)).toBe(true);
  });

  it('long track is reduced to at most 240 vertices', () => {
    const long = Array.from({ length: 26_700 }, (_, i) => ({ dM: i * 5, ele: 200 + 100 * Math.sin(i / 900) }));
    const r = nearRidge(long, BOX);
    expect(vertices(r.line)).toBeLessThanOrEqual(240);
    expect(vertices(r.line)).toBeGreaterThan(100);
  });

  it('ten contour lines', () => {
    expect(nearRidge(TWO_CLIMBS, BOX).contours).toHaveLength(10);
  });

  it('climbs finds continuous climbs with enough gain', () => {
    const cs = climbs(TWO_CLIMBS);
    expect(cs).toHaveLength(2);
    expect(cs[0]).toMatchObject({ from: 0, to: 10_000 });
    expect(cs[0].gainM).toBeCloseTo(200, 6);
    expect(cs[1]).toMatchObject({ from: 15_000, to: 25_000 });
    expect(cs[1].gainM).toBeCloseTo(250, 6);
    expect(climbs(TWO_CLIMBS, 300)).toHaveLength(0);
  });

  const roadBox = { width: 30, baseY: 430, summit: { x: 600, y: 90 }, maxAmp: 280 };

  it('one switchback per climb', () => {
    const pts = roadPoints(TWO_CLIMBS, roadBox);
    let turns = 0;
    let dir = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      if (Math.abs(dx) < 1e-9) continue;
      const s = Math.sign(dx);
      if (dir !== 0 && s !== dir) turns++;
      dir = s;
    }
    expect(turns).toBe(2);
  });

  it('road ends at the summit', () => {
    const pts = roadPoints(TWO_CLIMBS, roadBox);
    expect(pts.at(-1)?.x).toBeCloseTo(600, 6);
    expect(pts.at(-1)?.y).toBeCloseTo(90, 6);
    expect(pts[0].y).toBeCloseTo(430, 6);
  });

  it('road narrows towards the summit', () => {
    const pts = roadPoints(TWO_CLIMBS, roadBox);
    for (let i = 1; i < pts.length; i++) expect(pts[i].w).toBeLessThanOrEqual(pts[i - 1].w);
    expect(pts.at(-1)!.w).toBeLessThan(pts[0].w);
  });

  it('flat profile still draws a road without NaN', () => {
    const pts = roadPoints(
      [
        { dM: 0, ele: 100 },
        { dM: 1_000, ele: 100 },
      ],
      roadBox,
    );
    expect(pts.length).toBeGreaterThan(2);
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.w))).toBe(true);
  });

  it('summit label goes right when there is room', () => {
    expect(placeSummitLabel({ x: 500, y: 120 }, { w: 200, h: 40 }, [], 1_000).side).toBe('right');
  });

  it('summit label flips to the left when it would clash', () => {
    const avoid = [{ x: 520, y: 60, w: 300, h: 100 }];
    const p = placeSummitLabel({ x: 500, y: 120 }, { w: 200, h: 40 }, avoid, 1_000);
    expect(p.side).toBe('left');
    expect(p.x + 200).toBeLessThanOrEqual(520);
  });

  it('summit label flips to the left near the right edge and stays inside', () => {
    const p = placeSummitLabel({ x: 950, y: 120 }, { w: 200, h: 40 }, [], 1_000);
    expect(p.side).toBe('left');
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + 200).toBeLessThanOrEqual(992);
  });

  it('summit label rises above the summit when both sides clash', () => {
    // El filo de la cresta a los dos lados, a la altura de la cima.
    const ridge = [380, 420, 580, 620].map((x) => ({ x, y: 118, w: 2, h: 2 }));
    const p = placeSummitLabel({ x: 500, y: 120 }, { w: 200, h: 40 }, ridge, 1_000);
    expect(p.y + 40).toBeLessThanOrEqual(120 - 6);
  });

  it('above the summit, the label slides sideways to dodge the greeting', () => {
    // Los dos lados, ocupados por la cresta; encima, la frase cubre la vertical de la cima.
    const ridge = [380, 420, 580, 620].map((x) => ({ x, y: 118, w: 2, h: 200 }));
    const text = { x: 0, y: 40, w: 470, h: 30 };
    const p = placeSummitLabel({ x: 500, y: 120 }, { w: 200, h: 40 }, [...ridge, text], 1_000);
    expect(p).toMatchObject({ side: 'up', fits: true });
    expect(p.x).toBeGreaterThan(470 + 8);
    expect(p.x).toBeLessThanOrEqual(500 + 16);
    expect(p.y + 40).toBeLessThanOrEqual(120 - 9 - 8);
  });

  it('summit label falls back to its narrow version when only that one fits', () => {
    // A la derecha, el borde del hero; a la izquierda, la frase; encima, la barra superior.
    const avoid = [
      { x: 0, y: 60, w: 300, h: 80 },
      { x: 300, y: 0, w: 400, h: 60 },
    ];
    const p = placeSummitLabel({ x: 500, y: 120 }, { w: 220, h: 40 }, avoid, 700, { w: 140, h: 56 });
    expect(p).toMatchObject({ side: 'right', fits: true, narrow: true });
    expect(p.x + 140).toBeLessThanOrEqual(700 - 8);
    expect(placeSummitLabel({ x: 500, y: 120 }, { w: 220, h: 40 }, avoid, 700).fits).toBe(false);
  });

  it('summit label says it does not fit when every spot clashes', () => {
    const wall = [{ x: 0, y: 0, w: 1_000, h: 400 }];
    expect(placeSummitLabel({ x: 500, y: 120 }, { w: 200, h: 40 }, wall, 1_000).fits).toBe(false);
    expect(placeSummitLabel({ x: 500, y: 120 }, { w: 200, h: 40 }, [], 1_000).fits).toBe(true);
  });

  it('near ridge exposes its vertices for collision checks', () => {
    const r = nearRidge(TWO_CLIMBS, BOX);
    expect(r.points.length).toBe(vertices(r.line));
    expect(r.points.some(([x, y]) => x === r.summit.x && y === r.summit.y)).toBe(true);
  });

  it('decor profile is a usable profile', () => {
    expect(DECOR_PROFILE.length).toBeGreaterThan(10);
    expect(climbs(DECOR_PROFILE).length).toBeGreaterThan(0);
  });
});
