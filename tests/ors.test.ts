import { readFileSync } from 'node:fs';
import { db } from '../src/db/db';
import { buildRoundTripBody, fetchRoundTrip, OrsError, type RoundTripRequest } from '../src/routes/ors';
import { getOrsUsage } from '../src/routes/orsUsage';

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/ors/${name}`, 'utf8'));
const URL_ORS = 'https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson';
const req: RoundTripRequest = { start: { lat: 40.4168, lng: -3.7038 }, lengthM: 30000, points: 4, seed: 7 };

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

/** Llama y devuelve el OrsError lanzado; falla si no lanza uno. */
async function orsErrorOf(fetchImpl: typeof fetch): Promise<OrsError> {
  try {
    await fetchRoundTrip('test-key', req, fetchImpl);
  } catch (e) {
    expect(e).toBeInstanceOf(OrsError);
    return e as OrsError;
  }
  throw new Error('no lanzó');
}

async function setUsage(count: number) {
  await db.meta.put({ key: 'orsUsage', value: { count, windowStart: Date.now() } });
}

describe('ors client', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });

  it('body uses lng,lat order and fixed options', () => {
    expect(buildRoundTripBody(req)).toEqual({
      coordinates: [[-3.7038, 40.4168]],
      elevation: true,
      instructions: false,
      extra_info: ['surface', 'waytype', 'steepness', 'waycategory'],
      options: {
        round_trip: { length: 30000, points: 4, seed: 7 },
        avoid_features: ['ferries', 'fords', 'steps'],
      },
    });
  });

  it('posts to cycling-road geojson with key header', async () => {
    const f = respond(200, fixture('round-trip-ok.json'));
    await fetchRoundTrip('test-key', req, f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(URL_ORS);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual(buildRoundTripBody(req));
  });

  it('parses fixture into feature', async () => {
    const feature = await fetchRoundTrip('test-key', req, respond(200, fixture('round-trip-ok.json')));
    expect(feature.geometry.type).toBe('LineString');
    expect(feature.geometry.coordinates[0].length).toBe(3);
    expect(Array.isArray(feature.properties.extras.waytypes.summary)).toBe(true);
    expect(feature.properties.summary.distance).toBeGreaterThan(0);
  });

  it('acepta la clave waytype que devuelve ORS desde noviembre de 2026', async () => {
    const json = fixture('round-trip-ok.json');
    for (const f of (json as { features: { properties: { extras: Record<string, unknown> } }[] }).features) { f.properties.extras.waytype = f.properties.extras.waytypes; delete f.properties.extras.waytypes; }
    const feature = await fetchRoundTrip('test-key', req, respond(200, json));
    expect(Array.isArray(feature.properties.extras.waytypes.summary)).toBe(true);
    expect(feature.properties.extras).not.toHaveProperty('waytype');
  });

  it('records the call before sending', async () => {
    let usageSeenByFetch = -1;
    const f = vi.fn<typeof fetch>(async () => {
      usageSeenByFetch = (await getOrsUsage(Date.now())).count;
      return new Response(JSON.stringify(fixture('round-trip-ok.json')), { status: 200 });
    });
    await fetchRoundTrip('test-key', req, f);
    expect(usageSeenByFetch).toBe(1);
  });

  it('404 with code 2010 maps to no_route', async () => {
    const e = await orsErrorOf(respond(404, fixture('no-route-404.json')));
    expect(e.kind).toBe('no_route');
    expect(e.code).toBe(2010);
    expect(e.message).toBe('ORS no encuentra carreteras desde ese punto. Mueve el inicio a una carretera.');
  });

  it('429 maps to rate_minute', async () => {
    const e = await orsErrorOf(respond(429, { error: 'Rate limit exceeded' }));
    expect(e.kind).toBe('rate_minute');
    expect(e.message).toBe('Has pasado de 40 consultas por minuto en ORS. Espera un minuto y vuelve a probar.');
  });

  it('403 maps to quota_day', async () => {
    const e = await orsErrorOf(respond(403, { error: 'Daily quota reached or API key unauthorized' }));
    expect(e.kind).toBe('quota_day');
    expect(e.message).toBe(
      'Has gastado las 2.000 consultas diarias de ORS. La cuota se renueva 24 h después de la primera consulta del día.',
    );
  });

  it('network error maps to unreachable with combined message', async () => {
    await setUsage(10);
    const e = await orsErrorOf(
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(e.kind).toBe('unreachable');
    expect(e.message).toBe(
      'ORS no responde. Puede ser la clave, la cuota diaria (2.000 consultas) o la conexión. Comprueba la clave en Ajustes.',
    );
  });

  it('network error with usage >= 2000 maps to quota_day', async () => {
    await setUsage(2000);
    const e = await orsErrorOf(
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(e.kind).toBe('quota_day');
    expect(e.message).toContain('2.000 consultas diarias');
  });

  it('400 keeps ors code and message', async () => {
    const e = await orsErrorOf(respond(400, { error: { code: 2003, message: 'x' } }));
    expect(e.kind).toBe('bad_request');
    expect(e.code).toBe(2003);
    expect(e.message).toBe('ORS rechaza la petición (código 2003): x');
  });

  it('5xx maps to server', async () => {
    const e = await orsErrorOf(respond(503, { error: 'Service Unavailable' }));
    expect(e.kind).toBe('server');
    expect(e.message).toBe('ORS ha fallado (HTTP 503). Vuelve a probar en unos minutos.');
  });

  it('200 without routes maps to no_route', async () => {
    const e = await orsErrorOf(respond(200, { type: 'FeatureCollection', features: [] }));
    expect(e.kind).toBe('no_route');
  });
});
