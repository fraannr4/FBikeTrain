import { describe, expect, it } from 'vitest';
import { NOVELTY_WEIGHT, CLOSENESS_WEIGHT, scoreCandidate, type Target } from '../src/metrics/score';

const T: Target = { distanceM: 50_000, elevGainM: null, preferNew: true };

describe('scoreCandidate', () => {
  it('weights closeness 0,7 and novelty 0,3', () => {
    expect(CLOSENESS_WEIGHT).toBe(0.7);
    expect(NOVELTY_WEIGHT).toBe(0.3);
    expect(scoreCandidate({ distanceM: 50_000, elevGainM: 0, newPct: 100 }, T)).toBeCloseTo(1, 10);
    expect(scoreCandidate({ distanceM: 50_000, elevGainM: 0, newPct: 0 }, T)).toBeCloseTo(CLOSENESS_WEIGHT, 10);
  });

  it('exact target scores higher than 20 % off', () => {
    const exact = scoreCandidate({ distanceM: 50_000, elevGainM: 0, newPct: 50 }, T);
    const off = scoreCandidate({ distanceM: 60_000, elevGainM: 0, newPct: 50 }, T);
    expect(exact).toBeGreaterThan(off);
    expect(exact - off).toBeCloseTo(CLOSENESS_WEIGHT * 0.2, 10);
  });

  it('elevation target counts when set', () => {
    const c = (elevGainM: number) => ({ distanceM: 50_000, elevGainM, newPct: 50 });
    expect(scoreCandidate(c(100), T)).toBe(scoreCandidate(c(900), T));

    const withElev: Target = { ...T, elevGainM: 500 };
    expect(scoreCandidate(c(500), withElev)).toBeGreaterThan(scoreCandidate(c(900), withElev));
    // Media de las dos dimensiones: distancia exacta (1) y desnivel 80 % fuera (0,2).
    expect(scoreCandidate(c(900), withElev)).toBeCloseTo(CLOSENESS_WEIGHT * 0.6 + NOVELTY_WEIGHT * 0.5, 10);
  });

  it('preferNew false rewards known roads', () => {
    const known: Target = { ...T, preferNew: false };
    const c = (newPct: number) => ({ distanceM: 50_000, elevGainM: 0, newPct });
    expect(scoreCandidate(c(0), known)).toBeGreaterThan(scoreCandidate(c(100), known));
    expect(scoreCandidate(c(100), T)).toBeGreaterThan(scoreCandidate(c(0), T));
  });

  it('stays within 0 and 1 when far off target', () => {
    const s = scoreCandidate({ distanceM: 500_000, elevGainM: 0, newPct: 0 }, T);
    expect(s).toBe(0);
  });

  it('zero elevation target is met only by a flat route, never NaN', () => {
    const flat: Target = { ...T, elevGainM: 0 };
    const c = (elevGainM: number) => ({ distanceM: 50_000, elevGainM, newPct: 100 });
    expect(scoreCandidate(c(0), flat)).toBeCloseTo(1, 10);
    expect(scoreCandidate(c(50), flat)).toBeCloseTo(CLOSENESS_WEIGHT * 0.5 + NOVELTY_WEIGHT, 10);
  });
});
