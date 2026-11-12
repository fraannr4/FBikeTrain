import type { LatLng } from '../src/domain/types';
import type { AdaptedRoute } from '../src/routes/adapt';
import { OrsError } from '../src/routes/ors';
import { RwgpsError } from '../src/routes/sources/ridewithgps';
import { adaptRwgpsChoice, listRwgpsChoices, rwgpsExploreUrl } from '../src/routes/sources/rwgpsExplore';
import type { RecommendUpdate } from '../src/routes/catalog/recommend';

// Respuestas sintéticas con la forma real de la función `rwgps`: `{ data }` o `{ error: { code } }`.
const START: LatLng = { lat: 41, lng: 2.5 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const track = (id: string) => ({
  route: {
    name: `Vuelta sintética ${id}`, user: { name: 'Autora sintética' },
    track_points: Array.from({ length: 50 }, (_, i) => ({ x: START.lng + Math.sin(i / 8) * 0.05, y: START.lat + (1 - Math.cos(i / 8)) * 0.05, e: 100 + i })),
  },
});

/** Función `rwgps` simulada: `answer` decide la respuesta de cada petición. */
function fakeShared(answer: (body: { kind: string; id: string }) => Response) {
  const asked: { kind: string; id: string }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    asked.push(body);
    return answer(body);
  });
  return { asked, access: { getToken: async () => 'sesion-sintetica', fetch: fetchImpl as unknown as typeof fetch } };
}

const keep = vi.fn(async (points: { lat: number; lng: number }[], _opts?: unknown, _deps?: unknown): Promise<AdaptedRoute> => ({
  coords: points.map((p) => ({ lat: p.lat, lng: p.lng })), distanceM: 60_000, elevGainM: 500, connectorM: 0, passesNearM: 0, rotated: false, warnings: [],
}));
const target = { start: START, distanceKm: 60, elevGainM: null };

beforeEach(() => { keep.mockClear(); });

describe('rwgpsExploreUrl', () => {
  it('abre Explore alrededor del inicio, con ±10 % de km, firme asfaltado, rutas y bici de carretera', () => {
    expect(rwgpsExploreUrl({ start: { lat: 41.63, lng: 2.16 }, distanceKm: 60, elevGainM: 800 }))
      .toBe('https://ridewithgps.com/explore?b=p!2.16!41.63~15km&length=54*66km&ele=600*1000m&s=paved&m=routes&a=cycling%3Aroad');
  });

  it('sin desnivel pedido no filtra por desnivel', () => {
    const url = new URL(rwgpsExploreUrl({ start: { lat: 41.63, lng: 2.16 }, distanceKm: 45, elevGainM: null }));
    expect(url.searchParams.has('ele')).toBe(false);
    expect(url.searchParams.get('length')).toBe('40*50km');
  });

  it('manda el inicio redondeado a 0,01° (~1 km), nunca el punto exacto', () => {
    const url = new URL(rwgpsExploreUrl({ start: { lat: 41.634567, lng: 2.164321 }, distanceKm: 60, elevGainM: null }));
    expect(url.origin + url.pathname).toBe('https://ridewithgps.com/explore');
    expect(url.searchParams.get('b')).toBe('p!2.16!41.63~15km');
  });

  it('un desnivel pequeño no baja de 100 m', () => {
    expect(new URL(rwgpsExploreUrl({ start: START, distanceKm: 30, elevGainM: 80 })).searchParams.get('ele')).toBe('100*100m');
  });
});

describe('listRwgpsChoices', () => {
  it('deja las rutas tal cual y expande cada colección con una sola lectura, sin repetir', async () => {
    const { asked, access } = fakeShared(() => json({ data: { collection: { name: 'Clásicas sintéticas', routes: [{ id: 7 }, { id: 8 }, { id: 5 }] } } }));
    const out = await listRwgpsChoices([{ kind: 'route', id: '5' }, { kind: 'collection', id: '90' }], access);
    expect(asked).toEqual([{ kind: 'collection', id: '90' }]);
    expect(out.failed).toEqual([]);
    expect(out.choices).toEqual([
      { id: '5', label: 'Ruta 5' },
      { id: '7', label: 'Clásicas sintéticas · 1 de 3' },
      { id: '8', label: 'Clásicas sintéticas · 2 de 3' },
    ]);
  });

  it('una colección privada no para las demás y se explica', async () => {
    const { access } = fakeShared(() => json({ error: { code: 'not_visible', message: 'x' } }, 403));
    const out = await listRwgpsChoices([{ kind: 'collection', id: '90' }, { kind: 'route', id: '6' }], access);
    expect(out.choices).toEqual([{ id: '6', label: 'Ruta 6' }]);
    expect(out.failed).toEqual(['Colección 90: No es pública en Ride with GPS: solo se pueden traer rutas y colecciones públicas.']);
  });

  it('sin sesión lo lanza', async () => {
    const access = { getToken: async () => null, fetch: vi.fn() as unknown as typeof fetch };
    await expect(listRwgpsChoices([{ kind: 'collection', id: '90' }], access)).rejects.toBeInstanceOf(RwgpsError);
  });
});

describe('adaptRwgpsChoice', () => {
  it('lee la ruta por id y la adapta para salir y volver al inicio', async () => {
    const { asked, access } = fakeShared(({ id }) => json({ data: track(id) }));
    const out = await adaptRwgpsChoice({ id: '501', label: 'Ruta 501' }, target, { rwgps: access, ors: { kind: 'key', apiKey: 'k' } as never, adapt: keep });
    expect(asked).toEqual([{ kind: 'route', id: '501' }]);
    expect(keep).toHaveBeenCalledTimes(1);
    expect(keep.mock.calls[0][1]).toMatchObject({ start: START, mode: 'mi-inicio', targetKm: 60 });
    if (!('proposal' in out)) throw new Error('sin propuesta');
    expect(out.proposal.route).toMatchObject({ name: 'Vuelta sintética 501', sourceUrl: 'https://ridewithgps.com/routes/501', author: 'Autora sintética en Ride with GPS' });
  });

  it('una ruta privada no se adapta y dice por qué', async () => {
    const { access } = fakeShared(() => json({ error: { code: 'not_visible', message: 'x' } }, 403));
    const out = await adaptRwgpsChoice({ id: '9', label: 'Ruta 9' }, target, { rwgps: access, ors: {} as never, adapt: keep });
    expect(out).toEqual({ rejected: 'No es pública en Ride with GPS: solo se pueden traer rutas y colecciones públicas.' });
    expect(keep).not.toHaveBeenCalled();
  });

  it('con el límite por minuto de ORS avisa, espera 60 s y vuelve a probar', async () => {
    const { access } = fakeShared(({ id }) => json({ data: track(id) }));
    const adapt = vi.fn(keep).mockRejectedValueOnce(new OrsError('rate_minute', 'Has pasado de 40 consultas por minuto en ORS.'));
    const wait = vi.fn(async () => undefined);
    const updates: RecommendUpdate[] = [];
    const out = await adaptRwgpsChoice({ id: '3', label: 'Ruta 3' }, target, { rwgps: access, ors: {} as never, adapt, wait, onUpdate: (u) => updates.push(u) });
    expect(wait).toHaveBeenCalledWith(60_000, undefined);
    expect(updates).toContainEqual({ kind: 'waiting', seconds: 60 });
    expect(adapt).toHaveBeenCalledTimes(2);
    expect('proposal' in out).toBe(true);
  });

  it('sin cuota de ORS para y lo dice', async () => {
    const { access } = fakeShared(({ id }) => json({ data: track(id) }));
    const adapt = vi.fn(keep).mockRejectedValue(new OrsError('quota_day', 'Has gastado las 2.000 consultas diarias de ORS.'));
    await expect(adaptRwgpsChoice({ id: '3', label: 'Ruta 3' }, target, { rwgps: access, ors: {} as never, adapt })).rejects.toThrow('2.000 consultas');
  });

  it('con la cuota de Ride with GPS agotada lo lanza como error fatal', async () => {
    const { access } = fakeShared(() => json({ error: { code: 'quota_exceeded' }, retryAfterS: 7200 }, 429));
    const err = await adaptRwgpsChoice({ id: '3', label: 'Ruta 3' }, target, { rwgps: access, ors: {} as never, adapt: keep }).catch((e) => e);
    expect(err).toBeInstanceOf(RwgpsError);
    expect((err as RwgpsError).fatal).toBe(true);
    expect((err as Error).message).toMatch(/300 rutas al día/);
  });
});
