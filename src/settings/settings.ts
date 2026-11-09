import { db } from '../db/db';
import type { Settings } from '../domain/types';

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  home: null,
  ors: { apiKey: '' },
  llm: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: '', model: '' },
};

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get('app');
  return row?.value ?? structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ key: 'app', value: s });
}
