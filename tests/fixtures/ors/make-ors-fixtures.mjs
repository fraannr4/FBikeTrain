// Genera fixtures SINTÉTICOS de ORS con la forma documentada de
// POST /v2/directions/cycling-road/geojson (elevation + extra_info).
// No son respuestas grabadas: se sustituirán por las reales de la tarea 1 de F4.
// Recorrido: un círculo de ~30 km que empieza en la Puerta del Sol (punto público),
// no una ruta por carreteras reales.
// Uso: node tests/fixtures/ors/make-ors-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const START = { lat: 40.4168, lng: -3.7038 };
const LENGTH = 30000;
const N = 60; // segmentos; N + 1 puntos, el último igual al primero
const R = LENGTH / (2 * Math.PI);
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((START.lat * Math.PI) / 180);
const round = (x, d) => Number(x.toFixed(d));

// El centro queda al norte del inicio, así el punto 0 es la Puerta del Sol.
const center = { lat: START.lat + R / M_PER_DEG_LAT, lng: START.lng };
const coords = [];
for (let i = 0; i <= N; i++) {
  const a = -Math.PI / 2 + (2 * Math.PI * (i % N)) / N;
  const lat = center.lat + (R * Math.sin(a)) / M_PER_DEG_LAT;
  const lng = center.lng + (R * Math.cos(a)) / mPerDegLng;
  const ele = 650 + 60 * Math.sin((2 * Math.PI * (i % N)) / N);
  coords.push([round(lng, 6), round(lat, 6), round(ele, 1)]);
}

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const segLen = coords.slice(1).map((c, i) => haversine(coords[i], c));
const total = segLen.reduce((s, x) => s + x, 0);
const span = (from, to) => segLen.slice(from, to).reduce((s, x) => s + x, 0);

function extra(values) {
  const byValue = new Map();
  for (const [from, to, v] of values) byValue.set(v, (byValue.get(v) ?? 0) + span(from, to));
  const summary = [...byValue.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, distance]) => ({ value, distance: round(distance, 1), amount: round((distance / total) * 100, 2) }));
  return { values, summary };
}

let ascent = 0;
let descent = 0;
for (let i = 1; i < coords.length; i++) {
  const d = coords[i][2] - coords[i - 1][2];
  if (d > 0) ascent += d;
  else descent -= d;
}

// Superficie: 3 Asphalt casi todo, un tramo 1 Paved.
const surface = extra([
  [0, 40, 3],
  [40, 44, 1],
  [44, N, 3],
]);
// Tipo de vía: 3 Street al salir y llegar, 2 Road en medio, un tramo 1 State Road.
const waytypes = extra([
  [0, 3, 3],
  [3, 25, 2],
  [25, 31, 1],
  [31, 57, 2],
  [57, N, 3],
]);
// Pendiente: sube en la primera mitad y baja en la segunda.
const steepness = extra([
  [0, 15, 1],
  [15, 30, 0],
  [30, 45, -1],
  [45, N, 0],
]);

const lats = coords.map((c) => c[1]);
const lngs = coords.map((c) => c[0]);
const eles = coords.map((c) => c[2]);
const bbox = [
  Math.min(...lngs),
  Math.min(...lats),
  Math.min(...eles),
  Math.max(...lngs),
  Math.max(...lats),
  Math.max(...eles),
];
const duration = round(total / 6.5, 1);
const summary = { distance: round(total, 1), duration, ascent: round(ascent, 1), descent: round(descent, 1) };

const ok = {
  type: 'FeatureCollection',
  bbox,
  features: [
    {
      bbox,
      type: 'Feature',
      properties: {
        ascent: summary.ascent,
        descent: summary.descent,
        segments: [{ ...summary }],
        extras: { surface, waytypes, steepness },
        way_points: [0, N],
        summary,
      },
      geometry: { coordinates: coords, type: 'LineString' },
    },
  ],
  metadata: {
    attribution: 'openrouteservice.org | OpenStreetMap contributors',
    service: 'routing',
    timestamp: 1793952000000,
    query: {
      coordinates: [[START.lng, START.lat]],
      profile: 'cycling-road',
      format: 'geojson',
      elevation: true,
      instructions: false,
      extra_info: ['surface', 'waytype', 'steepness'],
      options: {
        avoid_features: ['ferries', 'fords', 'steps'],
        round_trip: { length: LENGTH, points: 4, seed: 1 },
      },
    },
    engine: { version: 'sintetico', build_date: '2026-11-06T00:00:00Z', graph_date: '2026-11-06T00:00:00Z' },
  },
};

const noRoute = {
  error: {
    code: 2010,
    message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 0: 1.5000000 40.0000000.',
  },
  info: { engine: { version: 'sintetico', build_date: '2026-11-06T00:00:00Z' }, timestamp: 1793952000000 },
};

writeFileSync(join(here, 'round-trip-ok.json'), JSON.stringify(ok, null, 2) + '\n');
writeFileSync(join(here, 'no-route-404.json'), JSON.stringify(noRoute, null, 2) + '\n');
console.log(`round-trip-ok.json: ${coords.length} puntos, ${summary.distance} m, +${summary.ascent} m`);
