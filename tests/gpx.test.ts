import { readFileSync } from 'node:fs';
import { parseGpx } from '../src/import/gpx';
import { expectParseError } from './expect-parse-error';

const rideGpx = readFileSync('tests/fixtures/ride.gpx', 'utf8');

describe('parseGpx', () => {
  it('parses gpx points and time', () => {
    const a = parseGpx(rideGpx);
    expect(a.points).toHaveLength(20);
    expect(a.startTime).toBe(Date.parse('2026-01-04T08:00:00Z'));
    expect(a.points[0]).toMatchObject({ lat: 41, lng: 2.5, ele: 0 });
    expect(a.source).toBe('gpx');
    expect(a.sport).toBe('cycling');
    expect(a.name).toBe('Salida sintetica');
    expect(a.totals.distanceM).toBeGreaterThan(1900);
  });

  it('gpx without time throws ParseError malformed', () => {
    expectParseError(() => parseGpx(rideGpx.replace(/<time>[^<]*<\/time>/g, '')), 'malformed');
  });

  it('reads cadence extension', () => {
    const a = parseGpx(rideGpx);
    expect(a.totals.avgCadence).toBeDefined();
    expect(a.points[1].cad).toBe(90);
    expect(a.points[0].hr).toBe(130);
  });

  it('invalid xml throws ParseError malformed', () => {
    expectParseError(() => parseGpx('<gpx><trk>'), 'malformed');
  });

  it('gpx without points throws ParseError empty', () => {
    expectParseError(() => parseGpx('<gpx version="1.1"><trk><trkseg/></trk></gpx>'), 'empty');
  });

  it('non-gpx xml throws ParseError unsupported', () => {
    expectParseError(() => parseGpx('<kml><Document/></kml>'), 'unsupported');
  });

  it('marks non-cycling track type as other', () => {
    const a = parseGpx(rideGpx.replace('<type>cycling</type>', '<type>running</type>'));
    expect(a.sport).toBe('other');
  });
});
