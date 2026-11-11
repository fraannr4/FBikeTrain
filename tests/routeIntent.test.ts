import { libraryIntent, passIntent, visitsWaypoints } from '../src/routes/intent';
import type { RoutePoint } from '../src/routes/library';

const start = { lat: 0, lng: 0 };
const loop: RoutePoint[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }, { lat: 0.1, lng: 0.1 }, { lat: 0.1, lng: 0 }, { lat: 0, lng: 0 }];

it('recorta un esqueleto largo y conserva inicio/regreso dentro de ocho puntos ORS', () => {
  const intent = libraryIntent('ref1', start, 20000, loop);
  expect(intent?.id).toBe('ref1');
  expect(intent?.waypoints[0]).toEqual(start);
  expect(intent?.waypoints.at(-1)).toEqual(start);
  expect(intent!.waypoints.length).toBeLessThanOrEqual(8);
  expect(intent!.waypoints.some(p => p.lat > 0.09 && p.lng < 0.01)).toBe(false);
});

it('alarga con un segundo esqueleto sin copiar geometrías ni superar ocho waypoints', () => {
  const a = loop.map(p => ({ lat: p.lat / 5, lng: p.lng / 5 }));
  const intent = libraryIntent('ref1', start, 30000, a, loop);
  expect(intent!.waypoints.some(p => p.lat > 0.04 || p.lng > 0.04)).toBe(true);
  expect(intent!.waypoints.length).toBeLessThanOrEqual(8);
});

it('un puerto requiere acceso y salida reales diferentes', () => {
  const pass = { id: 'pass1', name: 'Coll sintético', lat: 0.2, lng: 0, ele: 600, distanceM: 22000 };
  expect(passIntent('pass1', start, pass)).toBeNull();
  const intent = passIntent('pass1', start, { ...pass, approach: { lat: 0.19, lng: 0 }, departure: { lat: 0.21, lng: 0 } });
  expect(intent!.waypoints).toHaveLength(5);
  expect(intent!.waypoints[2]).toEqual({ lat: 0.2, lng: 0 });
});

it('rechaza atribuir un esqueleto si ORS no pasa por sus puntos o deja huecos', () => {
  const coords: [number, number, number][] = [[0, 0, 0], [0.01, 0, 0], [0.02, 0, 0]];
  expect(visitsWaypoints(coords, [{ lat: 0, lng: 0.01 }])).toBe(true);
  expect(visitsWaypoints(coords, [{ lat: 0.1, lng: 0.01 }])).toBe(false);
  expect(visitsWaypoints([[0, 0, 0], [1, 1, 0]], [start])).toBe(false);
});
