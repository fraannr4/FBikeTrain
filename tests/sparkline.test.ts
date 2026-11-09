import { sparkPath } from '../src/ui/inicio/sparkPath';

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('sparkPath', () => {
  it('all zero weeks draw a flat line at the bottom', () => {
    const s = sparkPath([0, 0, 0, 0, 0, 0, 0, 0], 200, 34);
    const ys = nums(s.line).filter((_, i) => i % 2 === 1);
    expect(new Set(ys).size).toBe(1);
    expect(s.last.y).toBeGreaterThan(34 / 2);
    expect(s.last.y).toBeLessThanOrEqual(34);
    expect(s.line).not.toContain('NaN');
    expect(s.area).not.toContain('NaN');
  });

  it('last point is the last value', () => {
    const s = sparkPath([10, 40, 20, 30], 200, 34);
    // El valor más alto queda arriba y el último es 30: entre el 20 y el 40.
    const top = sparkPath([10, 40, 20, 40], 200, 34).last.y;
    const bottom = sparkPath([10, 40, 20, 10], 200, 34).last.y;
    expect(s.last.y).toBeGreaterThan(top);
    expect(s.last.y).toBeLessThan(bottom);
    expect(s.last.x).toBeGreaterThan(190);
    expect(s.last.x).toBeLessThanOrEqual(200);
    const lineNums = nums(s.line);
    expect(lineNums.at(-2)).toBeCloseTo(s.last.x, 6);
    expect(lineNums.at(-1)).toBeCloseTo(s.last.y, 6);
  });

  it('mean shares the scale of the values', () => {
    const s = sparkPath([10, 30], 200, 34, 20);
    expect(s.meanY).toBeCloseTo((sparkPath([10, 30], 200, 34).last.y + sparkPath([30, 10], 200, 34).last.y) / 2, 6);
  });

  it('a single value does not break', () => {
    const s = sparkPath([12], 200, 34);
    expect(s.line).not.toContain('NaN');
    expect(Number.isFinite(s.last.x)).toBe(true);
  });
});
