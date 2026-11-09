import { readFileSync } from 'node:fs';
import { parseTcx } from '../src/import/tcx';
import { computeTotals, GPS_SPIKE_SPEED_MS } from '../src/import/summary';
import { ParseError } from '../src/domain/types';
import { expectParseError } from './expect-parse-error';

const rideTcx = readFileSync('tests/fixtures/ride.tcx', 'utf8');

describe('parseTcx', () => {
  it('parses tcx', () => {
    const a = parseTcx(rideTcx);
    expect(a.sport).toBe('cycling');
    expect(a.source).toBe('tcx');
    expect(a.points).toHaveLength(20);
    expect(a.startTime).toBe(Date.parse('2026-01-04T08:00:00Z'));
    // Los puntos suman 1900 m; el lap dice 1950,5 m y prevalece.
    expect(a.totals.distanceM).toBe(1950.5);
  });

  it('lap totals override computed time and max speed', () => {
    const a = parseTcx(rideTcx);
    expect(a.totals.movingTimeS).toBe(190);
    expect(a.totals.maxSpeedMs).toBe(11.2);
    expect(a.totals.avgSpeedMs).toBeCloseTo(1950.5 / 190, 6);
    expect(a.totals.avgCadence).toBeDefined();
  });

  it('absurd lap max speed is ignored in favour of the filtered points', () => {
    const a = parseTcx(rideTcx.replace(/<MaximumSpeed>[^<]*</, '<MaximumSpeed>297<'));
    expect(a.totals.maxSpeedMs).toBe(computeTotals(a.points).maxSpeedMs);
    expect(a.totals.maxSpeedMs).toBeLessThanOrEqual(GPS_SPIKE_SPEED_MS);
  });

  it('reads trackpoint fields', () => {
    const a = parseTcx(rideTcx);
    expect(a.points[1]).toMatchObject({ lat: 41.0009, lng: 2.5, ele: 2.1, dist: 100, hr: 131, cad: 90 });
  });

  it('marks non-biking sport as other', () => {
    expect(parseTcx(rideTcx.replace('Sport="Biking"', 'Sport="Running"')).sport).toBe('other');
  });

  it('trackpoints without position keep no lat/lng (rodillo)', () => {
    const indoor = rideTcx.replace(/<Position>.*?<\/Position>/g, '');
    const a = parseTcx(indoor);
    expect(a.points[0].lat).toBeUndefined();
    expect(a.totals.distanceM).toBe(1950.5);
  });

  it('invalid xml throws ParseError malformed', () => {
    expect(() => parseTcx('<TrainingCenterDatabase><Activities>')).toThrow(ParseError);
  });

  it('tcx without trackpoints throws ParseError empty', () => {
    expectParseError(
      () => parseTcx('<TrainingCenterDatabase><Activities><Activity Sport="Biking"/></Activities></TrainingCenterDatabase>'),
      'empty',
    );
  });
});
