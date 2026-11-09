import { Decoder, Stream, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import { ParseError, type ParsedActivity, type TrackPoint } from '../domain/types';
import { computeTotals, GPS_SPIKE_SPEED_MS } from './summary';

/** Los FIT guardan lat/lng en semicírculos: 2³¹ semicírculos = 180°. */
const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

const toMs = (v: unknown): number | undefined =>
  v instanceof Date ? v.getTime() : undefined;

function toPoint(r: RecordMesg): TrackPoint | undefined {
  const t = toMs(r.timestamp);
  if (t === undefined) return undefined;
  const point: TrackPoint = { t };
  if (r.positionLat != null && r.positionLong != null) {
    point.lat = r.positionLat * SEMICIRCLE_TO_DEG;
    point.lng = r.positionLong * SEMICIRCLE_TO_DEG;
  }
  const ele = r.enhancedAltitude ?? r.altitude;
  const speed = r.enhancedSpeed ?? r.speed;
  if (ele != null) point.ele = ele;
  if (r.distance != null) point.dist = r.distance;
  if (speed != null) point.speed = speed;
  if (r.cadence != null) point.cad = r.cadence;
  if (r.heartRate != null) point.hr = r.heartRate;
  if (r.power != null) point.power = r.power;
  return point;
}

/**
 * Lee una actividad FIT. Supone una sola sesión (lo normal en ciclismo); si hay varias, usa la primera.
 * Los totales de la sesión del dispositivo prevalecen sobre los calculados desde los puntos.
 */
export function parseFit(buf: ArrayBuffer): ParsedActivity {
  const decoder = new Decoder(Stream.fromArrayBuffer(buf));
  if (!decoder.checkIntegrity()) throw new ParseError('malformed', 'El FIT está dañado o incompleto');
  const { messages, errors } = decoder.read({ convertTypesToStrings: true, applyScaleAndOffset: true });
  if (errors.length > 0) throw new ParseError('malformed', `El FIT no se puede leer: ${errors[0].message}`);

  const points = (messages.recordMesgs ?? []).map(toPoint).filter((p): p is TrackPoint => p !== undefined);
  if (points.length === 0) throw new ParseError('empty', 'El FIT no tiene registros con hora');

  const session: SessionMesg | undefined = messages.sessionMesgs?.[0];
  const totals = computeTotals(points);
  if (session) {
    if (session.totalDistance != null) totals.distanceM = session.totalDistance;
    // totalTimerTime excluye pausas: el más cercano al tiempo en movimiento.
    if (session.totalTimerTime != null) totals.movingTimeS = session.totalTimerTime;
    if (session.totalElapsedTime != null) totals.elapsedTimeS = session.totalElapsedTime;
    if (session.totalAscent != null) totals.elevGainM = session.totalAscent;
    const maxSpeed = session.enhancedMaxSpeed ?? session.maxSpeed;
    // Un máximo del dispositivo por encima de 90 km/h suele ser un pico: queda el de los puntos, ya filtrado.
    if (maxSpeed != null && maxSpeed <= GPS_SPIKE_SPEED_MS) totals.maxSpeedMs = maxSpeed;
    totals.avgSpeedMs = totals.movingTimeS > 0 ? totals.distanceM / totals.movingTimeS : 0;
  }

  const sport = session?.sport ?? messages.sportMesgs?.[0]?.sport;
  return {
    startTime: toMs(session?.startTime) ?? points[0].t,
    sport: sport === 'cycling' ? 'cycling' : 'other',
    totals,
    points,
    source: 'fit',
  };
}
