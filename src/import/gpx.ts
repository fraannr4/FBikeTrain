import { ParseError, type ParsedActivity, type TrackPoint } from '../domain/types';
import { computeTotals } from './summary';
import { child, descendants, parseXml, text, toNumber, toTime } from './xml';

/**
 * GPX no trae un deporte fiable. Supuesto: sin `<trk><type>` es ciclismo;
 * con `<type>`, solo cuenta como ciclismo si lo dice (cycling, road_biking, ride...).
 */
function sportFromType(type: string | undefined): ParsedActivity['sport'] {
  if (type === undefined || type.trim() === '') return 'cycling';
  return /cycl|bik|ride/i.test(type) ? 'cycling' : 'other';
}

export function parseGpx(xml: string): ParsedActivity {
  const doc = parseXml(xml);
  if (doc.documentElement?.localName !== 'gpx') throw new ParseError('unsupported', 'No es un fichero GPX');

  const points = descendants(doc, 'trkpt').map((pt): TrackPoint => {
    const t = toTime(text(child(pt, 'time')));
    if (t === undefined) throw new ParseError('malformed', 'Hay puntos del GPX sin hora');
    const point: TrackPoint = { t };
    const lat = toNumber(pt.getAttribute('lat'));
    const lng = toNumber(pt.getAttribute('lon'));
    if (lat !== undefined && lng !== undefined) {
      point.lat = lat;
      point.lng = lng;
    }
    const ele = toNumber(text(child(pt, 'ele')));
    const cad = toNumber(text(descendants(pt, 'cad')[0]));
    const hr = toNumber(text(descendants(pt, 'hr')[0]));
    const power = toNumber(text(descendants(pt, 'power')[0]));
    if (ele !== undefined) point.ele = ele;
    if (cad !== undefined) point.cad = cad;
    if (hr !== undefined) point.hr = hr;
    if (power !== undefined) point.power = power;
    return point;
  });
  if (points.length === 0) throw new ParseError('empty', 'El GPX no tiene puntos de track');

  const trk = descendants(doc, 'trk')[0];
  const name = text(trk && child(trk, 'name'))?.trim();
  return {
    startTime: points[0].t,
    sport: sportFromType(text(trk && child(trk, 'type'))),
    ...(name ? { name } : {}),
    totals: computeTotals(points),
    points,
    source: 'gpx',
  };
}
