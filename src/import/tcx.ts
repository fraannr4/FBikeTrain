import type { Element } from '@xmldom/xmldom';
import { ParseError, type ParsedActivity, type TrackPoint } from '../domain/types';
import { computeTotals, GPS_SPIKE_SPEED_MS } from './summary';
import { child, descendants, parseXml, text, toNumber, toTime } from './xml';

/** Valores numéricos de un hijo directo de cada lap (los que lo traen). */
function lapValues(laps: Element[], name: string): number[] {
  return laps.map((lap) => toNumber(text(child(lap, name)))).filter((v): v is number => v !== undefined);
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Lee la primera actividad del TCX. Los totales de lap del dispositivo prevalecen sobre los calculados. */
export function parseTcx(xml: string): ParsedActivity {
  const doc = parseXml(xml);
  if (doc.documentElement?.localName !== 'TrainingCenterDatabase') {
    throw new ParseError('unsupported', 'No es un fichero TCX');
  }
  const activity = descendants(doc, 'Activity')[0];
  const trackpoints = activity ? descendants(activity, 'Trackpoint') : [];
  if (trackpoints.length === 0) throw new ParseError('empty', 'El TCX no tiene puntos de track');

  const points = trackpoints.map((tp): TrackPoint => {
    const t = toTime(text(child(tp, 'Time')));
    if (t === undefined) throw new ParseError('malformed', 'Hay puntos del TCX sin hora');
    const point: TrackPoint = { t };
    const position = child(tp, 'Position');
    const lat = toNumber(text(position && child(position, 'LatitudeDegrees')));
    const lng = toNumber(text(position && child(position, 'LongitudeDegrees')));
    if (lat !== undefined && lng !== undefined) {
      point.lat = lat;
      point.lng = lng;
    }
    const hrBpm = child(tp, 'HeartRateBpm');
    const ele = toNumber(text(child(tp, 'AltitudeMeters')));
    const dist = toNumber(text(child(tp, 'DistanceMeters')));
    const hr = toNumber(text(hrBpm && child(hrBpm, 'Value')));
    const cad = toNumber(text(child(tp, 'Cadence')));
    const power = toNumber(text(descendants(tp, 'Watts')[0]));
    if (ele !== undefined) point.ele = ele;
    if (dist !== undefined) point.dist = dist;
    if (hr !== undefined) point.hr = hr;
    if (cad !== undefined) point.cad = cad;
    if (power !== undefined) point.power = power;
    return point;
  });

  const totals = computeTotals(points);
  const laps = descendants(activity, 'Lap');
  const lapDistances = lapValues(laps, 'DistanceMeters');
  const lapTimes = lapValues(laps, 'TotalTimeSeconds');
  const lapMaxSpeeds = lapValues(laps, 'MaximumSpeed');
  if (lapDistances.length > 0) totals.distanceM = sum(lapDistances);
  // TotalTimeSeconds es el tiempo de cronómetro (sin pausas): el más cercano al tiempo en movimiento.
  if (lapTimes.length > 0) totals.movingTimeS = sum(lapTimes);
  // Un máximo del dispositivo por encima de 90 km/h suele ser un pico: queda el de los puntos, ya filtrado.
  const lapMaxSpeed = Math.max(...lapMaxSpeeds);
  if (lapMaxSpeeds.length > 0 && lapMaxSpeed <= GPS_SPIKE_SPEED_MS) totals.maxSpeedMs = lapMaxSpeed;
  totals.avgSpeedMs = totals.movingTimeS > 0 ? totals.distanceM / totals.movingTimeS : 0;

  return {
    startTime: points[0].t,
    sport: activity.getAttribute('Sport') === 'Biking' ? 'cycling' : 'other',
    totals,
    points,
    source: 'tcx',
  };
}
