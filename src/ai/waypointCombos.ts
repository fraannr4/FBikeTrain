import type { LatLng } from '../domain/types';
import { codeCombos, interestOf, type Combo, type EngineTarget, type Waypoint } from '../routes/waypointEngine';
import { isAbort } from './abort';
import type { AiCombo, AiWaypoint, AiWaypointGoal } from './contracts';
import { LlmError } from './llm';
import { directionName } from './references';

export type { AiCombo, AiWaypoint, AiWaypointGoal } from './contracts';

/**
 * La IA agrupa los puntos de paso por dirección. Solo recibe nombres y cifras con ids propios
 * (`w1`, `w2`...); las posiciones se quedan en `byAiId`. Lo que devuelve se valida aquí y lo que
 * falte lo completan las combinaciones del código.
 */

export type SharedWaypointPlanner = {
  combine: (objetivo: AiWaypointGoal, puntos: AiWaypoint[], signal?: AbortSignal) => Promise<{ combinaciones: AiCombo[] }>;
};

/** Puntos que se enseñan a la IA como mucho. */
export const MAX_AI_WAYPOINTS = 24;
const MAX_NAME = 60;
const MAX_COMBO_POINTS = 3;
const KIND_LABEL: Record<Waypoint['kind'], string> = { puerto: 'Puerto', cima: 'Cima', pueblo: 'Pueblo', habitual: 'Tramo habitual' };
/** La palabra «Casa» no llega nunca a la IA, ni siquiera como parte de un topónimo. */
const HOME_WORD = /casa/i;
/** Un número con 3 o más decimales parece una coordenada. */
const COORDINATE = /\d[.,]\d{3,}/;

const round1 = (x: number) => Math.round(x * 10) / 10;
const setKey = (ids: string[]) => [...ids].sort().join('|');

function safeName(w: Waypoint, index: number): string {
  const name = w.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return !name || HOME_WORD.test(name) || COORDINATE.test(name) ? `${KIND_LABEL[w.kind]} ${index + 1}` : name;
}

/** Los puntos de más interés, como mucho 24, con solo los campos que puede ver la IA. */
export function toAiWaypoints(waypoints: Waypoint[]): { forAi: AiWaypoint[]; byAiId: Map<string, Waypoint> } {
  const ranked = waypoints
    .map((w, i) => ({ w, i }))
    .sort((a, b) => interestOf(b.w) - interestOf(a.w) || a.i - b.i)
    .slice(0, MAX_AI_WAYPOINTS)
    .map(({ w }) => w);
  const forAi: AiWaypoint[] = [];
  const byAiId = new Map<string, Waypoint>();
  ranked.forEach((w, i) => {
    const id = `w${i + 1}`;
    forAi.push({
      id, tipo: w.kind, nombre: safeName(w, i),
      cotaM: w.ele === null || !Number.isFinite(w.ele) ? null : Math.max(0, Math.round(w.ele)),
      distanciaKm: round1(w.distanceM / 1000), direccion: w.direccion, interes: interestOf(w),
    });
    byAiId.set(id, w);
  });
  return { forAi, byAiId };
}

/** Rumbo medio de varios puntos (media circular), en grados. */
function meanBearing(points: Waypoint[]): number {
  const rad = Math.PI / 180;
  const x = points.reduce((s, p) => s + Math.cos(p.bearing * rad), 0);
  const y = points.reduce((s, p) => s + Math.sin(p.bearing * rad), 0);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/**
 * Se queda con las combinaciones que solo usan ids enviados, sin repetirlos y con 3 puntos como
 * máximo. El código pone el orden de paso (en el sentido de giro, para que la vuelta no se cruce)
 * y la dirección; un título con coordenadas se descarta.
 */
export function validateAiCombos(raw: AiCombo[], byAiId: ReadonlyMap<string, Waypoint>): Combo[] {
  const out: Combo[] = [];
  const seen = new Set<string>();
  for (const combo of raw) {
    const ids = combo.puntos;
    if (ids.length === 0 || ids.length > MAX_COMBO_POINTS || new Set(ids).size !== ids.length) continue;
    const points = ids.map((id) => byAiId.get(id)).filter((p): p is Waypoint => !!p);
    if (points.length !== ids.length) continue;
    const mean = meanBearing(points);
    const offset = (p: Waypoint) => ((p.bearing - mean + 540) % 360) - 180;
    const ordered = [...points].sort((a, b) => offset(a) - offset(b));
    const waypointIds = ordered.map((p) => p.id);
    const key = setKey(waypointIds);
    if (seen.has(key)) continue;
    seen.add(key);
    const titulo = combo.titulo.trim().slice(0, MAX_NAME);
    out.push({
      id: waypointIds.join('+'), waypointIds, direccion: directionName(mean), source: 'ia',
      ...(titulo && !COORDINATE.test(titulo) ? { titulo } : {}),
    });
  }
  return out;
}

/**
 * Primero las combinaciones válidas de la IA y después las del código que no repiten sus puntos.
 * Un JSON no válido se reintenta una vez; cualquier otro fallo (límite, red, sin IA común) sigue
 * solo con el código. Una cancelación se propaga.
 */
export async function combineWaypoints(
  start: LatLng,
  waypoints: Waypoint[],
  target: EngineTarget,
  ai: SharedWaypointPlanner | null,
  signal?: AbortSignal,
): Promise<{ combos: Combo[]; usedAi: boolean }> {
  const code = codeCombos(start, waypoints, target);
  if (!ai || waypoints.length === 0) return { combos: code, usedAi: false };

  const { forAi, byAiId } = toAiWaypoints(waypoints);
  const objetivo: AiWaypointGoal = { distanciaKm: target.distanceKm, desnivelM: target.elevGainM };
  let fromAi: Combo[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fromAi = validateAiCombos((await ai.combine(objetivo, forAi, signal)).combinaciones, byAiId);
      break;
    } catch (e) {
      if (signal?.aborted || isAbort(e)) throw e;
      if (!(e instanceof LlmError) || e.kind !== 'invalid_json') break;
    }
  }
  const taken = new Set(fromAi.map((c) => setKey(c.waypointIds)));
  return { combos: [...fromAi, ...code.filter((c) => !taken.has(setKey(c.waypointIds)))], usedAi: fromAi.length > 0 };
}
