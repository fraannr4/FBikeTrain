import type { ParsedActivity, StoredActivity, TrackPoint } from '../domain/types';
import { analyzeActivity, saveAnalysis } from '../analysis/analysis';
import { syncCalendar } from '../calendar/sync';
import { listActivities, saveActivity, setLastImportAt } from '../db/repo';
import { saveStravaRoute, stravaRouteRefs } from '../routes/library';
import { findActivitiesCsv, parseEntry, readArchiveEntries, zipEntries, type ArchiveEntries } from './stravaArchive';
import { readArchiveRoutes } from './stravaRoutes';
import { haversineM, isTooShort } from './summary';

/**
 * `notCycling`: actividades descartadas por no ser de ciclismo (carreras, caminatas…).
 * `tooShort`: salidas descartadas por demasiado cortas (< 200 m o < 60 s en movimiento). Ninguna de las dos es un error.
 * `noGps`: salidas añadidas sin posiciones (rodillo), con el fichero del que salen.
 * `withCadence`: salidas añadidas que traen cadencia media.
 * `routesAdded`: rutas de `routes/` del archivo de Strava añadidas a la biblioteca (sin contar las que ya estaban).
 */
export type ImportReport = {
  added: number;
  duplicates: number;
  notCycling: number;
  tooShort: number;
  skipped: { file: string; reason: string }[];
  noGps: { file: string; startTime: number }[];
  withCadence: number;
  routesAdded: number;
};

/**
 * 'open': abrir el ZIP o la carpeta y leer `activities.csv`. 'activities': leer y guardar cada salida.
 * 'finish': anotar la fecha de la importación.
 */
export type ImportPhase = 'open' | 'activities' | 'finish';

/** Fichero elegido o soltado dentro de una carpeta, con su ruta relativa (`export_1/activities/1.gpx`). */
export type FolderFile = { path: string; file: File };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DUPLICATE_START_MS = 60_000;
const DUPLICATE_DISTANCE_RATIO = 0.02;

/** Clave de la salida, que sirve de `id`: inicio redondeado al minuto y distancia a 100 m. */
export function activityKey(a: Pick<ParsedActivity, 'startTime' | 'totals'>): string {
  return `${Math.round(a.startTime / MINUTE_MS) * MINUTE_MS}-${Math.round(a.totals.distanceM / 100) * 100}`;
}

/**
 * Misma salida si el inicio difiere ≤ 60 s y la distancia ≤ 2 % (de la mayor de las dos).
 * También si la clave coincide, porque es el `id` con el que se guardaría.
 */
export function isDuplicate(a: ParsedActivity, existing: StoredActivity[]): boolean {
  const key = activityKey(a);
  return existing.some(
    (e) =>
      e.id === key ||
      (Math.abs(e.startTime - a.startTime) <= DUPLICATE_START_MS &&
        Math.abs(e.totals.distanceM - a.totals.distanceM) <=
          DUPLICATE_DISTANCE_RATIO * Math.max(e.totals.distanceM, a.totals.distanceM)),
  );
}

/**
 * Track simplificado: solo puntos con GPS, cada uno a ≥ `minSpacingM` del anterior guardado.
 * El último punto se conserva siempre para que el track acabe donde acabó la salida.
 */
export function downsample(points: TrackPoint[], minSpacingM = 15): TrackPoint[] {
  const gps = points.filter((p) => p.lat !== undefined && p.lng !== undefined);
  const kept: TrackPoint[] = [];
  for (const p of gps) {
    const last = kept.at(-1);
    if (!last || haversineM(last.lat!, last.lng!, p.lat!, p.lng!) >= minSpacingM) kept.push(p);
  }
  const end = gps.at(-1);
  if (end && kept.at(-1) !== end) kept.push(end);
  return kept;
}

const isZip = (name: string) => name.toLowerCase().endsWith('.zip');

/**
 * Importa ficheros sueltos (FIT, GPX y TCX, con o sin `.gz`) y archivos de Strava, en `.zip` o
 * descomprimidos en una carpeta (los `FolderFile` que traen `activities.csv`; si no lo traen, se
 * importan como sueltos). Lo que no es ciclismo solo se cuenta. Un fichero que no se puede leer va a
 * `skipped` y la importación sigue con los demás.
 * Progreso: cada fichero suelto cuenta 1; un archivo pasa a contar sus filas de ciclismo cuando se conocen.
 * Cada archivo avisa con 'open' antes de leer su CSV, y al final llega un único 'finish'.
 */
export async function importFiles(
  files: (File | FolderFile)[],
  onProgress?: (done: number, total: number, phase: ImportPhase) => void,
): Promise<ImportReport> {
  const report: ImportReport = { added: 0, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0, routesAdded: 0 };
  const folder = files.filter((f): f is FolderFile => !(f instanceof File));
  const folderEntries = new Map(folder.map((f) => [f.path, () => f.file.arrayBuffer()]));
  const folderIsArchive = findActivitiesCsv(folderEntries.keys()) !== undefined;
  const loose = files.flatMap((f) =>
    f instanceof File ? [{ name: f.name, file: f }] : folderIsArchive ? [] : [{ name: f.path, file: f.file }],
  );

  let done = 0;
  let total = loose.length + (folderIsArchive ? 1 : 0);
  const tick = () => onProgress?.(++done, total, 'activities');

  /** `file`: nombre del fichero suelto, ruta relativa de la carpeta o ruta dentro del archivo. */
  const store = async (a: ParsedActivity, file: string) => {
    if (a.sport !== 'cycling') {
      report.notCycling++;
      return;
    }
    if (isTooShort(a.totals)) {
      report.tooShort++;
      return;
    }
    // Basta con mirar las del mismo día: el índice `startTime` evita leer todo el historial.
    const sameDay = await listActivities({ from: a.startTime - DAY_MS, to: a.startTime + DAY_MS });
    if (isDuplicate(a, sameDay)) {
      report.duplicates++;
      return;
    }
    const track = downsample(a.points);
    const activity: StoredActivity = {
      id: activityKey(a),
      startTime: a.startTime,
      sport: 'cycling',
      ...(a.name ? { name: a.name } : {}),
      totals: a.totals,
      hasTrack: track.length > 0,
      source: a.source,
      importedAt: Date.now(),
    };
    await saveActivity(activity, track);
    // Se analiza el track guardado (el simplificado), igual que hará `ensureAnalysis`.
    if (activity.hasTrack) await saveAnalysis(analyzeActivity(activity, track));
    report.added++;
    if (!activity.hasTrack) report.noGps.push({ file, startTime: a.startTime });
    if (a.totals.avgCadence !== undefined) report.withCadence++;
  };

  /**
   * Rutas de `routes/`: cada una se guarda al leerla, sin acumularlas. Las que ya están (misma huella) se
   * saltan; las que no son de bici se ignoran (no son salidas). No cuentan en el progreso.
   */
  const importRoutes = async (entries: ArchiveEntries) => {
    const known = await stravaRouteRefs();
    for await (const item of readArchiveRoutes(entries)) {
      if (!item.ok) {
        if ('reason' in item) report.skipped.push({ file: item.file, reason: item.reason });
      } else if (!known.has(item.ref)) {
        await saveStravaRoute(item.route, item.ref);
        known.add(item.ref);
        report.routesAdded++;
      }
    }
  };

  /** Un archivo cuenta 1 en el progreso hasta que se conocen sus filas de ciclismo; después lee sus rutas. */
  const importArchive = async (name: string, open: () => Promise<ArchiveEntries>) => {
    let rows = 0;
    onProgress?.(done, total, 'open');
    try {
      const entries = await open();
      for await (const item of readArchiveEntries(entries, (_done, t) => {
        if (rows === 0) total += t - 1;
        rows = t;
        tick();
      })) {
        if (item.ok) await store(item.activity, item.file);
        else if ('notCycling' in item) report.notCycling++;
        else report.skipped.push({ file: item.file, reason: item.reason });
      }
      await importRoutes(entries);
    } catch (e) {
      report.skipped.push({ file: name, reason: (e as Error).message });
    }
    if (rows === 0) tick();
  };

  for (const { name, file } of loose) {
    if (isZip(name)) {
      await importArchive(name, () => zipEntries(file));
    } else {
      let parsed: ParsedActivity | undefined;
      try {
        parsed = parseEntry(name, await file.arrayBuffer());
      } catch (e) {
        report.skipped.push({ file: name, reason: (e as Error).message });
      }
      if (parsed) await store(parsed, name);
      tick();
    }
  }
  if (folderIsArchive) await importArchive('carpeta del archivo', async () => folderEntries);

  onProgress?.(done, total, 'finish');
  await setLastImportAt(Date.now());
  await syncCalendar();
  return report;
}
