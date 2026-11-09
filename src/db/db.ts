import Dexie, { type Table } from 'dexie';
import type { ClimbEffort, Goal, PlannedWorkout, RouteSig, Settings, StoredActivity, TrackPoint } from '../domain/types';
import type { ReferenceRoute } from '../routes/library';

export type SettingsRow = { key: 'app'; value: Settings };
export type MetaRow = { key: string; value: unknown };
/** Track simplificado de una actividad; solo existe si la actividad tiene GPS. */
export type TrackRow = { activityId: string; points: TrackPoint[] };
/** Firma del trazado guardada, con la versión del análisis que la calculó. */
export type RouteSigRow = RouteSig & { analysisVersion: number };

export class CyclingDb extends Dexie {
  activities!: Table<StoredActivity, string>;
  tracks!: Table<TrackRow, string>;
  settings!: Table<SettingsRow, string>;
  meta!: Table<MetaRow, string>;
  climbEfforts!: Table<ClimbEffort, string>;
  routeSigs!: Table<RouteSigRow, string>;
  calendar!: Table<PlannedWorkout, string>;
  goals!: Table<Goal, string>;
  referenceRoutes!: Table<ReferenceRoute, string>;

  constructor(name = 'ciclismo') {
    super(name);
    this.version(1).stores({
      activities: 'id, startTime',
      tracks: 'activityId',
      settings: 'key',
      meta: 'key',
    });
    this.version(2).stores({
      climbEfforts: 'id, activityId',
      routeSigs: 'activityId, distanceM',
    });
    this.version(3).stores({
      calendar: 'id, date',
      goals: 'id, kind',
    });
    this.version(4).stores({
      referenceRoutes: 'id, updatedAt',
    });
  }
}

export let db = new CyclingDb();

/** Solo antes de montar pantallas o iniciar el Worker; nunca migra ni borra la base antigua. */
export function useDatabase(name: string): void {
  if (db.name === name) return;
  db.close();
  db = new CyclingDb(name);
}
