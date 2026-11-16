import { readFileSync } from 'node:fs';
import { descFields, gpxSource, sqlJsonLiteral } from '../src/routes/library/importList';

// GPX sintéticos (mar frente a la costa, 41,0 / 2,5) con la cabecera de cada origen.
const gpx = (metadata: string) => `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata>${metadata}</metadata><trk><name>x</name><trkseg>`
  + '<trkpt lat="41.0" lon="2.5"><ele>10</ele><time>2026-01-01T08:00:00Z</time></trkpt><trkpt lat="41.001" lon="2.5"><ele>12</ele><time>2026-01-01T08:00:10Z</time></trkpt></trkseg></trk></gpx>';

describe('gpxSource con el texto del GPX', () => {
  it('rwgps-<id>.gpx es una ruta de Ride with GPS', () => {
    expect(gpxSource('rwgps-111.gpx', gpx(''))).toEqual({ source: 'rwgps', sourceId: '111', url: 'https://ridewithgps.com/routes/111' });
  });

  it('con enlace de Wikiloc, el id es el número final de la URL', () => {
    const text = gpx('<name>Sintética</name><link href="https://es.wikiloc.com/rutas-ciclismo/ruta-sintetica-123456"><text>Wikiloc</text></link>');
    expect(gpxSource('cualquier-nombre.gpx', text)).toEqual({ source: 'wikiloc', sourceId: '123456', url: 'https://es.wikiloc.com/rutas-ciclismo/ruta-sintetica-123456' });
  });

  it('Wikiloc: ignora el enlace del autor y toma el de la ruta, aunque los puntos lleven <time>', () => {
    const text = gpx('<name>Wikiloc - Sintética</name><author><name>alguien</name><link href="https://www.wikiloc.com/wikiloc/user.do?id=1"><text>alguien on Wikiloc</text></link></author>'
      + '<link href="https://www.wikiloc.com/cycling-trails/ruta-sintetica-987654"><text>Sintética on Wikiloc</text></link><time>2026-01-01T08:00:00Z</time>');
    expect(gpxSource('siete.gpx', text)).toEqual({ source: 'wikiloc', sourceId: '987654', url: 'https://www.wikiloc.com/cycling-trails/ruta-sintetica-987654' });
  });

  it.each([
    ['https://www.komoot.com/es-es/tour/222', 'komoot', '222'],
    ['https://www.bikemap.net/es/r/333/', 'bikemap', '333'],
    ['https://www.strava.com/routes/444', 'strava', '444'],
    ['https://ridewithgps.com/routes/555', 'rwgps', '555'],
  ])('reconoce el enlace %s', (href, source, sourceId) => {
    expect(gpxSource('x.gpx', gpx(`<link href="${href}"/>`))).toEqual({ source, sourceId, url: href });
  });

  it('una actividad de Ride with GPS (/trips/) no es una ruta: queda como otra fuente sin id', () => {
    expect(gpxSource('x.gpx', gpx('<link href="https://ridewithgps.com/trips/666"/>'))).toEqual({ source: 'other', sourceId: null, url: 'https://ridewithgps.com/trips/666' });
  });

  it('sin enlace: otra fuente, sin id ni URL', () => {
    expect(gpxSource('ruta.gpx', gpx('<name>x</name>'))).toEqual({ source: 'other', sourceId: null, url: null });
  });

  it('sin enlace pero con nombre komoot-<id>.gpx: el id del nombre', () => {
    expect(gpxSource('komoot-123.gpx', gpx(''))).toEqual({ source: 'komoot', sourceId: '123', url: 'https://www.komoot.com/tour/123' });
  });
});

describe('gpxSource solo con el nombre', () => {
  it('«komoot-123.gpx» da origen e id', () => {
    expect(gpxSource('komoot-123.gpx')).toEqual({ source: 'komoot', sourceId: '123' });
    expect(gpxSource('bikemap-9.gpx')).toEqual({ source: 'bikemap', sourceId: '9' });
  });

  it('un nombre cualquiera, null', () => {
    expect(gpxSource('ruta.gpx')).toBeNull();
    expect(gpxSource('rwgps-111.gpx')).toBeNull();
  });
});

describe('descFields', () => {
  it('lee las cifras clave=valor del <desc> de metadata', () => {
    const text = gpx('<name>x</name><desc>distance_m=46091;elev_gain_m=906;unpaved_pct=0;track_type=loop</desc>');
    expect(descFields(text)).toEqual({ distanceM: 46091, elevGainM: 906, unpavedPct: 0 });
  });

  it('sin <desc> o sin cifras, nada', () => {
    expect(descFields(gpx(''))).toEqual({});
    expect(descFields(gpx('<desc>Una ruta bonita</desc>'))).toEqual({});
  });
});

describe('sqlJsonLiteral', () => {
  it('envuelve el JSON entre etiquetas de dólar como jsonb', () => {
    expect(sqlJsonLiteral({ a: 1 })).toBe('$tag1${"a":1}$tag1$::jsonb');
  });

  it('si el texto contiene la etiqueta, usa otra que no aparece y no se puede cerrar desde dentro', () => {
    const value = { name: "x $tag1$; drop table reference_routes; -- $tag2$ '" };
    const sql = sqlJsonLiteral(value);
    const tag = /^(\$tag\d+\$)/.exec(sql)![1];
    expect(tag).not.toBe('$tag1$');
    expect(tag).not.toBe('$tag2$');
    expect(sql).toBe(`${tag}${JSON.stringify(value)}${tag}::jsonb`);
    expect(sql.split(tag)).toHaveLength(3);
  });
});

describe('scripts/library-import.ts', () => {
  it('no lleva ID de rutas reales de Ride with GPS', () => {
    const text = readFileSync('scripts/library-import.ts', 'utf8');
    expect(text).not.toMatch(/ridewithgps\.com\/routes\/\d/);
  });
});
