import {
  estimateFtp,
  estimateMaxHr,
  FTP_FACTOR_20MIN,
  FTP_MAX_W,
  FTP_MIN_W,
  FTP_WINDOW_S,
  HR_SUSTAIN_S,
  MAX_HR_MAX,
  MAX_HR_MIN,
  validateThresholds,
} from '../src/metrics/thresholds';
import type { TrackPoint } from '../src/domain/types';

const T0 = Date.parse('2026-11-01T09:00:00Z');
const run = (key: 'power' | 'hr', segs: [number, number][]): TrackPoint[] => {
  const pts: TrackPoint[] = [];
  let t = T0;
  let last = 0;
  for (const [v, s] of segs) {
    for (let i = 0; i < s; i++, t += 1000) pts.push({ t, [key]: v });
    last = v;
  }
  pts.push({ t, [key]: last });
  return pts;
};

describe('estimación del FTP desde el historial', () => {
  it('es FTP_FACTOR_20MIN de la mejor media de 20 min de todas las salidas', () => {
    const a = run('power', [[150, 1800]]);
    const b = run('power', [[100, 600], [260, FTP_WINDOW_S], [100, 600]]);
    const e = estimateFtp([a, b])!;
    expect(e.best20W).toBeCloseTo(260, 6);
    expect(e.ftpW).toBe(Math.round(260 * FTP_FACTOR_20MIN));
  });

  it('sin ningún tramo de 20 min con potencia, null', () => {
    expect(estimateFtp([run('power', [[300, FTP_WINDOW_S - 60]])])).toBeNull();
    expect(estimateFtp([run('hr', [[150, 3600]])])).toBeNull();
    expect(estimateFtp([])).toBeNull();
  });

  it('descarta una estimación fuera del rango admitido', () => {
    expect(estimateFtp([run('power', [[20, 3600]])])).toBeNull();
    expect(estimateFtp([run('power', [[(FTP_MAX_W + 100) / FTP_FACTOR_20MIN, 3600]])])).toBeNull();
  });
});

describe('estimación del pulso máximo', () => {
  it('es el mayor pulso sostenido HR_SUSTAIN_S segundos; un pico suelto no cuenta', () => {
    const real = run('hr', [[150, 600], [185, HR_SUSTAIN_S + 5], [150, 600]]);
    const glitch = run('hr', [[150, 300], [240, 1], [150, 300]]);
    expect(estimateMaxHr([real, glitch])).toEqual({ maxHr: 185 });
  });

  it('sin pulso válido, null', () => {
    expect(estimateMaxHr([run('power', [[200, 600]])])).toBeNull();
    expect(estimateMaxHr([run('hr', [[0, 600]])])).toBeNull();
    expect(estimateMaxHr([])).toBeNull();
  });
});

describe('validación de umbrales', () => {
  const ok = { ftpW: 250, maxHr: 185, thresholdHr: 168 };
  it('acepta valores en rango y vacíos como null', () => {
    expect(validateThresholds(ok)).toEqual({ ok: true });
    expect(validateThresholds({ ftpW: null, maxHr: null, thresholdHr: null })).toEqual({ ok: true });
  });
  it('rechaza FTP fuera de rango con el campo y el motivo', () => {
    const r = validateThresholds({ ...ok, ftpW: FTP_MIN_W - 1 });
    expect(r).toMatchObject({ ok: false, errors: { ftpW: expect.stringContaining(String(FTP_MIN_W)) } });
    expect(validateThresholds({ ...ok, ftpW: FTP_MAX_W + 1 })).toMatchObject({ ok: false });
  });
  it('rechaza pulso máximo fuera de rango, y un umbral que no esté por debajo del máximo', () => {
    expect(validateThresholds({ ...ok, maxHr: MAX_HR_MIN - 1 })).toMatchObject({ ok: false });
    expect(validateThresholds({ ...ok, maxHr: MAX_HR_MAX + 1 })).toMatchObject({ ok: false });
    const r = validateThresholds({ ...ok, thresholdHr: 190 });
    expect(r).toMatchObject({ ok: false, errors: { thresholdHr: expect.any(String) } });
  });
  it('rechaza valores no finitos o con decimales', () => {
    expect(validateThresholds({ ...ok, ftpW: Number.NaN })).toMatchObject({ ok: false });
    expect(validateThresholds({ ...ok, maxHr: 185.5 })).toMatchObject({ ok: false });
  });
});
