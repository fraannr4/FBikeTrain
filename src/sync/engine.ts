import { db, type SyncStateRow } from '../db/db';
import { importKey, newKey, open, seal } from './crypto';
import {
  isCatalogRoute, parseSyncKey, readLocal, removeLocal, scanLocal, syncKey, writeLocal, SyncDataError, type SyncKind,
} from './local';

/**
 * Motor de la sincronización entre dispositivos. Una pasada hace, en orden:
 *  1. anotar: compara lo que hay en local con lo anotado y marca altas, cambios y borrados;
 *  2. listar: pide a la cuenta lo cambiado desde la última vez y marca lo que falta descargar;
 *  3. descargar: trae y aplica lo marcado, salvo que el cambio local sea posterior;
 *  4. subir: envía lo marcado; la cuenta se queda con el cambio más reciente.
 * Todo queda anotado en `syncState`, así que una pasada interrumpida sigue donde lo dejó.
 */
export type RemoteItem = { kind: SyncKind; id: string; changedAt: number; payload: string | null };
export type RemoteChange = { seq: number; kind: SyncKind; id: string; changedAt: number; deleted: boolean };
export type PushResult = { kind: SyncKind; id: string; changedAt: number; accepted: boolean };
export type SyncRemote = {
  /** Devuelve la clave de la cuenta; si no hay, guarda la candidata. */
  key(candidate: string): Promise<string>;
  list(after: number, max: number): Promise<RemoteChange[]>;
  fetch(keys: Array<{ kind: SyncKind; id: string }>): Promise<RemoteItem[]>;
  push(items: RemoteItem[]): Promise<PushResult[]>;
};

export type SyncOptions = {
  /** Con datos móviles los tracks esperan: ni se suben ni se bajan. */
  deferTracks?: boolean;
  now?: () => number;
  signal?: AbortSignal;
};
export type SyncReport = {
  pulled: number;
  pushed: number;
  /** Tracks que esperan wifi, entre subidas y bajadas. */
  waitingTracks: number;
  /** Datos que no caben (contenido de más de ~3 MB cifrado) o que llegaron dañados. */
  skipped: number;
};

const CURSOR_KEY = '#cursor';
const KEY_KEY = '#key';
const LIST_PAGE = 500;
const FETCH_BATCH = 25;
const PUSH_BATCH = 40;
/** Tamaño máximo de un lote de subida y de un dato suelto, en caracteres de base64. */
const PUSH_BATCH_CHARS = 1_500_000;
const MAX_ITEM_CHARS = 3_900_000;

const isMeta = (key: string) => key.startsWith('#');
/** Las tablas que toca aplicar un dato de la cuenta, más la de anotaciones. Se leen al usarlas: la base cambia con la cuenta. */
const syncedTables = () => [db.activities, db.tracks, db.climbEfforts, db.routeSigs, db.calendar, db.goals, db.referenceRoutes, db.settings, db.syncState];
const aborted = (signal?: AbortSignal) => signal?.aborted === true;

async function metaValue<T>(key: string): Promise<T | undefined> {
  return (await db.syncState.get(key))?.value as T | undefined;
}
function putMeta(key: string, value: unknown): Promise<string> {
  return db.syncState.put({ key, hash: '', changedAt: 0, dirty: 0, pull: 0, deleted: false, value });
}

/** La clave de la cuenta: la guardada en este dispositivo o, la primera vez, la de la cuenta. */
async function accountKey(remote: SyncRemote): Promise<CryptoKey> {
  let stored = await metaValue<string>(KEY_KEY);
  if (!stored) {
    stored = await remote.key(newKey());
    await putMeta(KEY_KEY, stored);
  }
  return importKey(stored);
}

/**
 * Paso 1. Solo local, funciona sin red. La primera vez que un dato se anota lleva su propia fecha
 * (no la de ahora): así, al estrenar la sincronización en un dispositivo con datos antiguos, no
 * pisa lo más reciente de otro.
 */
export async function scan(now: number): Promise<number> {
  const states = new Map((await db.syncState.toArray()).map((s) => [s.key, s]));
  const local = await scanLocal((key, hash) => {
    const s = states.get(key);
    return s !== undefined && !s.deleted && s.hash === hash;
  });
  const changes: SyncStateRow[] = [];
  for (const [key, entry] of local) {
    const state = states.get(key);
    if (state && !state.deleted && state.hash === entry.hash) continue;
    if (entry.unknownRoute) {
      const { id } = parseSyncKey(key)!;
      if (await isCatalogRoute(id)) {
        changes.push({ key, hash: entry.hash, changedAt: 0, dirty: 0, pull: 0, deleted: false, skip: true });
        continue;
      }
    }
    // Anotado solo para bajar (aún sin descargar) cuenta como dato nuevo en este dispositivo.
    const seen = state !== undefined && (state.hash !== '' || state.deleted);
    changes.push({
      key, hash: entry.hash, changedAt: seen ? now : Math.min(entry.stamp, now), dirty: 1, deleted: false,
      // Si además hay una versión pendiente de bajar, se decide al descargar por fecha.
      pull: state?.pull ?? 0,
    });
  }
  for (const state of states.values()) {
    if (isMeta(state.key) || local.has(state.key) || state.deleted) continue;
    // Anotado para bajar y aún no descargado: no es un borrado.
    if (state.pull && state.hash === '') continue;
    if (state.skip) { changes.push({ ...state, deleted: true }); continue; }
    changes.push({ key: state.key, hash: '', changedAt: now, dirty: 1, pull: state.pull, deleted: true });
  }
  if (changes.length > 0) await db.syncState.bulkPut(changes);
  return changes.length;
}

/** Paso 2. Marca lo que hay que descargar y avanza el cursor. */
async function listRemote(remote: SyncRemote, signal?: AbortSignal): Promise<void> {
  for (;;) {
    if (aborted(signal)) return;
    const cursor = (await metaValue<number>(CURSOR_KEY)) ?? 0;
    const page = await remote.list(cursor, LIST_PAGE);
    if (page.length === 0) return;
    const keys = page.map((c) => syncKey(c.kind, c.id));
    const states = await db.syncState.bulkGet(keys);
    const marks: SyncStateRow[] = [];
    page.forEach((change, i) => {
      const state = states[i];
      // Lo que este dispositivo subió vuelve en la lista: misma fecha y mismo estado, nada que bajar.
      if (state && !state.dirty && !state.pull && state.changedAt === change.changedAt && state.deleted === change.deleted) return;
      marks.push(state
        ? { ...state, pull: 1 }
        : { key: keys[i], hash: '', changedAt: 0, dirty: 0, pull: 1, deleted: false });
    });
    await db.transaction('rw', db.syncState, async () => {
      if (marks.length > 0) await db.syncState.bulkPut(marks);
      await putMeta(CURSOR_KEY, page[page.length - 1].seq);
    });
    if (page.length < LIST_PAGE) return;
  }
}

/** Paso 3. Descarga y aplica. Devuelve cuántos datos cambió en local. */
async function pullMarked(remote: SyncRemote, key: CryptoKey, report: SyncReport, opts: SyncOptions): Promise<void> {
  const marked = (await db.syncState.where('pull').equals(1).toArray()).filter((s) => !isMeta(s.key));
  const wanted = marked.filter((s) => {
    if (!opts.deferTracks || parseSyncKey(s.key)?.kind !== 'track') return true;
    report.waitingTracks += 1;
    return false;
  });
  const now = opts.now ?? Date.now;
  // Primero lo ligero (salidas, plan, ajustes) y al final los tracks, que pesan.
  wanted.sort((a, b) => Number(a.key.startsWith('track:')) - Number(b.key.startsWith('track:')));
  for (let from = 0; from < wanted.length; from += FETCH_BATCH) {
    if (aborted(opts.signal)) return;
    const batch = wanted.slice(from, from + FETCH_BATCH);
    const items = await remote.fetch(batch.map((s) => parseSyncKey(s.key)!));
    const byKey = new Map(items.map((item) => [syncKey(item.kind, item.id), item]));
    for (const mark of batch) {
      const item = byKey.get(mark.key);
      // La fila ya no está en la cuenta: no hay nada que bajar.
      if (!item) { await db.syncState.update(mark.key, { pull: 0 }); continue; }
      // Se relee: el dato pudo cambiar en local mientras se descargaba.
      const state = (await db.syncState.get(mark.key)) ?? mark;
      if (state.dirty && state.changedAt > item.changedAt) { await db.syncState.update(mark.key, { pull: 0 }); continue; }
      const { kind, id } = item;
      // Dato local que este dispositivo aún no había sincronizado y que no trae fecha propia (salidas,
      // tracks, ajustes): no se sabe cuál es más reciente, así que nunca se pierde lo local. Un borrado
      // de la cuenta no lo borra y los ajustes se combinan; en los dos casos lo local se sube después.
      const unstamped = state.dirty === 1 && state.changedAt === 0 && !state.deleted && state.hash !== '';
      if (unstamped && item.payload === null) {
        await db.syncState.update(mark.key, { pull: 0, changedAt: now() });
        continue;
      }
      const merge = unstamped && kind === 'settings';
      // Un dato dañado o cifrado con otra clave se salta; un fallo de la base local sí detiene la pasada.
      let value: unknown;
      let readable = true;
      if (item.payload !== null) {
        try { value = await open(key, mark.key, item.payload); } catch { readable = false; }
      }
      try {
        if (!readable) throw new SyncDataError(mark.key);
        // El dato y su anotación van en una sola transacción: si la pasada se corta, no queda un dato
        // descargado que la siguiente tome por un cambio hecho aquí.
        await db.transaction('rw', syncedTables(), async () => {
          if (item.payload === null) {
            await removeLocal(kind, id);
            await db.syncState.put({ key: mark.key, hash: '', changedAt: item.changedAt, dirty: 0, pull: 0, deleted: true });
          } else {
            const hash = await writeLocal(kind, id, value, merge);
            await db.syncState.put(merge
              ? { key: mark.key, hash, changedAt: now(), dirty: 1, pull: 0, deleted: false }
              : { key: mark.key, hash, changedAt: item.changedAt, dirty: 0, pull: 0, deleted: false });
          }
        });
        report.pulled += 1;
      } catch (cause) {
        if (!(cause instanceof SyncDataError)) throw cause;
        report.skipped += 1;
        // Sin fila local que anotar, la marca se quita; si había dato local, se conserva tal cual.
        if (state.hash === '' && !state.deleted) await db.syncState.delete(mark.key);
        else await db.syncState.update(mark.key, { pull: 0 });
      }
    }
  }
}

/** Paso 4. Sube lo pendiente por lotes. */
async function pushDirty(remote: SyncRemote, key: CryptoKey, report: SyncReport, opts: SyncOptions): Promise<void> {
  const dirty = (await db.syncState.where('dirty').equals(1).toArray()).filter((s) => !isMeta(s.key) && !s.skip);
  const pending = dirty.filter((s) => {
    if (!opts.deferTracks || s.deleted || parseSyncKey(s.key)?.kind !== 'track') return true;
    report.waitingTracks += 1;
    return false;
  });
  // Primero los borrados, en su propio lote: liberan sitio y pasan aunque la cuenta esté llena.
  // Después lo ligero y al final los tracks.
  const order = (s: SyncStateRow) => (s.deleted ? 0 : s.key.startsWith('track:') ? 2 : 1);
  pending.sort((a, b) => order(a) - order(b));
  let batch: Array<{ state: SyncStateRow; item: RemoteItem }> = [];
  let chars = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const sent = batch;
    batch = [];
    chars = 0;
    const results = new Map((await remote.push(sent.map((b) => b.item))).map((r) => [syncKey(r.kind, r.id), r]));
    await db.transaction('rw', db.syncState, async () => {
      for (const { state } of sent) {
        const result = results.get(state.key);
        const current = await db.syncState.get(state.key);
        // Cambió otra vez mientras se subía: sigue pendiente.
        if (!result || !current || current.changedAt !== state.changedAt || current.hash !== state.hash) continue;
        // Aceptado: se anota la fecha que guardó la cuenta. Rechazado: la cuenta tiene algo más
        // nuevo, que llegará en la siguiente lista.
        await db.syncState.put({ ...current, dirty: 0, ...(result.accepted ? { changedAt: result.changedAt } : {}) });
        if (result.accepted) report.pushed += 1;
      }
    });
  };
  for (const state of pending) {
    if (aborted(opts.signal)) return;
    const { kind, id } = parseSyncKey(state.key)!;
    let payload: string | null = null;
    if (!state.deleted) {
      const value = await readLocal(kind, id);
      // Desapareció después de anotarlo: la siguiente pasada lo anota como borrado.
      if (value === undefined) continue;
      payload = await seal(key, state.key, value);
      if (payload.length > MAX_ITEM_CHARS) {
        report.skipped += 1;
        await db.syncState.update(state.key, { dirty: 0 });
        continue;
      }
    }
    const size = payload?.length ?? 0;
    if (batch.length > 0 && batch[batch.length - 1].state.deleted !== state.deleted) await flush();
    if (batch.length >= PUSH_BATCH || (batch.length > 0 && chars + size > PUSH_BATCH_CHARS)) await flush();
    batch.push({ state, item: { kind, id, changedAt: state.changedAt, payload } });
    chars += size;
  }
  await flush();
}

/** Una pasada completa. Lanza si falla la red o la cuenta; lo ya hecho queda anotado. */
export async function syncOnce(remote: SyncRemote, opts: SyncOptions = {}): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, pushed: 0, waitingTracks: 0, skipped: 0 };
  await scan((opts.now ?? Date.now)());
  const key = await accountKey(remote);
  await listRemote(remote, opts.signal);
  await pullMarked(remote, key, report, opts);
  // Lo descargado cambia el estado local: se anota antes de subir para no reenviarlo.
  if (report.pulled > 0) await scan((opts.now ?? Date.now)());
  await pushDirty(remote, key, report, opts);
  return report;
}

/** Datos anotados que aún no están en la cuenta. */
export function pendingCount(): Promise<number> {
  return db.syncState.where('dirty').equals(1).count();
}
