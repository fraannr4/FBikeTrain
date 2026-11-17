import type { LatLng } from '../src/domain/types';
import { cardinal, windEffect, windSummary } from '../src/routes/wind';

const M_LAT = 111_320;
/** Camino por desplazamientos en metros (este, norte) desde un inicio; cada tramo se parte en pasos de 500 m. */
function path(...legs: [number, number][]): LatLng[] {
  const out: LatLng[] = [{ lat: 41, lng: 2 }];
  const k = Math.cos((41 * Math.PI) / 180);
  for (const [dx, dy] of legs) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 500));
    for (let i = 0; i < n; i++) {
      const p = out[out.length - 1];
      out.push({ lat: p.lat + dy / n / M_LAT, lng: p.lng + dx / n / (M_LAT * k) });
    }
  }
  return out;
}
const circle = (km: number): LatLng[] => {
  const r = (km * 1000) / (2 * Math.PI);
  const k = Math.cos((41 * Math.PI) / 180);
  return Array.from({ length: 361 }, (_, i) => {
    const t = (i / 360) * 2 * Math.PI;
    return { lat: 41 + (r * Math.sin(t)) / M_LAT, lng: 2 + (r * (1 - Math.cos(t))) / (M_LAT * k) };
  });
};

describe('windEffect', () => {
  it('viento de cara: va al norte con viento del norte', () => {
    const e = windEffect(path([0, 10_000]), 0, 20);
    expect(e.halves.first).toBeCloseTo(20, 0);
    expect(e.halves.second).toBeCloseTo(20, 0);
    expect(e.share.head).toBeCloseTo(1, 2);
  });
  it('viento a favor: va al sur con viento del norte', () => {
    const e = windEffect(path([0, -10_000]), 0, 20);
    expect(e.halves.first).toBeCloseTo(-20, 0);
    expect(e.share.tail).toBeCloseTo(1, 2);
  });
  it('viento de lado: va al este con viento del norte', () => {
    const e = windEffect(path([10_000, 0]), 0, 20);
    expect(Math.abs(e.halves.first)).toBeLessThan(0.5);
    expect(e.share.cross).toBeCloseTo(1, 2);
  });
  it('ida y vuelta por la misma carretera: de cara a la ida y a favor al volver', () => {
    const e = windEffect(path([0, 10_000], [0, -10_000]), 0, 20);
    expect(e.halves.first).toBeCloseTo(20, 0);
    expect(e.halves.second).toBeCloseTo(-20, 0);
    expect(e.share.head).toBeCloseTo(0.5, 2);
    expect(e.share.tail).toBeCloseTo(0.5, 2);
  });
  it('una vuelta circular se compensa: media casi nula y un tercio de cada tipo', () => {
    const e = windEffect(circle(60), 300, 20);
    expect((e.halves.first + e.halves.second) / 2).toBeCloseTo(0, 0);
    for (const s of [e.share.head, e.share.tail, e.share.cross]) expect(s).toBeGreaterThan(0.28);
  });
  it('con viento flojo no hay efecto que contar', () => {
    const e = windEffect(path([0, 10_000]), 0, 5);
    expect(e.calm).toBe(true);
    expect(windSummary(e)).toMatch(/flojo/i);
  });
  it('sin tramos devuelve cero y no falla', () => {
    const e = windEffect([{ lat: 41, lng: 2 }], 90, 30);
    expect(e.share).toEqual({ head: 0, tail: 0, cross: 0 });
  });
});

describe('windSummary', () => {
  it('dice la cifra y de dónde sopla', () => {
    expect(windSummary(windEffect(path([0, 10_000]), 315, 18))).toMatch(/18 km\/h del NO/);
  });
  it('de cara toda la vuelta', () => {
    expect(windSummary(windEffect(path([0, 10_000]), 0, 18))).toMatch(/^Viento de cara en la vuelta/);
  });
  it('de cara a la ida y a favor al volver', () => {
    expect(windSummary(windEffect(path([0, 10_000], [0, -10_000]), 0, 18))).toMatch(/De cara a la ida y a favor al volver/);
  });
  it('a favor al volver cuando la ida es de lado', () => {
    // este (de lado con viento norte), luego al sur (a favor)
    expect(windSummary(windEffect(path([10_000, 0], [0, -10_000]), 0, 18))).toMatch(/A favor al volver/);
  });
});

describe('cardinal', () => {
  it.each([[0, 'N'], [44, 'NE'], [90, 'E'], [180, 'S'], [270, 'O'], [315, 'NO'], [359, 'N']])('%i grados es %s', (deg, name) => {
    expect(cardinal(deg)).toBe(name);
  });
});
