import JSZip from 'jszip';
import { gunzipSync } from 'fflate';
import Papa from 'papaparse';
import { ParseError, type ParsedActivity } from '../domain/types';
import { parseFit } from './fit';
import { parseGpx } from './gpx';
import { parseTcx } from './tcx';

/**
 * Cabeceras de `activities.csv`. Strava las traduce al idioma de la cuenta, así que cada campo
 * acepta la variante en castellano y la inglesa (docs/verificaciones.md, tarea 1).
 */
export const STRAVA_COLUMNS = {
  id: ['ID de actividad', 'Activity ID'],
  name: ['Nombre de la actividad', 'Activity Name'],
  type: ['Tipo de actividad', 'Activity Type'],
  filename: ['Nombre del archivo', 'Filename'],
} as const;

/** Valores de `Activity Type` que son ciclismo. En castellano solo está confirmado `Bicicleta`. */
export const CYCLING_TYPES: ReadonlySet<string> = new Set([
  'Ride',
  'Virtual Ride',
  'E-Bike Ride',
  'Gravel Ride',
  'Mountain Bike Ride',
  'Bicicleta',
]);

export type ArchiveItem =
  | { ok: true; activity: ParsedActivity; file: string }
  | { ok: false; file: string; reason: string }
  | { ok: false; notCycling: true; file: string };

/** Entradas de un archivo de Strava por ruta (`export_1/activities/1.gpx`), venga en ZIP o descomprimido en una carpeta. */
export type ArchiveEntries = Map<string, () => Promise<ArrayBuffer>>;

type Row = { id: string; name: string; filename: string; cycling: boolean };

/** Índice de cada campo en la cabecera. Hay nombres repetidos: gana la primera aparición. */
function columnIndexes(header: string[]): Record<keyof typeof STRAVA_COLUMNS, number> {
  const find = (field: keyof typeof STRAVA_COLUMNS) => {
    const i = header.findIndex((h) => (STRAVA_COLUMNS[field] as readonly string[]).includes(h.trim()));
    if (i < 0) throw new ParseError('unsupported', `activities.csv no tiene la columna ${STRAVA_COLUMNS[field].join(' / ')}`);
    return i;
  };
  return { id: find('id'), name: find('name'), type: find('type'), filename: find('filename') };
}

/** Filas del CSV, marcando cuáles son de ciclismo. */
function csvRows(csv: string): Row[] {
  const [header, ...rows] = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
  if (!header) throw new ParseError('empty', 'activities.csv está vacío');
  const col = columnIndexes(header);
  const cell = (r: string[], field: keyof typeof STRAVA_COLUMNS) => (r[col[field]] ?? '').trim();
  return rows.map((r) => ({
    id: cell(r, 'id'),
    name: cell(r, 'name'),
    filename: cell(r, 'filename'),
    cycling: CYCLING_TYPES.has(cell(r, 'type')),
  }));
}

/** Elige el lector por extensión, descomprimiendo antes los `.gz`. */
export function parseEntry(filename: string, buf: ArrayBuffer): ParsedActivity {
  const lower = filename.toLowerCase();
  const gz = lower.endsWith('.gz');
  const bytes = gz ? gunzipSync(new Uint8Array(buf)) : new Uint8Array(buf);
  const ext = (gz ? lower.slice(0, -3) : lower).split('.').pop();
  if (ext === 'fit') return parseFit(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (ext === 'gpx') return parseGpx(new TextDecoder().decode(bytes));
  if (ext === 'tcx') return parseTcx(new TextDecoder().decode(bytes));
  throw new ParseError('unsupported', 'formato no soportado');
}

/**
 * Ruta de `activities.csv` entre las entradas. Si el usuario lo volvió a comprimir o eligió la carpeta,
 * va dentro de una carpeta (`export_1/activities.csv`): gana la ruta más corta.
 */
export function findActivitiesCsv(paths: Iterable<string>): string | undefined {
  const found = [...paths].filter((p) => p === 'activities.csv' || p.endsWith('/activities.csv'));
  return found.sort((a, b) => a.length - b.length)[0];
}

/**
 * Lee el ZIP de «Descargar tu cuenta» de Strava. Las entradas se descomprimen de una en una.
 * Supuesto: JSZip mantiene en memoria el ZIP comprimido (el de esta cuenta pesa 3,8 MB).
 */
export async function* readStravaArchive(
  zip: Blob,
  onProgress?: (done: number, total: number) => void,
): AsyncGenerator<ArchiveItem> {
  const archive = await JSZip.loadAsync(zip);
  const entries: ArchiveEntries = new Map();
  archive.forEach((path, entry) => {
    if (!entry.dir) entries.set(path, () => entry.async('arraybuffer'));
  });
  yield* readArchiveEntries(entries, onProgress);
}

/**
 * Lee un archivo de Strava, en ZIP o en carpeta. El nombre y el tipo salen del CSV; la hora de inicio y
 * los totales, del fichero de la actividad. Las filas que no son de ciclismo salen marcadas sin leer
 * su fichero. `onProgress` cuenta solo las filas de ciclismo. Sin `activities.csv` lanza ParseError.
 */
export async function* readArchiveEntries(
  entries: ArchiveEntries,
  onProgress?: (done: number, total: number) => void,
): AsyncGenerator<ArchiveItem> {
  const csvPath = findActivitiesCsv(entries.keys());
  if (!csvPath) throw new ParseError('unsupported', 'No es un archivo de Strava: falta activities.csv');
  const base = csvPath.slice(0, -'activities.csv'.length);
  const rows = csvRows(new TextDecoder().decode(await entries.get(csvPath)!()));
  const total = rows.filter((r) => r.cycling).length;
  let done = 0;

  for (const row of rows) {
    if (!row.cycling) {
      yield { ok: false, notCycling: true, file: row.filename || `actividad ${row.id}` };
      continue;
    }
    const read = row.filename ? entries.get(base + row.filename) : undefined;
    if (!read) {
      yield { ok: false, file: row.filename || `actividad ${row.id}`, reason: 'sin fichero' };
    } else {
      try {
        const parsed = parseEntry(row.filename, await read());
        yield {
          ok: true,
          activity: {
            ...parsed,
            sport: 'cycling',
            ...(row.name ? { name: row.name } : {}),
            source: 'strava-archive',
            externalId: row.id,
          },
          file: row.filename,
        };
      } catch (e) {
        yield { ok: false, file: row.filename, reason: (e as Error).message };
      }
    }
    onProgress?.(++done, total);
  }
}
