import type { Coord3 } from '../domain/types';

// GPX 1.1 sin `time`: lo que abre la app de iGPSPORT para el BSC200S.

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toGpx(name: string, coords: Coord3[]): string {
  const n = escapeXml(name);
  const pts = coords
    .map(
      ([lng, lat, ele]) =>
        `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`,
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Plataforma de ciclismo" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${n}</name></metadata>`,
    '  <trk>',
    `    <name>${n}</name>`,
    '    <trkseg>',
    pts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

/** Ejemplo: 62.400 m y 849,6 m dan `ruta-62km-850m.gpx`. */
export function gpxFileName(c: { distanceM: number; elevGainM: number }): string {
  return `ruta-${Math.round(c.distanceM / 1000)}km-${Math.round(c.elevGainM)}m.gpx`;
}
