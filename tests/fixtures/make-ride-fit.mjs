// Genera tests/fixtures/ride.fit y corrupt.fit con el Encoder de @garmin/fitsdk.
// Datos sintéticos: el mismo recorrido que ride.gpx y ride.tcx, en el mar (lat 41.0, lng 2.5).
// Uso: node tests/fixtures/make-ride-fit.mjs
import { writeFileSync } from 'node:fs';
import { Encoder, Profile } from '@garmin/fitsdk';

const toSemicircles = (deg) => Math.round((deg * 2 ** 31) / 180);
const start = Date.parse('2026-01-04T08:00:00Z');
const at = (s) => new Date(start + s * 1000);
const N = 20;

const encoder = new Encoder();
encoder.onMesg(Profile.MesgNum.FILE_ID, {
  type: 'activity',
  manufacturer: 'development',
  product: 1,
  timeCreated: at(0),
});
encoder.onMesg(Profile.MesgNum.EVENT, { timestamp: at(0), event: 'timer', eventType: 'start' });

for (let i = 0; i < N; i++) {
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: at(i * 10),
    positionLat: toSemicircles(41.0 + i * 0.0009),
    positionLong: toSemicircles(2.5),
    altitude: Math.round(((i * 40) / (N - 1)) * 10) / 10,
    distance: i * 100,
    speed: 10,
    cadence: [85, 90, 95][i % 3],
    heartRate: 130 + i,
    power: 200,
  });
}

const end = at((N - 1) * 10);
encoder.onMesg(Profile.MesgNum.EVENT, { timestamp: end, event: 'timer', eventType: 'stopAll' });
// Totales del "dispositivo": distintos de los calculados (1900 m, 190 s) para comprobar que prevalecen.
const totals = {
  totalDistance: 1950.5,
  totalTimerTime: 185,
  totalElapsedTime: 200,
  totalAscent: 41,
  maxSpeed: 11.2,
};
encoder.onMesg(Profile.MesgNum.LAP, {
  messageIndex: 0,
  timestamp: end,
  startTime: at(0),
  event: 'lap',
  eventType: 'stop',
  ...totals,
});
encoder.onMesg(Profile.MesgNum.SESSION, {
  messageIndex: 0,
  timestamp: end,
  startTime: at(0),
  event: 'session',
  eventType: 'stop',
  sport: 'cycling',
  subSport: 'road',
  firstLapIndex: 0,
  numLaps: 1,
  ...totals,
});
encoder.onMesg(Profile.MesgNum.ACTIVITY, {
  timestamp: end,
  numSessions: 1,
  type: 'manual',
  event: 'activity',
  eventType: 'stop',
});

const bytes = encoder.close();
const corrupt = bytes.slice(0, Math.floor(bytes.length / 2));
writeFileSync(new URL('./ride.fit', import.meta.url), bytes);
writeFileSync(new URL('./corrupt.fit', import.meta.url), corrupt);
console.log(`ride.fit ${bytes.length} bytes, corrupt.fit ${corrupt.length} bytes`);
