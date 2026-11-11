/** Diagnóstico opt-in: solo escribe cifras, nunca geometrías ni credenciales. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateRoutes } from '../src/routes/generator';
import { buildOrsBody, orsExtras } from '../src/routes/shared/orsService';
import { OrsError, type OrsFeature } from '../src/routes/ors';
import { geometryQuality } from '../src/routes/quality';
import { routeSide } from '../src/routes/side';

const phase = process.argv[2] ?? 'before';
const secretPath = process.env.ORS_SECRETS_FILE ?? 'C:/testTrain/.local-secrets/credenciales.md';
const key = process.env.ORS_API_KEY ?? /^ORS_API_KEY\s*[:=]\s*[`"']?([^\s`"']+)/m.exec(readFileSync(secretPath, 'utf8'))?.[1];
if (!key) throw new Error('No se encuentra ORS_API_KEY en el archivo local.');
// Inicio público de prueba en Granollers, ajeno a la dirección Casa del usuario.
const start = { lat: 41.6079, lng: 2.2874 };
const cases = [40, 60, 90].flatMap(km => [{ km, gain: km * 5, label: 'llano' }, { km, gain: km * 15, label: 'desnivel' }]);
const path = 'docs/diagnostico-rutas-2026-11-11-cifras.json';
const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
const measurements: unknown[] = [];
let lastCall = 0;
const access = { fetch: async (request: Parameters<typeof buildOrsBody>[0], signal?: AbortSignal): Promise<OrsFeature> => {
  const pause = Math.max(0, 2200 - (Date.now() - lastCall));
  if (pause) await new Promise(resolve => setTimeout(resolve, pause));
  lastCall = Date.now();
  const response = await fetch('https://api.openrouteservice.org/v2/directions/cycling-road/geojson', {
    method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildOrsBody(request)), signal: signal ?? AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new OrsError(response.status === 429 ? 'rate_minute' : 'server', `ORS HTTP ${response.status}`);
  const data = await response.json();
  const feature = data.features?.[0] as OrsFeature | undefined;
  if (!feature) throw new OrsError('no_route', 'ORS no devolvió una ruta');
  feature.properties.extras = orsExtras(feature.properties.extras) as OrsFeature['properties']['extras'];
  return feature;
} };
for (const c of cases) {
  const routes = [];
  const usedSides: number[] = [];
  let requests = 0;
  const rejected = [];
  for (let option = 0; option < 3; option++) {
    const result = await generateRoutes({ start, target: { distanceM: c.km * 1000, elevGainM: c.gain, preferNew: true }, count: 1, seeds: 2,
      ...(phase === 'after' ? { usedSides } : {}) },
    { apiKey: access, reference: null, visited: new Set(), seedBase: 1100 + option * 1100 });
    requests += result.requestsUsed;
    rejected.push(...result.rejected);
    for (const route of result.routes) {
      const side = routeSide(route.coords, start);
      usedSides.push(side);
      const shape = geometryQuality(route.coords);
      routes.push({ option: option + 1, seed: route.seed, km: +(route.distanceM / 1000).toFixed(2), ascentM: Math.round(route.elevGainM),
        mainRoadPct: +route.mainRoadPct.toFixed(2), backtrackM: shape.backtrackM, localLoops: shape.localLoops,
        distanceErrorPct: +((route.distanceM / (c.km * 1000) - 1) * 100).toFixed(2),
        ascentErrorM: Math.round(route.elevGainM - c.gain), ascentErrorPct: +((route.elevGainM / c.gain - 1) * 100).toFixed(2), side,
        warning: route.warning ?? null });
    }
  }
  const row = { ...c, requests, rejected, routes, distinctSides: new Set(usedSides).size, repeatedSides: usedSides.length - new Set(usedSides).size };
  measurements.push(row);
  report[phase] = { date: new Date().toISOString(), start: 'Granollers (punto público)', seeds: [1100, 2200, 3300], cases: measurements };
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(row));
}
