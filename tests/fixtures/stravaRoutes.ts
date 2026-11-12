// Rutas planificadas sintéticas con la forma supuesta de las de `routes/` en la exportación de Strava
// (GPX 1.1 con un track, alturas y sin horas). Todas en el mar frente a la costa (lat 41.0, lng 2.5).
// `offset` desplaza la ruta hacia el norte para que dos rutas tengan geometrías distintas.

export function routeGpx(name: string, opts: { offset?: number; type?: string; points?: number } = {}): string {
  const n = opts.points ?? 4;
  const pts = Array.from({ length: n }, (_, i) => `<trkpt lat="${(41 + (opts.offset ?? 0) + i * 0.001).toFixed(5)}" lon="2.5"><ele>${i * 5}</ele></trkpt>`);
  const type = opts.type === undefined ? '' : `<type>${opts.type}</type>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?><gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">' +
    `<metadata><name>${name}</name></metadata><trk><name>${name}</name>${type}<trkseg>${pts.join('')}</trkseg></trk></gpx>`
  );
}

export const routeTcx = (name: string) =>
  `<TrainingCenterDatabase><Courses><Course><Name>${name}</Name><Track>` +
  '<Trackpoint><Position><LatitudeDegrees>41.1</LatitudeDegrees><LongitudeDegrees>2.5</LongitudeDegrees></Position></Trackpoint>' +
  '<Trackpoint><Position><LatitudeDegrees>41.101</LatitudeDegrees><LongitudeDegrees>2.5</LongitudeDegrees></Position></Trackpoint>' +
  '</Track></Course></Courses></TrainingCenterDatabase>';
