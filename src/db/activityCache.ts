import Dexie from 'dexie';
import type { StoredActivity } from '../domain/types';
import { db } from './db';
import { listActivities } from './repo';

/**
 * Todas las actividades, leídas una vez y guardadas en memoria: con miles de salidas, leerlas de
 * IndexedDB cuesta casi un segundo y volver a una pantalla no debe repetirlo. Cualquier escritura
 * en la tabla (importar, cargar o quitar la demo, borrar todo, también desde otra pestaña) vacía la
 * caché; Dexie avisa al confirmarse la transacción, antes de que vuelva el `await` de quien escribe.
 */
let cached: StoredActivity[] | undefined;
let pending: Promise<StoredActivity[]> | undefined;
let generation = 0;
// Cada cuenta abre su propia base (`ciclismo-user-<uuid>`): el nombre se lee en cada evento, no al
// cargar el módulo, y cambiar de base vacía la caché.
let cachedFor = db.name;

function invalidate(): void {
  generation += 1;
  cached = undefined;
  pending = undefined;
}

function checkDatabase(): void {
  if (db.name === cachedFor) return;
  cachedFor = db.name;
  invalidate();
}

Dexie.on('storagemutated', (parts) => {
  if (!(`idb://${db.name}/activities/` in parts)) return;
  invalidate();
});

/** Lo ya leído, para pintar sin esperar; `undefined` si hay que leer. */
export function cachedActivities(): StoredActivity[] | undefined {
  checkDatabase();
  return cached;
}

/** Actividades ordenadas por inicio, de memoria si se puede. */
export function readActivities(): Promise<StoredActivity[]> {
  checkDatabase();
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  const gen = generation;
  const read = listActivities().then(
    (acts) => {
      // Una escritura durante la lectura deja esta lectura vieja: se devuelve, pero no se guarda.
      if (gen === generation) cached = acts;
      return acts;
    },
    (err: unknown) => {
      if (pending === read) pending = undefined;
      throw err;
    },
  );
  pending = read;
  return read;
}
