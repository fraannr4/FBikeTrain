import { visitsWaypoints } from '../src/routes/intent';

const start = { lat: 0, lng: 0 };

it('rechaza atribuir un esqueleto si ORS no pasa por sus puntos o deja huecos', () => {
  const coords: [number, number, number][] = [[0, 0, 0], [0.01, 0, 0], [0.02, 0, 0]];
  expect(visitsWaypoints(coords, [{ lat: 0, lng: 0.01 }])).toBe(true);
  expect(visitsWaypoints(coords, [{ lat: 0.1, lng: 0.01 }])).toBe(false);
  expect(visitsWaypoints([[0, 0, 0], [1, 1, 0]], [start])).toBe(false);
});
