import type { LatLng } from '../../domain/types';
import { adaptCandidates, type Proposal, type RecommendDeps, type RecommendTarget } from '../catalog/recommend';
import { RwgpsError } from './ridewithgps';
import { fetchRwgpsCollection, fetchRwgpsRoute, type RwgpsAccess, type RwgpsLink } from './rwgpsImport';
import { toReferenceRoute } from './rwgpsProposals';

/**
 * Explore de Ride with GPS a mano: la app solo abre Explore en una pestaña del usuario con los filtros
 * puestos (nunca lo consulta ella) y después lee por id, con la función `rwgps`, la ruta que el usuario
 * comparte o pega, para adaptarla a su inicio.
 */

export const RWGPS_EXPLORE_URL = 'https://ridewithgps.com/explore';
/** Radio por defecto de Explore en km (`exploreQuerySlice`, 15 km con unidades métricas). */
const EXPLORE_RADIUS_KM = 15;
/** Margen de distancia del filtro de Explore. */
const LENGTH_MARGIN = 0.1;
/** Margen de desnivel, como la prueba de aceptación (±25 %); Explore lo redondea a 100 m. */
const GAIN_MARGIN = 0.25;

const round2 = (x: number) => Math.round(x * 100) / 100;
const round100 = (m: number) => Math.max(100, Math.round(m / 100) * 100);

/**
 * URL de Explore con los parámetros que lee su propio cliente (`parseParams` de `exploreQuerySlice`):
 * `b=p!{lng}!{lat}~{radio}km`, `length={min}*{max}km`, `ele={min}*{max}m`, `s` (firme), `m` (rutas) y
 * `a` (actividad). El inicio va redondeado a 0,01° (~1 km). Ver el plan `2026-11-12-explore-compartir.md`.
 */
export function rwgpsExploreUrl(ask: { start: LatLng; distanceKm: number; elevGainM: number | null }): string {
  const params: [string, string][] = [
    ['b', `p!${round2(ask.start.lng)}!${round2(ask.start.lat)}~${EXPLORE_RADIUS_KM}km`],
    ['length', `${Math.floor(ask.distanceKm * (1 - LENGTH_MARGIN))}*${Math.ceil(ask.distanceKm * (1 + LENGTH_MARGIN))}km`],
  ];
  if (ask.elevGainM !== null) params.push(['ele', `${round100(ask.elevGainM * (1 - GAIN_MARGIN))}*${round100(ask.elevGainM * (1 + GAIN_MARGIN))}m`]);
  params.push(['s', 'paved'], ['m', 'routes'], ['a', 'cycling:road']);
  return `${RWGPS_EXPLORE_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%21/g, '!').replace(/%2A/g, '*')}`).join('&')}`;
}

/** Una ruta que el usuario puede elegir para adaptar. */
export type RwgpsChoice = { id: string; label: string };

/**
 * Rutas de los enlaces pegados o compartidos: las rutas tal cual y, de cada colección, sus rutas (una
 * lectura por colección; las rutas no se leen hasta que el usuario elige). Una colección que falla se
 * explica en `failed`; sesión, cuota o servicio caído se lanzan.
 */
export async function listRwgpsChoices(links: RwgpsLink[], access: RwgpsAccess, signal?: AbortSignal): Promise<{ choices: RwgpsChoice[]; failed: string[] }> {
  const choices: RwgpsChoice[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    choices.push({ id, label });
  };
  for (const link of links) {
    if (link.kind === 'route') {
      add(link.id, `Ruta ${link.id}`);
      continue;
    }
    try {
      const { name, routeIds } = await fetchRwgpsCollection(link.id, access, signal);
      routeIds.forEach((id, i) => add(id, `${name} · ${i + 1} de ${routeIds.length}`));
    } catch (e) {
      if (signal?.aborted || (e instanceof RwgpsError && e.fatal) || !(e instanceof Error)) throw e;
      failed.push(`Colección ${link.id}: ${e.message}`);
    }
  }
  return { choices, failed };
}

/**
 * Lee la ruta elegida y la adapta para salir y volver al inicio (`mi-inicio`), con la espera de 60 s por el
 * límite por minuto de ORS. Una ruta privada, inexistente o que no se puede adaptar da `rejected` con el motivo.
 */
export async function adaptRwgpsChoice(
  choice: RwgpsChoice,
  target: RecommendTarget,
  deps: RecommendDeps & { rwgps: RwgpsAccess },
): Promise<{ proposal: Proposal } | { rejected: string }> {
  const load = async () => {
    try {
      return toReferenceRoute(await fetchRwgpsRoute(choice.id, deps.rwgps, deps.signal));
    } catch (e) {
      if (e instanceof RwgpsError && !e.fatal) return e.message;
      throw e;
    }
  };
  const { proposals, rejected } = await adaptCandidates([{ id: choice.id, name: choice.label, motivo: '', load }], target, deps, { want: 1, maxAttempts: 1 });
  return proposals[0] ? { proposal: proposals[0] } : { rejected: rejected[0]?.motivo ?? 'No se ha podido adaptar.' };
}
