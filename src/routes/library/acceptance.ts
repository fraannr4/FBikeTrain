import type { LatLng } from '../../domain/types';
import { rejectReason } from '../analyze';
import { MAX_INTENT_BACKTRACK } from '../generator';
import { cellOverlap, OVERLAP_LIMIT } from './cells.ts';
import { meetsTarget, MIN_PROPOSALS, type GeneratorTarget } from './generate.ts';

/**
 * Criterio de aceptación de la prueba real (`scripts/check-generator.ts`), comprobado aparte del
 * generador: ±10 % en km, ±25 % en desnivel si se pide, carretera asfaltada con poca principal,
 * retroceso ≤ 15 % y menos del 70 % de celdas compartidas con una válida anterior.
 */

export type AcceptanceItem = {
  kind: 'biblioteca' | 'nueva'; distanceM: number; elevGainM: number | null;
  road: { unpavedM: number; trackM: number; mainRoadPct: number; motorway: boolean } | null;
  backtrackM: number; line: LatLng[];
};
export type AcceptanceRow = AcceptanceItem & { maxOverlap: number; valid: boolean; reasons: string[] };

export function acceptanceReport(target: GeneratorTarget, items: AcceptanceItem[]): { rows: AcceptanceRow[]; valid: number; passed: boolean } {
  const wantedM = target.distanceKm * 1000;
  const overlaps = items.map((a, i) => items.map((b, j) => (i === j ? 0 : cellOverlap(a.line, b.line))));
  const rows: AcceptanceRow[] = [];
  items.forEach((it, i) => {
    const reasons: string[] = [];
    // `meetsTarget` por partes, para decir cuál de las dos cifras falla.
    if (!meetsTarget(it.distanceM, null, { ...target, elevGainM: null })) reasons.push('longitud');
    if (!meetsTarget(wantedM, it.elevGainM, target)) reasons.push('desnivel');
    if (!it.road) reasons.push('sin datos de carretera');
    else {
      const road = rejectReason({ ...it.road, distanceM: it.distanceM }, it.distanceM);
      if (road) reasons.push(road);
    }
    if (it.backtrackM > MAX_INTENT_BACKTRACK * it.distanceM) reasons.push('retroceso');
    if (rows.some((r, j) => r.valid && overlaps[i][j] >= OVERLAP_LIMIT)) reasons.push('solape');
    rows.push({ ...it, maxOverlap: Math.max(0, ...overlaps[i]), valid: reasons.length === 0, reasons });
  });
  const valid = rows.filter(r => r.valid).length;
  return { rows, valid, passed: valid >= MIN_PROPOSALS };
}
