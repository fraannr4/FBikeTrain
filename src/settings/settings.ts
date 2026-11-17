import { db } from '../db/db';
import type { RiderThresholds, Settings } from '../domain/types';

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  home: null,
  ors: { apiKey: '' },
  llm: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: '', model: '' },
};

/** Sin umbrales: nada se inventa. Es lo que ven los ajustes guardados antes de existir `thresholds`. */
export const NO_THRESHOLDS: RiderThresholds = { ftpW: null, maxHr: null, thresholdHr: null };

export const thresholdsOf = (s: Pick<Settings, 'thresholds'>): RiderThresholds => s.thresholds ?? NO_THRESHOLDS;

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get('app');
  return row?.value ?? structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ key: 'app', value: s });
}
