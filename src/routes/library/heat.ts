import { ELEVATION_HYSTERESIS_M, haversineM } from '../../import/summary.ts';
import { buildCellCounts } from '../../metrics/grid.ts';
import { cellKey } from '../../metrics/routes.ts';
import { densify, type LinePoint } from './cells.ts';

/**
 * Celda de 200 m del mapa de calor: cuántas rutas de referencia la pisan, un punto real de una de
 * ellas, la subida media de sus tramos con altitud (m/km) y su altitud media.
 */
export type HeatCell = { cell: string; lat: number; lng: number; routes: number; climbMPerKm: number | null; ele: number | null };

type Acc = { climbM: number; elevKm: number; eleSum: number; eleN: number };

/**
 * Mapa de calor de las líneas de referencia. `routes` y el punto salen de `buildCellCounts` (cada
 * línea densificada es un track). Cada tramo densificado se apunta a la celda de su punto inicial;
 * los tramos con altitud en los dos extremos suman su longitud y su subida, filtrada con la misma
 * histéresis que los totales de una salida. Sin ningún tramo con altitud, `climbMPerKm` es null.
 */
export function buildHeatCells(lines: LinePoint[][]): HeatCell[] {
  const dense = lines.map((line) => densify(line));
  const counts = buildCellCounts(dense.map((line) => line.map(([lng, lat]) => ({ t: 0, lat, lng }))));

  const acc = new Map<string, Acc>();
  const get = (key: string) => {
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { climbM: 0, elevKm: 0, eleSum: 0, eleN: 0 }));
    return a;
  };

  for (const line of dense) {
    let ref: number | undefined;
    line.forEach(([lng, lat, ele], i) => {
      const cell = get(cellKey(lat, lng));
      if (ele !== undefined) {
        cell.eleSum += ele;
        cell.eleN++;
      }
      const next = line[i + 1];
      if (next === undefined || ele === undefined || next[2] === undefined) return;
      const nextEle = next[2];
      cell.elevKm += haversineM(lat, lng, next[1], next[0]) / 1000;
      if (ref === undefined) ref = ele;
      if (ref - nextEle >= ELEVATION_HYSTERESIS_M) ref = nextEle;
      else if (nextEle - ref >= ELEVATION_HYSTERESIS_M) {
        cell.climbM += nextEle - ref;
        ref = nextEle;
      }
    });
  }

  return [...counts].map(([key, { count, at }]) => {
    const a = acc.get(key);
    return {
      cell: key,
      lat: at.lat,
      lng: at.lng,
      routes: count,
      climbMPerKm: a && a.elevKm > 0 ? a.climbM / a.elevKm : null,
      ele: a && a.eleN > 0 ? a.eleSum / a.eleN : null,
    };
  });
}
