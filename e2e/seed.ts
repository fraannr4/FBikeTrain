import { expect, type Page } from '@playwright/test';

// Utilidades de las pruebas de rutas y plan: viewport del móvil y datos sintéticos en IndexedDB «ciclismo».

export const MOBILE = { width: 390, height: 844 };
export const NOW = new Date('2026-11-06T12:00:00+01:00');
const DAY = 86_400_000;

/** Puerta del Sol: el inicio del fixture de ORS (punto público). */
export const HOME = { lat: 40.4168, lng: -3.7038 };

export function ride(id: string, daysAgo: number, name: string, km = 45) {
  const distanceM = km * 1000;
  const movingTimeS = Math.round(distanceM / 7.5);
  return {
    id,
    startTime: NOW.getTime() - daysAgo * DAY,
    sport: 'cycling',
    name,
    totals: { distanceM, movingTimeS, elapsedTimeS: movingTimeS + 300, elevGainM: 600, avgSpeedMs: 7.5, maxSpeedMs: 15 },
    hasTrack: false,
    source: 'gpx',
    importedAt: NOW.getTime(),
  };
}

export const RIDES = Array.from({ length: 12 }, (_, i) => ride(`s${i}`, 2 + i * 5, `Salida ${i + 1}`, 35 + (i % 4) * 5));

/** Abre la app para que Dexie cree la base, escribe filas en los almacenes y recarga. */
export async function seed(page: Page, rows: { activities?: unknown[]; settings?: unknown }) {
  await page.goto('#/ajustes');
  await expect(page.getByRole('heading', { name: 'Ajustes' }).first()).toBeVisible();
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ciclismo-user-00000000-0000-0000-0000-000000000011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['activities', 'settings'], 'readwrite');
    for (const a of data.activities ?? []) tx.objectStore('activities').put(a);
    if (data.settings) tx.objectStore('settings').put({ key: 'app', value: data.settings });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, rows);
  await page.reload();
}

export const settings = (over: { orsKey?: string; llmKey?: string; home?: typeof HOME | null } = {}) => ({
  displayName: 'Test',
  home: over.home === undefined ? HOME : over.home,
  ors: { apiKey: over.orsKey ?? '' },
  llm: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: over.llmKey ?? '', model: 'openai/gpt-oss-20b' },
});
