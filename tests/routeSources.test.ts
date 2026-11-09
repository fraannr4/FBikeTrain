import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeReferenceSchema, routeSearchSchema } from '../src/routes/sources/schema';
import { buildOverpassQuery, parseOverpass } from '../src/routes/sources/overpass';
import { parseWikilocDetail, wikilocLinks, parsePublicGpx } from '../src/routes/sources/wikiloc';
import { findRouteReferences } from '../src/routes/sources/client';

const fixture = (name: string) => readFileSync(resolve('tests/fixtures/route-sources', name), 'utf8');
const at = '2026-11-09T12:00:00.000Z';
const search = { lat: 0, lon: 0, radiusM: 2000 };
const url = 'https://es.wikiloc.com/rutas-ciclismo/circuito-sintetico-900000001';
const wiki = () => parseWikilocDetail(fixture('wikiloc-detail.html'), url, at).reference;

describe('fuentes de referencia sintéticas', () => {
  it('extrae solo enlaces públicos de carretera en hosts permitidos', () => {
    expect(wikilocLinks(fixture('wikiloc-search.html'))).toEqual([url]);
  });
  it('extrae autor, nombre, unidades españolas y enlace GPX explícito', () => {
    const html = fixture('wikiloc-detail.html').replace('<body>', '<body><nav><a href="/wikiloc/user.do?id=900000099">Otro perfil</a></nav>');
    const result = parseWikilocDetail(html, url, at);
    expect(result.reference).toEqual({ source: 'wikiloc', url, author: 'Ciclista ficticio', name: 'Circuito & prueba', distanceM: 42250, ascentM: 1250, fetchedAt: at });
    expect(result.gpxUrl).toBe('https://es.wikiloc.com/public/synthetic.gpx');
  });
  it('falla de forma controlada con captcha o HTML cambiado', () => {
    expect(() => wikilocLinks(fixture('wikiloc-blocked.html'))).toThrow('blocked');
    expect(() => parseWikilocDetail('<html>Nueva estructura</html>', url, at)).toThrow('html_changed');
    expect(() => wikilocLinks('<html>Nueva estructura</html>')).toThrow('html_changed');
  });
  it('no trata enlaces de login/Premium como GPX públicos', () => {
    const html = fixture('wikiloc-detail.html').replace('/public/synthetic.gpx', '/login?next=synthetic.gpx');
    expect(parseWikilocDetail(html, url, at).gpxUrl).toBeUndefined();
  });
  it('conserva los segmentos GPX sin unir huecos y rechaza XML malformado', () => {
    expect(parsePublicGpx(fixture('public-track.gpx')).coordinates).toHaveLength(2);
    expect(() => parsePublicGpx('<html>Login</html>')).toThrow('invalid_response');
    expect(() => parsePublicGpx('<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///secret">]><gpx/>')).toThrow('invalid_response');
  });
  it('consulta relaciones y vías completas para poder filtrar sus etiquetas', () => {
    expect(buildOverpassQuery(search)).toContain('[route=bicycle][network~"^(lcn|rcn|ncn)$"]');
    expect(buildOverpassQuery(search)).toContain('way(r.routes)');
    expect(buildOverpassQuery(search)).toContain('out body geom');
  });
  it('rechaza relaciones completas si contienen trunk o vías sin asfalto', () => {
    const routes = parseOverpass(JSON.parse(fixture('overpass.json')), search, at);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ source: 'osm', author: '© OpenStreetMap contributors; Club ficticio', ascentM: null, url: 'https://www.openstreetmap.org/relation/900001' });
    expect(routes[0].geometry?.coordinates).toHaveLength(2);
    expect(routes[0].distanceM).toBeCloseTo(222.39, 0);
    expect(routes[0].geometry?.coordinates[1][0]).toEqual([0.001, 0.01]);
  });
  it('descarta miembros ausentes, redes ajenas y resultados fuera del radio', () => {
    const data = JSON.parse(fixture('overpass.json'));
    data.elements = data.elements.filter((e: { id: number }) => e.id !== 1);
    expect(parseOverpass(data, search, at)).toEqual([]);
    expect(parseOverpass(JSON.parse(fixture('overpass.json')), { ...search, lat: 40 }, at)).toEqual([]);
  });
  it('no convierte errores Overpass o JSON inválido en vacío cacheable', () => {
    expect(() => parseOverpass({ elements: [], remark: 'runtime error: timeout' }, search, at)).toThrow('invalid_response');
    expect(() => parseOverpass({ wrong: true }, search, at)).toThrow();
  });
  it('valida coordenadas, URLs, cifras y fechas', () => {
    expect(routeSearchSchema.safeParse({ ...search, radiusM: Infinity }).success).toBe(false);
    expect(routeSearchSchema.safeParse({ ...search, home: 'privado' }).success).toBe(false);
    expect(routeReferenceSchema.safeParse({ ...wiki(), author: '' }).success).toBe(false);
    expect(routeReferenceSchema.safeParse({ ...wiki(), url: 'https://evil.invalid/a' }).success).toBe(false);
    expect(routeReferenceSchema.safeParse({ ...wiki(), distanceM: -1 }).success).toBe(false);
  });
});

describe('cliente: Wikiloc primero y OSM de respaldo', () => {
  it('no consulta OSM si Wikiloc aporta referencias válidas', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { data: [wiki()] }, error: null });
    expect(await findRouteReferences(search, { invoke })).toEqual([wiki()]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('route-sources', expect.objectContaining({ body: { ...search, source: 'wikiloc' } }));
  });
  it.each(['empty', 'error', 'malformed', 'throw'])('recurre a OSM ante %s', async mode => {
    const osm = parseOverpass(JSON.parse(fixture('overpass.json')), search, at);
    const invoke = vi.fn();
    if (mode === 'throw') invoke.mockRejectedValueOnce(new Error('network'));
    else invoke.mockResolvedValueOnce(mode === 'error' ? { data: null, error: {} } : { data: { data: mode === 'empty' ? [] : [{ secret: true }] }, error: null });
    invoke.mockResolvedValueOnce({ data: { data: osm }, error: null });
    expect(await findRouteReferences(search, { invoke })).toEqual(osm);
    expect(invoke.mock.calls[1][1].body.source).toBe('osm');
  });
  it('no oculta el fallo de ambos proveedores ni reintenta cancelar', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: {} });
    await expect(findRouteReferences(search, { invoke })).rejects.toThrow('unavailable');
    const controller = new AbortController(); controller.abort(); invoke.mockClear();
    await expect(findRouteReferences(search, { invoke }, controller.signal)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
