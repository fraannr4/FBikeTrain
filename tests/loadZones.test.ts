import {
  hrZoneIndex,
  HR_ZONE_UPPER_PCT_MAX,
  HR_ZONE_UPPER_PCT_THRESHOLD,
  MAX_GAP_S,
  powerZoneIndex,
  POWER_ZONE_UPPER_PCT_FTP,
  timeInHrZones,
  timeInPowerZones,
} from '../src/metrics/zones';
import type { TrackPoint } from '../src/domain/types';

const FTP = 200;
const T0 = Date.parse('2026-11-01T09:00:00Z');

/** Un punto por segundo; `segs` son [valor, segundos]. El último punto repite el valor para cerrar el último tramo. */
function track(segs: [number | undefined, number][], key: 'power' | 'hr' = 'power'): TrackPoint[] {
  const pts: TrackPoint[] = [];
  let t = T0;
  let last: number | undefined;
  for (const [v, secs] of segs) {
    for (let i = 0; i < secs; i++, t += 1000) pts.push(v === undefined ? { t } : { t, [key]: v });
    last = v;
  }
  pts.push(last === undefined ? { t } : { t, [key]: last });
  return pts;
}

describe('zonas de potencia (Coggan, 7 zonas)', () => {
  it('los límites son los porcentajes publicados y cada límite pertenece a la zona de arriba', () => {
    expect(POWER_ZONE_UPPER_PCT_FTP).toHaveLength(6);
    expect(powerZoneIndex(0, FTP)).toBe(0);
    expect(powerZoneIndex(POWER_ZONE_UPPER_PCT_FTP[0] * FTP - 1, FTP)).toBe(0);
    POWER_ZONE_UPPER_PCT_FTP.forEach((pct, i) => {
      expect(powerZoneIndex(pct * FTP, FTP)).toBe(i + 1);
    });
    expect(powerZoneIndex(10 * FTP, FTP)).toBe(6);
  });

  it('reparte el tiempo por zonas y cuenta el 0 W (sin pedalear) como zona 1', () => {
    const z = timeInPowerZones(track([[100, 600], [190, 600], [0, 300]]), FTP)!;
    expect(z.seconds).toEqual([900, 0, 0, 600, 0, 0, 0]);
    expect(z.totalS).toBe(1500);
  });

  it('un hueco largo entre puntos cuenta como mucho MAX_GAP_S', () => {
    const pts: TrackPoint[] = [
      { t: T0, power: 190 },
      { t: T0 + 10 * 60_000, power: 190 },
    ];
    expect(timeInPowerZones(pts, FTP)!.totalS).toBe(MAX_GAP_S);
  });

  it('sin potencia, con un solo punto o sin FTP válido devuelve null, no ceros', () => {
    expect(timeInPowerZones(track([[undefined, 60]]), FTP)).toBeNull();
    expect(timeInPowerZones([{ t: T0, power: 150 }], FTP)).toBeNull();
    expect(timeInPowerZones([], FTP)).toBeNull();
    expect(timeInPowerZones(track([[150, 60]]), 0)).toBeNull();
  });

  it('ignora lecturas imposibles y los puntos sin potencia', () => {
    const z = timeInPowerZones(track([[150, 60], [undefined, 60], [-5, 60], [Number.NaN, 60]]), FTP)!;
    expect(z.totalS).toBe(60);
  });
});

describe('zonas de pulso (5 zonas)', () => {
  it('con pulso máximo usa el porcentaje del máximo', () => {
    const max = 190;
    expect(HR_ZONE_UPPER_PCT_MAX).toHaveLength(4);
    expect(hrZoneIndex(100, { maxHr: max, thresholdHr: null })).toBe(0);
    HR_ZONE_UPPER_PCT_MAX.forEach((pct, i) => {
      expect(hrZoneIndex(pct * max, { maxHr: max, thresholdHr: null })).toBe(i + 1);
    });
  });

  it('con pulso de umbral usa el porcentaje del umbral, aunque haya máximo', () => {
    const th = { maxHr: 190, thresholdHr: 170 };
    expect(HR_ZONE_UPPER_PCT_THRESHOLD).toHaveLength(4);
    HR_ZONE_UPPER_PCT_THRESHOLD.forEach((pct, i) => {
      expect(hrZoneIndex(pct * th.thresholdHr, th)).toBe(i + 1);
    });
    expect(hrZoneIndex(1, th)).toBe(0);
  });

  it('sin ninguno de los dos no hay zonas', () => {
    expect(hrZoneIndex(150, { maxHr: null, thresholdHr: null })).toBeNull();
    expect(timeInHrZones(track([[150, 60]], 'hr'), { maxHr: null, thresholdHr: null })).toBeNull();
  });

  it('descarta pulso 0 (sensor soltado) y reparte el resto', () => {
    const th = { maxHr: 200, thresholdHr: null };
    const z = timeInHrZones(track([[0, 120], [170, 300], [110, 60]], 'hr'), th)!;
    expect(z.totalS).toBe(360);
    expect(z.seconds).toEqual([60, 0, 0, 300, 0]);
  });

  it('una salida sin pulso devuelve null', () => {
    expect(timeInHrZones(track([[undefined, 600]], 'hr'), { maxHr: 190, thresholdHr: null })).toBeNull();
  });
});
