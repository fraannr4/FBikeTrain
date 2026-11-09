import { readFileSync } from 'node:fs';
import { Encoder, Profile, type FileIdMesg, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import { parseFit } from '../src/import/fit';
import { GPS_SPIKE_SPEED_MS } from '../src/import/summary';
import { expectParseError } from './expect-parse-error';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const fixture = (name: string) => toArrayBuffer(readFileSync(`tests/fixtures/${name}`));

const START = Date.parse('2026-01-04T08:00:00Z');

/** FIT mínimo en memoria para casos que el fixture no cubre (otro deporte, sin GPS, sin sesión). */
function encodeFit(opts: { sport: string; gps: boolean; session: boolean; maxSpeed?: number }): ArrayBuffer {
  const at = (s: number) => new Date(START + s * 1000);
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: at(0) } as FileIdMesg);
  for (let i = 0; i < 5; i++) {
    const gps = opts.gps ? { positionLat: Math.round(((41 + i * 0.0009) * 2 ** 31) / 180), positionLong: Math.round((2.5 * 2 ** 31) / 180) } : {};
    enc.onMesg(Profile.MesgNum.RECORD, { timestamp: at(i * 10), distance: i * 100, speed: 10, ...gps } as RecordMesg);
  }
  if (opts.session) {
    enc.onMesg(Profile.MesgNum.SESSION, {
      timestamp: at(40), startTime: at(0), sport: opts.sport, totalDistance: 400, totalTimerTime: 40, totalElapsedTime: 40,
      ...(opts.maxSpeed === undefined ? {} : { maxSpeed: opts.maxSpeed }),
    } as SessionMesg);
  }
  return toArrayBuffer(enc.close());
}

describe('parseFit', () => {
  it('uses session totals when present', () => {
    const a = parseFit(fixture('ride.fit'));
    // Los puntos suman 1900 m y 190 s; la sesión dice 1950,5 m, 185 s de cronómetro y 200 s totales.
    expect(a.totals.distanceM).toBe(1950.5);
    expect(a.totals.movingTimeS).toBe(185);
    expect(a.totals.elapsedTimeS).toBe(200);
    expect(a.totals.elevGainM).toBe(41);
    expect(a.totals.maxSpeedMs).toBe(11.2);
    expect(a.totals.avgSpeedMs).toBeCloseTo(1950.5 / 185, 6);
  });

  it('absurd session max speed is ignored in favour of the filtered points', () => {
    const a = parseFit(encodeFit({ sport: 'cycling', gps: true, session: true, maxSpeed: 60 })); // el FIT guarda maxSpeed en uint16/1000: tope 65,5 m/s
    expect(a.totals.maxSpeedMs).toBe(10);
  });

  it('session max speed at the spike threshold is kept', () => {
    const a = parseFit(encodeFit({ sport: 'cycling', gps: true, session: true, maxSpeed: GPS_SPIKE_SPEED_MS }));
    expect(a.totals.maxSpeedMs).toBe(GPS_SPIKE_SPEED_MS);
  });

  it('maps sport cycling', () => {
    const a = parseFit(fixture('ride.fit'));
    expect(a.sport).toBe('cycling');
    expect(a.source).toBe('fit');
    expect(a.startTime).toBe(START);
    expect(a.points).toHaveLength(20);
  });

  it('semicircles converted to degrees', () => {
    const a = parseFit(fixture('ride.fit'));
    expect(a.points[0].lat).toBeCloseTo(41.0, 3);
    expect(a.points[0].lng).toBeCloseTo(2.5, 3);
    expect(a.points[1]).toMatchObject({ t: START + 10_000, dist: 100, speed: 10, cad: 90, hr: 131, power: 200 });
    expect(a.points[1].ele).toBeCloseTo(2.2, 6);
  });

  it('corrupt fit throws ParseError malformed', () => {
    expectParseError(() => parseFit(fixture('corrupt.fit')), 'malformed');
  });

  it('non-fit bytes throw ParseError malformed', () => {
    expectParseError(() => parseFit(new TextEncoder().encode('<gpx></gpx>').buffer as ArrayBuffer), 'malformed');
  });

  it('maps non-cycling sport as other', () => {
    expect(parseFit(encodeFit({ sport: 'running', gps: true, session: true })).sport).toBe('other');
  });

  it('indoor ride without gps keeps points without lat/lng', () => {
    const a = parseFit(encodeFit({ sport: 'cycling', gps: false, session: true }));
    expect(a.sport).toBe('cycling');
    expect(a.points).toHaveLength(5);
    expect(a.points[0].lat).toBeUndefined();
    expect(a.totals.distanceM).toBe(400);
  });

  it('falls back to computed totals without session', () => {
    const a = parseFit(encodeFit({ sport: 'cycling', gps: true, session: false }));
    expect(a.totals.distanceM).toBe(400);
    expect(a.totals.movingTimeS).toBe(40);
  });
});
