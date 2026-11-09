import { newId } from '../calendar/calendarRepo';
import type { Goal, LocalDate, PlannedWorkout, Settings } from '../domain/types';
import { addDays, diffDays } from '../ui/calendarGrid';
import type { LevelSummary } from './contracts';
import { chatJson, LlmError, type LlmErrorKind } from './llm';
import { buildWorkoutMessages, type WeekGoal, type WeekInput } from './prompts';
import { chatWithRetry } from './routePlanner';
import { toStrictJsonSchema, WorkoutWeekSchema, type WorkoutWeek } from './schema';
import type { SharedWorkoutPlanner } from './sharedClient';

/**
 * Entrenos de la semana propuestos por la IA. La IA recibe el resumen del nivel, el objetivo más
 * próximo sin nombre y los días; el código recorta las cifras y descarta los días que no valen.
 */

/** Ninguna salida pasa de un 15 % sobre la referencia del usuario. */
const MAX_UPLIFT = 1.15;
const INVALID = 'La IA no ha devuelto entrenos válidos. No se ha guardado nada: vuelve a intentarlo.';
const NONE_LEFT = 'La IA no ha propuesto ningún entreno en tus días libres. No se ha guardado nada: vuelve a intentarlo.';
const NO_AI = 'Configura una clave de IA en Ajustes para proponer la semana.';

export type WeekRequest = WeekInput & { summary: LevelSummary };
export type ProposedWorkout = WorkoutWeek['entrenos'][number];
export type WeekProposal =
  | { ok: true; entrenos: ProposedWorkout[]; motivo: string; descartadas: number }
  | { ok: false; message: string; cause: LlmErrorKind };

export type WorkoutPlannerDeps = {
  /** Clave propia de Ajustes; sin clave o sin modelo, no se usa. */
  personal: Settings['llm'] | null;
  shared?: SharedWorkoutPlanner;
  chat?: typeof chatJson;
  signal?: AbortSignal;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/** El objetivo con fecha (evento) más próximo desde hoy, sin nombre ni lugar; `null` si no hay. */
export function nextGoal(goals: Goal[], today: LocalDate): WeekGoal | null {
  const next = goals
    .flatMap((g) => (g.kind === 'event' && g.date >= today ? [g] : []))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next) return null;
  return {
    diasHasta: diffDays(next.date, today),
    distanciaKm: next.distanceM ? round1(next.distanceM / 1000) : null,
    desnivelM: next.elevGainM ? Math.round(next.elevGainM) : null,
  };
}

/** Días de los próximos 7 (índices desde hoy) que ya tienen algún entreno. */
export function busyDays(workouts: PlannedWorkout[], today: LocalDate): number[] {
  const days = new Set<number>();
  for (const w of workouts) {
    const d = diffDays(w.date, today);
    if (d >= 0 && d <= 6) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * Recorte en código: cifras hasta un 15 % sobre la referencia; fuera los días ocupados, no
 * disponibles o repetidos; y como mucho una salida larga (por encima de la distancia media): la más larga.
 */
export function trimWeek(week: WorkoutWeek, req: WeekRequest): { entrenos: ProposedWorkout[]; descartadas: number } {
  const maxKm = round1(req.summary.distanciaMediaKm * MAX_UPLIFT);
  const maxM = Math.round(req.summary.desnivelMedioM * MAX_UPLIFT);
  const used = new Set(req.ocupados);
  const free = new Set(req.disponibles);
  let kept: ProposedWorkout[] = [];
  for (const e of week.entrenos) {
    if (used.has(e.dia) || !free.has(e.dia)) continue;
    const distanciaKm = Math.min(e.distanciaKm, maxKm);
    // Con una referencia de 0 km el recorte dejaría un entreno vacío: se descarta.
    if (!(distanciaKm > 0)) continue;
    used.add(e.dia);
    kept.push({
      ...e,
      distanciaKm,
      desnivelM: e.desnivelM === null ? null : Math.min(e.desnivelM, maxM),
    });
  }
  const long = kept.filter((e) => e.distanciaKm > req.summary.distanciaMediaKm);
  if (long.length > 1) {
    const longest = long.reduce((a, b) => (b.distanciaKm > a.distanciaKm ? b : a));
    kept = kept.filter((e) => e === longest || !long.includes(e));
  }
  kept.sort((a, b) => a.dia - b.dia);
  return { entrenos: kept, descartadas: week.entrenos.length - kept.length };
}

function toProposal(week: WorkoutWeek, req: WeekRequest): WeekProposal {
  const { entrenos, descartadas } = trimWeek(week, req);
  if (entrenos.length === 0) return { ok: false, message: NONE_LEFT, cause: 'invalid_json' };
  return { ok: true, entrenos, motivo: week.motivo, descartadas };
}

const failure = (e: LlmError): WeekProposal => ({
  ok: false,
  cause: e.kind,
  message: e.kind === 'invalid_json' ? INVALID : e.message,
});

/**
 * Pide la semana al servicio común si lo hay y, si no, con la clave propia. Con el servicio caído o
 * sin red se prueba la clave propia; con la cuota agotada (429), no. Un JSON no válido se repite una vez.
 */
export async function proposeWeek(req: WeekRequest, deps: WorkoutPlannerDeps): Promise<WeekProposal> {
  const { summary, ...input } = req;
  const personal = deps.personal?.apiKey.trim() && deps.personal.model.trim() ? deps.personal : null;

  async function viaPersonal(cfg: Settings['llm']): Promise<WeekProposal> {
    const out = await chatWithRetry(
      cfg,
      {
        messages: buildWorkoutMessages(summary, input),
        schemaName: 'entrenos_semana',
        jsonSchema: toStrictJsonSchema(WorkoutWeekSchema),
        schema: WorkoutWeekSchema,
        signal: deps.signal,
      },
      deps.chat ?? chatJson,
    );
    return out.ok ? toProposal(out.data, req) : failure(out.error);
  }

  if (deps.shared) {
    try {
      return toProposal(await deps.shared.workouts(summary, input, deps.signal), req);
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      if (personal && (e.kind === 'network' || e.kind === 'unavailable')) return viaPersonal(personal);
      return failure(e);
    }
  }
  return personal ? viaPersonal(personal) : { ok: false, message: NO_AI, cause: 'no_model' };
}

/** Entrenos aceptados como `PlannedWorkout`: fecha desde hoy (Madrid), sin hacer y con notas «IA:». */
export function toPlannedWorkouts(entrenos: ProposedWorkout[], today: LocalDate, now: number): PlannedWorkout[] {
  return entrenos.map((e) => ({
    id: newId(),
    date: addDays(today, e.dia),
    title: e.titulo,
    distanceM: Math.round(e.distanciaKm * 1000),
    ...(e.desnivelM !== null ? { elevGainM: Math.round(e.desnivelM) } : {}),
    notes: `IA: ${e.notas}`.trim(),
    done: false,
    manual: false,
    createdAt: now,
  }));
}
