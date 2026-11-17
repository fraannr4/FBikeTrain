import { db, useDatabase } from '../src/db/db';
import { clearAllData, saveActivity } from '../src/db/repo';
import type { PlannedWorkout, StoredActivity, TrackPoint } from '../src/domain/types';
import { saveSettings, loadSettings, DEFAULT_SETTINGS } from '../src/settings/settings';
import { importKey, newKey, open, seal } from '../src/sync/crypto';
import { pendingCount, syncOnce, type RemoteItem, type SyncRemote } from '../src/sync/engine';
import { syncKey } from '../src/sync/local';

/** La cuenta, en memoria, con las mismas reglas que las funciones SQL: gana el cambio más reciente. */
function fakeAccount() {
  const rows = new Map<string, RemoteItem & { seq: number }>();
  let seq = 0;
  let stored: string | null = null;
  const calls = { list: 0, fetch: 0, push: 0, fetched: [] as string[], pushed: [] as string[] };
  const remote: SyncRemote = {
    async key(candidate) { stored ??= candidate; return stored; },
    async list(after, max) {
      calls.list++;
      return [...rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, max)
        .map((r) => ({ seq: r.seq, kind: r.kind, id: r.id, changedAt: r.changedAt, deleted: r.payload === null }));
    },
    async fetch(keys) {
      calls.fetch++;
      return keys.flatMap((k) => {
        const row = rows.get(syncKey(k.kind, k.id));
        if (row) calls.fetched.push(syncKey(k.kind, k.id));
        return row ? [{ kind: row.kind, id: row.id, changedAt: row.changedAt, payload: row.payload }] : [];
      });
    },
    async push(items) {
      calls.push++;
      return items.map((item) => {
        const key = syncKey(item.kind, item.id);
        const changedAt = Math.min(item.changedAt, Date.now());
        const old = rows.get(key);
        if (old && old.changedAt >= changedAt) return { kind: item.kind, id: item.id, changedAt: old.changedAt, accepted: false };
        rows.set(key, { ...item, changedAt, seq: ++seq });
        calls.pushed.push(key);
        return { kind: item.kind, id: item.id, changedAt, accepted: true };
      });
    },
  };
  return { remote, rows, calls };
}

let counter = 0;
/** Cada «dispositivo» es una base propia de la misma cuenta. */
function device(): string {
  return `sync-test-${++counter}-${Math.random().toString(36).slice(2)}`;
}
async function on<T>(name: string, fn: () => Promise<T>): Promise<T> {
  useDatabase(name);
  await db.open();
  return fn();
}

const ride = (id: string, startTime = 1_700_000_000_000): StoredActivity => ({
  id, startTime, sport: 'cycling', name: 'Vuelta', hasTrack: true, source: 'gpx', importedAt: startTime + 1000,
  totals: { distanceM: 40_000, movingTimeS: 5400, elapsedTimeS: 6000, elevGainM: 500 } as StoredActivity['totals'],
});
const track: TrackPoint[] = [{ t: 0, lat: 41.6327, lng: 2.1677, ele: 200 }, { t: 60, lat: 41.6079, lng: 2.2876, ele: 150 }];
const workout = (id: string, title: string): PlannedWorkout => ({ id, date: '2026-11-20', title, done: false, manual: false, createdAt: 1_700_000_000_000 });

describe('sincronización entre dispositivos', () => {
  afterEach(() => { useDatabase('ciclismo'); });

  it('el cifrado va y vuelve, y no se abre con otra clave ni en otra fila', async () => {
    const key = await importKey(newKey());
    const sealed = await seal(key, 'workout:w1', { title: 'Series', n: [1, 2, 3] });
    expect(sealed).not.toContain('Series');
    expect(await open(key, 'workout:w1', sealed)).toEqual({ title: 'Series', n: [1, 2, 3] });
    await expect(open(key, 'workout:w2', sealed)).rejects.toThrow();
    await expect(open(await importKey(newKey()), 'workout:w1', sealed)).rejects.toThrow();
  });

  it('lo de un dispositivo llega al otro: salidas con track, entrenos y ajustes', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    await on(a, async () => {
      await saveActivity(ride('r1'), track);
      await db.calendar.put(workout('w1', 'Rodaje'));
      await saveSettings({ ...DEFAULT_SETTINGS, displayName: 'Ana', home: { lat: 41.6327, lng: 2.1677 }, ors: { apiKey: 'clave-local' }, thresholds: { ftpW: 220, maxHr: 185, thresholdHr: 168 } });
      const report = await syncOnce(account.remote);
      expect(report).toMatchObject({ pushed: 4, pulled: 0, waitingTracks: 0 });
      expect(await pendingCount()).toBe(0);
    });
    // En la cuenta nada va en claro, ni Casa ni el nombre.
    const stored = [...account.rows.values()].map((r) => r.payload).join('|');
    expect(stored).not.toContain('Ana');
    expect(stored).not.toContain('41.6327');
    expect(stored).not.toContain('clave-local');

    await on(b, async () => {
      await saveSettings({ ...DEFAULT_SETTINGS, ors: { apiKey: 'clave-de-b' } });
      const report = await syncOnce(account.remote);
      expect(report.pulled).toBe(4);
      expect(await db.activities.get('r1')).toMatchObject({ id: 'r1', name: 'Vuelta' });
      expect((await db.tracks.get('r1'))?.points).toEqual(track);
      expect((await db.calendar.get('w1'))?.title).toBe('Rodaje');
      const settings = await loadSettings();
      expect(settings).toMatchObject({ displayName: 'Ana', home: { lat: 41.6327, lng: 2.1677 }, thresholds: { ftpW: 220 } });
      // Las claves de servicio no viajan: B conserva la suya.
      expect(settings.ors.apiKey).toBe('clave-de-b');
      // Lo recibido no se reenvía.
      expect(await pendingCount()).toBe(0);
      const pushes = account.calls.pushed.length;
      await syncOnce(account.remote);
      expect(account.calls.pushed.length).toBe(pushes);
    });
  });

  it('una segunda pasada sin cambios no sube ni baja nada', async () => {
    const account = fakeAccount();
    await on(device(), async () => {
      await saveActivity(ride('r1'), track);
      await syncOnce(account.remote);
      const { fetch, push } = account.calls;
      expect(await syncOnce(account.remote)).toMatchObject({ pushed: 0, pulled: 0 });
      expect(account.calls.fetch).toBe(fetch);
      expect(account.calls.push).toBe(push);
    });
  });

  it('gana el cambio más reciente, en los dos sentidos', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    await on(a, async () => { await db.calendar.put(workout('w1', 'Original')); await syncOnce(account.remote, { now: () => 1000 }); });
    await on(b, async () => { await syncOnce(account.remote, { now: () => 2000 }); });
    // A cambia en t=3000 y B en t=4000, los dos sin sincronizar entre medias.
    await on(a, async () => { await db.calendar.put(workout('w1', 'Cambio de A')); await syncOnce(account.remote, { now: () => 3000 }); });
    await on(b, async () => {
      await db.calendar.put(workout('w1', 'Cambio de B'));
      await syncOnce(account.remote, { now: () => 4000 });
      expect((await db.calendar.get('w1'))?.title).toBe('Cambio de B');
    });
    await on(a, async () => {
      await syncOnce(account.remote, { now: () => 5000 });
      expect((await db.calendar.get('w1'))?.title).toBe('Cambio de B');
    });
    // Al revés: el cambio local es anterior al de la cuenta y pierde.
    await on(a, async () => { await db.calendar.put(workout('w1', 'A, tarde')); await syncOnce(account.remote, { now: () => 9000 }); });
    await on(b, async () => {
      await db.calendar.put(workout('w1', 'B, antes'));
      await syncOnce(account.remote, { now: () => 8000 });
      expect((await db.calendar.get('w1'))?.title).toBe('A, tarde');
      expect(await pendingCount()).toBe(0);
    });
  });

  it('los borrados se propagan y una salida borrada se lleva su track', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    await on(a, async () => {
      await saveActivity(ride('r1'), track);
      await db.calendar.put(workout('w1', 'Rodaje'));
      await syncOnce(account.remote);
    });
    await on(b, async () => { await syncOnce(account.remote); });
    await on(a, async () => {
      await db.calendar.delete('w1');
      await db.activities.delete('r1');
      await db.tracks.delete('r1');
      await syncOnce(account.remote);
    });
    expect(account.rows.get('workout:w1')?.payload).toBeNull();
    await on(b, async () => {
      await syncOnce(account.remote);
      expect(await db.calendar.get('w1')).toBeUndefined();
      expect(await db.activities.get('r1')).toBeUndefined();
      expect(await db.tracks.get('r1')).toBeUndefined();
      expect(await pendingCount()).toBe(0);
    });
  });

  it('«Borrar todo» borra también la copia de la cuenta', async () => {
    const account = fakeAccount();
    await on(device(), async () => {
      await saveActivity(ride('r1'), track);
      await db.calendar.put(workout('w1', 'Rodaje'));
      await syncOnce(account.remote);
      await clearAllData();
      await syncOnce(account.remote);
    });
    expect([...account.rows.values()].filter((r) => r.payload !== null).map((r) => `${r.kind}:${r.id}:${r.changedAt}`)).toEqual([]);
  });

  it('un dispositivo nuevo o con la base borrada por el navegador recupera la copia, sin borrar nada', async () => {
    const account = fakeAccount();
    await on(device(), async () => { await saveActivity(ride('r1'), track); await syncOnce(account.remote); });
    await on(device(), async () => {
      await syncOnce(account.remote);
      expect(await db.activities.count()).toBe(1);
    });
    expect(account.rows.get('activity:r1')?.payload).not.toBeNull();
  });

  it('con datos móviles los tracks esperan en los dos sentidos y pasan después', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    await on(a, async () => {
      await saveActivity(ride('r1'), track);
      expect(await syncOnce(account.remote, { deferTracks: true })).toMatchObject({ pushed: 1, waitingTracks: 1 });
      expect(account.rows.has('track:r1')).toBe(false);
      expect(await syncOnce(account.remote)).toMatchObject({ pushed: 1, waitingTracks: 0 });
    });
    await on(b, async () => {
      expect(await syncOnce(account.remote, { deferTracks: true })).toMatchObject({ pulled: 1, waitingTracks: 1 });
      expect(await db.activities.get('r1')).toBeDefined();
      expect(await db.tracks.get('r1')).toBeUndefined();
      // Mientras espera, el track pendiente no se toma por un borrado.
      await syncOnce(account.remote, { deferTracks: true });
      expect(account.rows.get('track:r1')?.payload).not.toBeNull();
      expect(await syncOnce(account.remote)).toMatchObject({ pulled: 1, waitingTracks: 0 });
      expect((await db.tracks.get('r1'))?.points).toEqual(track);
    });
  });

  it('al llegar un track se descarta el análisis hecho sin él', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    await on(a, async () => { await saveActivity(ride('r1'), track); await syncOnce(account.remote); });
    await on(b, async () => {
      await syncOnce(account.remote, { deferTracks: true });
      await db.routeSigs.put({ activityId: 'r1', analysisVersion: 1 } as never);
      await syncOnce(account.remote);
      expect(await db.routeSigs.get('r1')).toBeUndefined();
    });
  });

  it('no sube la demo ni las rutas del catálogo; sí las rutas propias', async () => {
    const account = fakeAccount();
    const route = (id: string, extra: object = {}) => ({
      id, name: 'Ruta', format: 'gpx', sourceFileName: 'r.gpx', originalXml: '<gpx/>', originalPoints: [], points: [],
      summary: { distanceM: 1, elevGainM: null, elevLossM: null, closed: false, pointCount: 0 }, createdAt: 10, updatedAt: 20, ...extra,
    });
    await on(device(), async () => {
      await saveActivity(ride('demo-001'), track);
      await db.calendar.put(workout('demo-w-1', 'Demo'));
      await db.referenceRoutes.bulkPut([route('propia'), route('catalogo', { catalog: { kind: 'osm', ref: 'x', tipo: 'carretera' } })] as never);
      await syncOnce(account.remote);
      expect([...account.rows.keys()]).toEqual(['route:propia']);
      // La del catálogo queda anotada y no se vuelve a mirar ni se cuenta como pendiente.
      expect(await pendingCount()).toBe(0);
      await db.referenceRoutes.delete('catalogo');
      await syncOnce(account.remote);
      expect([...account.rows.keys()]).toEqual(['route:propia']);
    });
  });

  it('un contenido dañado en la cuenta se salta y no detiene al resto', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    await on(a, async () => {
      await db.calendar.bulkPut([workout('w1', 'Uno'), workout('w2', 'Dos')]);
      await syncOnce(account.remote);
    });
    const broken = account.rows.get('workout:w1')!;
    broken.payload = `${broken.payload!.slice(0, -8)}AAAAAAA=`;
    await on(b, async () => {
      const report = await syncOnce(account.remote);
      expect(report).toMatchObject({ pulled: 1, skipped: 1 });
      expect(await db.calendar.get('w1')).toBeUndefined();
      expect((await db.calendar.get('w2'))?.title).toBe('Dos');
      // Lo que no se pudo leer no se convierte en un borrado.
      await syncOnce(account.remote);
      expect(account.rows.get('workout:w1')?.payload).not.toBeNull();
    });
  });

  it('un borrado de la cuenta no borra una salida que este dispositivo aún no había sincronizado', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    await on(a, async () => {
      await saveActivity(ride('r1'), track);
      await syncOnce(account.remote);
      await db.activities.delete('r1');
      await db.tracks.delete('r1');
      await syncOnce(account.remote);
    });
    expect(account.rows.get('activity:r1')?.payload).toBeNull();
    // B importó la misma salida por su cuenta y sincroniza por primera vez.
    await on(b, async () => {
      await saveActivity(ride('r1'), track);
      await syncOnce(account.remote);
      expect(await db.activities.get('r1')).toBeDefined();
      expect((await db.tracks.get('r1'))?.points).toEqual(track);
    });
    // La salida vuelve a la cuenta.
    expect(account.rows.get('activity:r1')?.payload).not.toBeNull();
    expect(account.rows.get('track:r1')?.payload).not.toBeNull();
  });

  it('la primera vez que se cruzan los ajustes de dos dispositivos se combinan sin perder nada', async () => {
    const account = fakeAccount();
    const a = device(), b = device();
    // B solo tiene Casa y sincroniza antes.
    await on(b, async () => {
      await saveSettings({ ...DEFAULT_SETTINGS, home: { lat: 41.6079, lng: 2.2876 } });
      await syncOnce(account.remote);
    });
    // A tiene nombre, otra Casa y umbrales: conserva lo suyo.
    await on(a, async () => {
      await saveSettings({ ...DEFAULT_SETTINGS, displayName: 'Ana', home: { lat: 41.6327, lng: 2.1677 }, thresholds: { ftpW: 220, maxHr: null, thresholdHr: null } });
      await syncOnce(account.remote);
      expect(await loadSettings()).toMatchObject({ displayName: 'Ana', home: { lat: 41.6327, lng: 2.1677 }, thresholds: { ftpW: 220 } });
      expect(await pendingCount()).toBe(0);
    });
    // B ya había sincronizado: ahora recibe lo combinado, que es más reciente.
    await on(b, async () => {
      await syncOnce(account.remote);
      expect(await loadSettings()).toMatchObject({ displayName: 'Ana', thresholds: { ftpW: 220 } });
    });
  });

  it('los borrados se suben antes y aparte del contenido', async () => {
    const account = fakeAccount();
    await on(device(), async () => {
      await db.calendar.bulkPut([workout('w1', 'Uno'), workout('w2', 'Dos')]);
      await syncOnce(account.remote);
      await db.calendar.delete('w1');
      await db.calendar.put(workout('w3', 'Tres'));
      const batches: Array<Array<string | null>> = [];
      const push = account.remote.push;
      account.remote.push = async (items) => { batches.push(items.map((i) => i.payload && 'contenido')); return push(items); };
      await syncOnce(account.remote);
      expect(batches).toEqual([[null], ['contenido']]);
    });
  });

  it('si la red falla a media pasada, la siguiente termina el trabajo', async () => {
    const account = fakeAccount();
    await on(device(), async () => {
      await db.calendar.bulkPut([workout('w1', 'Uno'), workout('w2', 'Dos')]);
      const push = account.remote.push;
      account.remote.push = async () => { throw new Error('sin red'); };
      await expect(syncOnce(account.remote)).rejects.toThrow('sin red');
      expect(await pendingCount()).toBe(2);
      account.remote.push = push;
      expect(await syncOnce(account.remote)).toMatchObject({ pushed: 2 });
      expect(await pendingCount()).toBe(0);
    });
  });
});
