import { GRADE_LABELS, gradeClass, hardestGrade, profileBands } from '../src/ui/charts/grade';
import { shapePath } from '../src/ui/charts/shape';
import type { LatLng } from '../src/domain/types';
import type { ProfilePoint } from '../src/ui/profile';

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('gradeClass', () => {
  it('maps the grade to the six-colour scale of the prototype', () => {
    expect(gradeClass(-6)).toBe(0);
    expect(gradeClass(0.5)).toBe(0);
    expect(gradeClass(1)).toBe(1);
    expect(gradeClass(3.9)).toBe(1);
    expect(gradeClass(4)).toBe(2);
    expect(gradeClass(7)).toBe(3);
    expect(gradeClass(10)).toBe(4);
    expect(gradeClass(15.9)).toBe(4);
    expect(gradeClass(16)).toBe(5);
    expect(gradeClass(Number.NaN)).toBe(0);
  });

  it('has one label per class', () => {
    expect(GRADE_LABELS).toEqual(['Llano o bajada', '1–4 %', '4–7 %', '7–10 %', '10–16 %', '16 % o más']);
  });
});

// 10 km: 4 km llanos, 3 km al 5 % y 3 km al 8 %.
const climbProfile: ProfilePoint[] = [];
for (let d = 0; d <= 10_000; d += 50) {
  const ele = 300 + Math.max(0, Math.min(d, 7000) - 4000) * 0.05 + Math.max(0, d - 7000) * 0.08;
  climbProfile.push({ dM: d, ele });
}

describe('profileBands', () => {
  it('colours each stretch by its grade and lists the classes present', () => {
    const b = profileBands(climbProfile, { width: 320, height: 72 });
    expect(b).not.toBeNull();
    expect(b!.present).toEqual([0, 2, 3]);
    expect(b!.polygons.map((p) => p.cls)).toEqual([0, 2, 3]);
    for (const p of b!.polygons) for (const v of nums(p.points)) expect(Number.isFinite(v)).toBe(true);
  });

  it('stays inside the box', () => {
    const b = profileBands(climbProfile, { width: 320, height: 72 })!;
    const all = [...b.polygons.flatMap((p) => nums(p.points)), ...nums(b.edge)];
    for (const v of all) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(320);
    }
  });

  it('returns null without at least two points or distance', () => {
    expect(profileBands([], { width: 320, height: 72 })).toBeNull();
    expect(profileBands([{ dM: 0, ele: 100 }], { width: 320, height: 72 })).toBeNull();
    expect(profileBands([{ dM: 0, ele: 100 }, { dM: 0, ele: 120 }], { width: 320, height: 72 })).toBeNull();
  });

  it('a flat profile does not divide by zero', () => {
    const flat = [{ dM: 0, ele: 100 }, { dM: 5000, ele: 100 }];
    const b = profileBands(flat, { width: 320, height: 72 })!;
    expect(b.present).toEqual([0]);
    expect(b.edge).not.toMatch(/NaN|Infinity/);
  });

  it('hardestGrade names the steepest class', () => {
    expect(hardestGrade(climbProfile)).toBe(3);
    expect(hardestGrade([])).toBeNull();
  });
});

describe('shapePath', () => {
  const box = (d: string) => {
    const v = nums(d);
    const xs = v.filter((_, i) => i % 2 === 0);
    const ys = v.filter((_, i) => i % 2 === 1);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };

  it('path stays inside the box', () => {
    const pts: LatLng[] = Array.from({ length: 50 }, (_, i) => ({
      lat: 41.9 + Math.sin(i / 8) * 0.05,
      lng: 2.1 + Math.cos(i / 8) * 0.08,
    }));
    const { d } = shapePath(pts, 100, 60, 6);
    const b = box(d);
    expect(b.minX).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(b.maxX).toBeLessThanOrEqual(94 + 1e-6);
    expect(b.minY).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(b.maxY).toBeLessThanOrEqual(54 + 1e-6);
  });

  it('douglas-peucker keeps the corners of an L', () => {
    const pts: LatLng[] = [];
    for (let i = 0; i <= 100; i++) pts.push({ lat: 41.9 + i * 0.0005, lng: 2.1 });
    for (let i = 1; i <= 100; i++) pts.push({ lat: 41.95, lng: 2.1 + i * 0.0005 });
    const { d } = shapePath(pts, 100, 100, 4);
    expect(d.split(/[ML]/).filter(Boolean)).toHaveLength(3);
  });

  it('a 26.700-point track becomes fewer than 200 vertices', () => {
    const pts: LatLng[] = Array.from({ length: 26_700 }, (_, i) => {
      const t = (i / 26_700) * Math.PI * 2;
      return { lat: 41.9 + Math.sin(t) * 0.1 + Math.sin(t * 9) * 0.004, lng: 2.1 + Math.cos(t) * 0.14 };
    });
    const { d } = shapePath(pts, 100, 100, 4);
    expect(d.split(/[ML]/).filter(Boolean).length).toBeLessThan(200);
  });

  it('single point does not produce NaN', () => {
    const r = shapePath([{ lat: 41.9, lng: 2.1 }], 100, 100, 4);
    expect(r.d).not.toMatch(/NaN/);
    expect(r.start).toEqual({ x: 50, y: 50 });
    expect(shapePath([], 100, 100, 4).d).toBe('');
  });

  it('keeps aspect ratio', () => {
    // 10 km de este a oeste y 2,2 km de norte a sur: la forma es 4,5 veces más ancha que alta.
    const pts: LatLng[] = [
      { lat: 41.9, lng: 2.1 },
      { lat: 41.9, lng: 2.1 + 10_000 / (111_320 * Math.cos((41.91 * Math.PI) / 180)) },
      { lat: 41.9 + 2_200 / 111_320, lng: 2.1 },
    ];
    const b = box(shapePath(pts, 100, 100, 0).d);
    expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(10 / 2.2, 1);
  });

  it('starts at the first point', () => {
    const pts: LatLng[] = [
      { lat: 41.9, lng: 2.1 },
      { lat: 42.0, lng: 2.1 },
    ];
    const r = shapePath(pts, 100, 100, 10);
    expect(r.start.y).toBeCloseTo(90, 5);
  });
});
