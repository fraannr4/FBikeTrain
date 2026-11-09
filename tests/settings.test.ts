import { db } from '../src/db/db';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings/settings';
import type { Settings } from '../src/domain/types';

describe('settings', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it('returns defaults when empty', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.llm.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(DEFAULT_SETTINGS.llm.model).toBe('');
  });

  it('persists round trip', async () => {
    const s: Settings = {
      displayName: 'Ana',
      home: { lat: 41.39, lng: 2.17 },
      ors: { apiKey: 'ors-test' },
      llm: { baseUrl: 'https://example.test/v1', apiKey: 'llm-test', model: 'modelo-x' },
    };
    await saveSettings(s);
    expect(await loadSettings()).toEqual(s);
  });
});
