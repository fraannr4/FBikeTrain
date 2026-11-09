import { needsBackup } from '../../backup/backup';
import type { ClimbEffort, Goal, PlannedWorkout, RouteSig, StoredActivity, VolumeGoal } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { daysUntil, volumeProgress, type VolumeKey } from '../../metrics/calendar';
import { groupClimbs } from '../../metrics/climbGroups';
import { groupRoutes } from '../../metrics/routes';
import { daysAgoLabel, formatCount, formatNumber } from '../format';

const DAY = 86_400_000;
const NO_RIDES = 'Aparecen al importar tus salidas';

export type MasData = {
  activities: StoredActivity[];
  efforts: ClimbEffort[];
  sigs: RouteSig[];
  workouts: PlannedWorkout[];
  goals: Goal[];
  lastImportAt?: number;
  lastBackupAt?: number;
  calendarChangedAt?: number;
};

export type MasSummary = {
  rides: number;
  distanceM: number;
  climbs: string;
  routes: string;
  calendar: string;
  /** Objetivo de volumen en curso: «201 de 800 km este mes» y el porcentaje. */
  goal: { text: string; pct?: number };
  import: string;
  /** `warn`: hay cambios en el calendario o los objetivos posteriores a la última copia. */
  backup: { text: string; warn: boolean };
};

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${formatCount(n)} ${many}`);
const ago = (t: number, now: number) => daysAgoLabel(Math.floor((now - t) / DAY));

const weekday = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: TZ });

/** «Domingo 8» de un día local `yyyy-MM-dd`. */
function weekdayLabel(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const text = weekday.format(Date.UTC(y, m - 1, day, 12)).replace(',', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function climbsText(efforts: ClimbEffort[], rides: number): string {
  if (efforts.length === 0) return rides === 0 ? NO_RIDES : 'Aún no hay subidas';
  const groups = groupClimbs(efforts);
  const repeated = groups.filter((g) => g.efforts.length >= 2).length;
  const total = count(groups.length, 'subida', 'subidas');
  return repeated > 0 ? `${total} · ${count(repeated, 'la repites', 'las repites')}` : total;
}

function routesText(sigs: RouteSig[], rides: number): string {
  if (rides === 0) return NO_RIDES;
  const groups = groupRoutes(sigs);
  return groups.length > 0 ? count(groups.length, 'ruta que repites', 'rutas que repites') : 'Aún no repites ninguna ruta';
}

function calendarText(workouts: PlannedWorkout[], now: number): string {
  const next = workouts
    .filter((w) => !w.done && daysUntil(w.date, now) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next) return 'Nada planificado';
  const days = daysUntil(next.date, now);
  const when = days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : weekdayLabel(next.date);
  return `${when}: ${next.title}`;
}

const UNIT: Record<VolumeKey, { unit: string; scale: number }> = {
  distanceM: { unit: 'km', scale: 1000 },
  elevGainM: { unit: 'm', scale: 1 },
  movingTimeS: { unit: 'h', scale: 3600 },
};

function goalSummary(goals: Goal[], acts: StoredActivity[], now: number): MasSummary['goal'] {
  const volume = goals.filter((g): g is VolumeGoal => g.kind === 'volume');
  for (const period of ['month', 'week'] as const) {
    for (const g of volume.filter((v) => v.period === period)) {
      const p = volumeProgress(g, acts, now);
      const first = p.targets[0];
      if (p.status !== 'current' || !first) continue;
      const { unit, scale } = UNIT[first.key];
      const when = period === 'month' ? 'este mes' : 'esta semana';
      return {
        text: `${formatNumber(first.value / scale)} de ${formatNumber(first.target / scale)} ${unit} ${when}`,
        pct: Math.round(first.pct),
      };
    }
  }
  return { text: 'Sin objetivos en curso' };
}

function backupSummary(d: MasData, now: number): MasSummary['backup'] {
  if (needsBackup(d)) {
    return {
      text: d.lastBackupAt !== undefined ? `Sin copiar desde el ${dayMonth.format(d.lastBackupAt).replace(/\.$/, '')}` : 'Hay cambios sin copiar',
      warn: true,
    };
  }
  return { text: d.lastBackupAt !== undefined ? `La última, ${ago(d.lastBackupAt, now)}` : 'Aún no has hecho ninguna', warn: false };
}

/**
 * Lo que dice cada fila de Más: cuántas subidas y rutas repites, el próximo entreno, el objetivo en
 * curso, la última importación y el estado de la copia. Todo sale de la lógica de F2-F5.
 */
export function masSummary(d: MasData, now: number): MasSummary {
  const rides = d.activities.length;
  return {
    rides,
    distanceM: d.activities.reduce((sum, a) => sum + a.totals.distanceM, 0),
    climbs: climbsText(d.efforts, rides),
    routes: routesText(d.sigs, rides),
    calendar: calendarText(d.workouts, now),
    goal: goalSummary(d.goals, d.activities, now),
    import: d.lastImportAt !== undefined ? `La última, ${ago(d.lastImportAt, now)}` : 'Aún no has importado',
    backup: backupSummary(d, now),
  };
}
