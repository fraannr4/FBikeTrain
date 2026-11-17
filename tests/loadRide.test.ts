import {
  EST_TSS_PER_100M_CLIMB,
  EST_TSS_PER_HOUR,
  HR_ZONE4_HOUR_TSS,
  MIN_NP_SAMPLES,
  normalizedPower,
  rideLoad,
} from '../src/metrics/load';
import type { ActivityTotals, RiderThresholds, TrackPoint } from '../src/domain/types';

const T0 = Date.parse('2026-11-01T09:00:00Z');
const NONE: RiderThresholds = { ftpW: null, maxHr: null, thresholdHr: null };

function totals(over: Partial<ActivityTotals> = {}): ActivityTotals {
  return { distanceM: 30_000, movingTimeS: 3600, elapsedTimeS: 3700, elevGainM: 0, avgSpeedMs: 8, maxSpeedMs: 12, ...over };
}
/** Un punto por segundo con un valor constante de `key`, `secs` segundos (+1 punto de cierre). */
function steady(key: 'power' | 'hr', value: number, secs: number): TrackPoint[] {
  return Array.from({ length: secs + 1 }, (_, i) => ({ t: T0 + i * 1000, [key]: value }));
}

describe('potencia normalizada (Coggan: media móvil de 30 s, cuarta potencia)', () => {
  it('con potencia constante es esa potencia', () => {
    expect(normalizedPower(steady('power', 200, 600))).toBeCloseTo(200, 6);
  });

  it('coincide con el cálculo a mano: ventanas de 30 s y raíz cuarta de la media de x^4', () => {
    // 30 muestras: 300 W y luego 29 s de 0 W, más una de 0 W. Ventanas: [10 W, 0 W].
    const pts: TrackPoint[] = [
      { t: T0, power: 300 },
      ...Array.from({ length: 30 }, (_, i) => ({ t: T0 + (i + 1) * 1000, power: 0 })),
      { t: T0 + 31_000, power: 0 },
    ];
    expect(normalizedPower(pts)).toBeCloseTo(((10 ** 4 + 0) / 2) ** 0.25, 6);
  });

  it('con carga irregular supera a la media', () => {
    const pts: TrackPoint[] = [];
    for (let i = 0; i <= 600; i++) pts.push({ t: T0 + i * 1000, power: Math.floor(i / 60) % 2 === 0 ? 100 : 300 });
    const avg = pts.reduce((s, p) => s + (p.power ?? 0), 0) / pts.length;
    expect(normalizedPower(pts)!).toBeGreaterThan(avg);
  });

  it('con menos de MIN_NP_SAMPLES segundos de potencia devuelve null', () => {
    expect(normalizedPower(steady('power', 200, MIN_NP_SAMPLES - 2))).toBeNull();
    expect(normalizedPower([])).toBeNull();
    expect(normalizedPower(steady('hr', 150, 600))).toBeNull();
  });
});

describe('carga por salida', () => {
  it('con FTP y potencia en el track: TSS = horas x IF^2 x 100 (1 h al FTP son 100)', () => {
    const l = rideLoad(totals(), steady('power', 200, 3600), { ...NONE, ftpW: 200 });
    expect(l.source).toBe('power');
    expect(l.intensityFactor).toBeCloseTo(1, 6);
    expect(l.normalizedPowerW).toBeCloseTo(200, 6);
    expect(l.tss).toBeCloseTo(100, 4);
  });

  it('media hora a 150 W con FTP 200: IF 0,75 y TSS 28,125', () => {
    const l = rideLoad(totals({ movingTimeS: 1800 }), steady('power', 150, 1800), { ...NONE, ftpW: 200 });
    expect(l.intensityFactor).toBeCloseTo(0.75, 6);
    expect(l.tss).toBeCloseTo(28.125, 4);
  });

  it('sin track pero con potencia media, usa la media como aproximación y lo dice', () => {
    const l = rideLoad(totals({ avgPower: 200 }), undefined, { ...NONE, ftpW: 200 });
    expect(l.source).toBe('power-avg');
    expect(l.tss).toBeCloseTo(100, 4);
  });

  it('con pulso máximo y pulso en el track: 1 h en zona 4 vale HR_ZONE4_HOUR_TSS', () => {
    const l = rideLoad(totals(), steady('hr', 160, 3600), { ...NONE, maxHr: 190 });
    expect(l.source).toBe('hr');
    expect(l.intensityFactor).toBeNull();
    expect(l.tss).toBeCloseTo(HR_ZONE4_HOUR_TSS, 4);
  });

  it('sin track pero con pulso medio, hr-avg', () => {
    const l = rideLoad(totals({ avgHr: 160 }), undefined, { ...NONE, maxHr: 190 });
    expect(l.source).toBe('hr-avg');
    expect(l.tss).toBeCloseTo(HR_ZONE4_HOUR_TSS, 4);
  });

  it('la potencia manda sobre el pulso cuando hay FTP y los dos sensores', () => {
    const pts = steady('power', 200, 3600).map((p) => ({ ...p, hr: 120 }));
    expect(rideLoad(totals(), pts, { ftpW: 200, maxHr: 190, thresholdHr: null }).source).toBe('power');
  });

  it('con potencia pero sin FTP cae al pulso, y sin pulso, a la estimación', () => {
    const pts = steady('power', 200, 3600).map((p) => ({ ...p, hr: 160 }));
    expect(rideLoad(totals(), pts, { ...NONE, maxHr: 190 }).source).toBe('hr');
    expect(rideLoad(totals(), pts, NONE).source).toBe('estimate');
  });

  it('sin sensores estima por duración y desnivel', () => {
    const l = rideLoad(totals({ movingTimeS: 7200, elevGainM: 500 }), undefined, { ...NONE, ftpW: 200, maxHr: 190 });
    expect(l.source).toBe('estimate');
    expect(l.tss).toBeCloseTo(2 * EST_TSS_PER_HOUR + 5 * EST_TSS_PER_100M_CLIMB, 6);
    expect(l.intensityFactor).toBeNull();
  });

  it('una salida sin GPS ni sensores y de duración 0 tiene carga 0, no NaN', () => {
    const l = rideLoad(totals({ movingTimeS: 0, elevGainM: 0 }), undefined, NONE);
    expect(l.tss).toBe(0);
  });

  it('el track con pulso a 0 todo el rato no cuenta como pulso', () => {
    expect(rideLoad(totals(), steady('hr', 0, 600), { ...NONE, maxHr: 190 }).source).toBe('estimate');
  });
});
