import { LOOP_CLOSE_M, MAX_LINE_POINTS, MAX_UNPAVED_PCT, pointsReferenceRow, rwgpsReferenceRow, simplifyLine } from '../src/routes/library/rows';
import { haversineM } from '../src/import/summary';

// Filas de `reference_routes`. Trazados sintéticos en el mar frente a la costa (41,0 / 2,5).
const LAT0 = 41.0;
const LNG0 = 2.5;
const RADIUS_M = 2000;
const M_PER_DEG_LAT = 111_195;

/** Vuelta casi circular de `n` puntos cuyo final queda a `closeM` metros del inicio. */
function circle(n: number, closeM: number, withEle = true) {
  const gap = 2 * Math.asin(closeM / (2 * RADIUS_M));
  const cos = Math.cos((LAT0 * Math.PI) / 180);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * (2 * Math.PI - gap);
    const point = { x: LNG0 + (RADIUS_M * Math.sin(a)) / (M_PER_DEG_LAT * cos), y: LAT0 + (RADIUS_M * (1 - Math.cos(a))) / M_PER_DEG_LAT };
    return withEle ? { ...point, e: 100 + 50 * Math.sin(a) } : point;
  });
}
function detail(points: object[], extra: Record<string, unknown> = {}) {
  return { route: { name: 'Vuelta sintética', visibility: 'public', user: { id: 99, name: 'Autora', email: 'autora@example.com' }, privacy_code: 'secreto', distance: 12_345, elevation_gain: 321, track_points: points, ...extra } };
}

describe('rwgpsReferenceRow', () => {
  it('pública de 3.000 puntos: línea de 2.000 con el primero y el último, cifras de la API y origen rwgps', () => {
    const points = circle(3000, 400);
    const row = rwgpsReferenceRow(7, detail(points))!;
    expect(MAX_LINE_POINTS).toBe(2000);
    expect(row.line).toHaveLength(2000);
    const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
    expect(row.line[0].slice(0, 2)).toEqual([round5(points[0].x), round5(points[0].y)]);
    expect(row.line.at(-1)!.slice(0, 2)).toEqual([round5(points.at(-1)!.x), round5(points.at(-1)!.y)]);
    expect(row.line.every(p => p.length === 3)).toBe(true);
    expect(row).toMatchObject({ source: 'rwgps', source_id: '7', url: 'https://ridewithgps.com/routes/7', name: 'Vuelta sintética', author: 'Autora', distance_m: 12_345, elev_gain_m: 321, loop: true });
  });

  it(`cierra la vuelta si el final queda a ${LOOP_CLOSE_M} m o menos del inicio`, () => {
    expect(LOOP_CLOSE_M).toBe(500);
    expect(rwgpsReferenceRow(7, detail(circle(300, 400)))!.loop).toBe(true);
    expect(rwgpsReferenceRow(7, detail(circle(300, 600)))!.loop).toBe(false);
  });

  it('privada o sin visibilidad, nada', () => {
    expect(rwgpsReferenceRow(7, detail(circle(10, 100), { visibility: 'private' }))).toBeNull();
    expect(rwgpsReferenceRow(7, detail(circle(10, 100), { visibility: undefined }))).toBeNull();
  });

  it(`con más de un ${MAX_UNPAVED_PCT} % sin asfaltar, nada; con el ${MAX_UNPAVED_PCT} %, se guarda`, () => {
    expect(rwgpsReferenceRow(7, detail(circle(10, 100), { unpaved_pct: 6 }))).toBeNull();
    expect(rwgpsReferenceRow(7, detail(circle(10, 100), { unpaved_pct: 5 }))!.unpaved_pct).toBe(5);
    expect(rwgpsReferenceRow(7, detail(circle(10, 100)))!.unpaved_pct).toBeNull();
  });

  it('sin altitud en ningún punto: desnivel null y puntos de 2 elementos', () => {
    const row = rwgpsReferenceRow(7, detail(circle(50, 100, false), { elevation_gain: undefined }))!;
    expect(row.elev_gain_m).toBeNull();
    expect(row.line.every(p => p.length === 2)).toBe(true);
  });

  it('sin cifras de la API, distancia y desnivel salen del trazado', () => {
    const json = { route: { visibility: 'public', track_points: [{ x: 2.5, y: 41, e: 100 }, { x: 2.5, y: 41.01, e: 150 }, { x: 2.5, y: 41.02, e: 130 }] } };
    const row = rwgpsReferenceRow(8, json)!;
    expect(row.distance_m).toBeGreaterThan(2200);
    expect(row.distance_m).toBeLessThan(2250);
    expect(row.elev_gain_m).toBe(50);
    expect(row.author).toBe('');
  });

  it('nunca guarda correo, id de usuario ni privacy_code', () => {
    const text = JSON.stringify(rwgpsReferenceRow(7, detail(circle(10, 100))));
    expect(text).not.toContain('autora@example.com');
    expect(text).not.toContain('secreto');
    expect(text).not.toContain('"99"');
  });

  it.each([
    [{ route: { visibility: 'public', track_points: [{ x: 2.5, y: 41 }] } }],
    [{ route: { visibility: 'public', track_points: [{ x: 2.5, y: 41 }, { x: 500, y: 41 }] } }],
    [null],
  ])('sin 2 puntos válidos, nada: %j', json => {
    expect(rwgpsReferenceRow(9, json)).toBeNull();
  });
});

describe('pointsReferenceRow', () => {
  const points = [
    { lat: 41.0000012, lng: 2.5000049, ele: 10 },
    { lat: 41.0100001, lng: 2.5200004, ele: 40 },
    { lat: 40.9950004, lng: 2.4900006, ele: 20 },
    { lat: 41.0000012, lng: 2.5000049, ele: 10 },
  ];

  it('calcula la caja, el inicio y redondea a 5 decimales', () => {
    const row = pointsReferenceRow({ source: 'wikiloc', sourceId: '123456', url: 'https://www.wikiloc.com/cycling-trails/ruta-sintetica-123456', name: 'Sintética', points });
    expect(row).toMatchObject({
      source: 'wikiloc', source_id: '123456', author: '', start_lat: 41, start_lng: 2.5,
      min_lat: 40.995, max_lat: 41.01, min_lng: 2.49, max_lng: 2.52, loop: true, unpaved_pct: null,
    });
    expect(row.line[1]).toEqual([2.52, 41.01, 40]);
  });

  it('la distancia es la del trazado y el desnivel ignora el ruido de menos de 3 m', () => {
    const noisy = [0, 1, 0, 1, 0, 20].map((ele, i) => ({ lat: LAT0 + i * 0.001, lng: LNG0, ele }));
    const row = pointsReferenceRow({ source: 'other', sourceId: 'abc', url: 'https://example.com/r', name: 'x', points: noisy });
    expect(row.distance_m).toBe(Math.round(haversineM(LAT0, LNG0, LAT0 + 0.005, LNG0)));
    expect(row.elev_gain_m).toBe(20);
    expect(row.loop).toBe(false);
  });

  it('sin altitud, desnivel null y puntos de 2 elementos', () => {
    const row = pointsReferenceRow({ source: 'komoot', sourceId: '1', url: 'https://www.komoot.com/tour/1', name: 'x', points: points.map(({ lat, lng }) => ({ lat, lng })), unpavedPct: 2 });
    expect(row.elev_gain_m).toBeNull();
    expect(row.unpaved_pct).toBe(2);
    expect(row.line.every(p => p.length === 2)).toBe(true);
  });
});

describe('simplifyLine', () => {
  it(`deja como mucho ${MAX_LINE_POINTS} puntos y conserva el primero y el último`, () => {
    const points = Array.from({ length: 5000 }, (_, i) => [i, i] as [number, number]);
    const line = simplifyLine(points);
    expect(line).toHaveLength(MAX_LINE_POINTS);
    expect(line[0]).toEqual([0, 0]);
    expect(line.at(-1)).toEqual([4999, 4999]);
  });

  it('no toca una línea corta', () => {
    expect(simplifyLine([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]);
  });
});
