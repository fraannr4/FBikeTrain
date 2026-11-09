import { DOMParser, onErrorStopParsing, type Document, type Element } from '@xmldom/xmldom';
import { gpxFileName, toGpx } from '../src/routes/gpx';
import type { Coord3 } from '../src/domain/types';

const coords: Coord3[] = [
  [-3.7038, 40.4168, 650],
  [-3.7, 40.42, 655.25],
  [-3.69, 40.43, 660.04],
];

function parse(xml: string): Document {
  return new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'text/xml');
}

function children(el: Element, name: string): Element[] {
  return Array.from(el.childNodes).filter(
    (n): n is Element => n.nodeType === n.ELEMENT_NODE && (n as Element).localName === name,
  );
}

describe('toGpx', () => {
  it('gpx 1.1 root with namespace', () => {
    const xml = toGpx('Vuelta', coords);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = parse(xml).documentElement!;
    expect(root.localName).toBe('gpx');
    expect(root.getAttribute('version')).toBe('1.1');
    expect(root.namespaceURI).toBe('http://www.topografix.com/GPX/1/1');
    expect(root.getAttribute('creator')?.trim()).toBeTruthy();
  });

  it('one trk with one trkseg and all points', () => {
    const root = parse(toGpx('Vuelta', coords)).documentElement!;
    const trks = children(root, 'trk');
    expect(trks).toHaveLength(1);
    const segs = children(trks[0], 'trkseg');
    expect(segs).toHaveLength(1);
    expect(children(segs[0], 'trkpt')).toHaveLength(3);
  });

  it('trkpt has lat lon attributes and ele child', () => {
    const root = parse(toGpx('Vuelta', coords)).documentElement!;
    const pts = children(children(children(root, 'trk')[0], 'trkseg')[0], 'trkpt');
    expect(pts[0].getAttribute('lat')).toBe('40.416800');
    expect(pts[0].getAttribute('lon')).toBe('-3.703800');
    expect(children(pts[0], 'ele')[0].textContent).toBe('650.0');
    expect(children(pts[1], 'ele')[0].textContent).toBe('655.3');
  });

  it('no time elements', () => {
    const doc = parse(toGpx('Vuelta', coords));
    expect(doc.getElementsByTagNameNS('*', 'time')).toHaveLength(0);
  });

  it('metadata name and trk name match', () => {
    const root = parse(toGpx('Vuelta', coords)).documentElement!;
    const metaName = children(children(root, 'metadata')[0], 'name')[0].textContent;
    const trkName = children(children(root, 'trk')[0], 'name')[0].textContent;
    expect(metaName).toBe('Vuelta');
    expect(trkName).toBe('Vuelta');
  });

  it('escapes name', () => {
    const xml = toGpx('Vuelta & <Sol> "a" \'b\'', coords);
    expect(xml).toContain('Vuelta &amp; &lt;Sol&gt;');
    const root = parse(xml).documentElement!;
    expect(children(children(root, 'trk')[0], 'name')[0].textContent).toBe('Vuelta & <Sol> "a" \'b\'');
  });
});

describe('gpxFileName', () => {
  it('file name rounds km and m', () => {
    expect(gpxFileName({ distanceM: 62_400, elevGainM: 849.6 })).toBe('ruta-62km-850m.gpx');
  });
});
