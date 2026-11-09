import { accountDatabaseName } from '../src/db/accountDatabase';
import { CyclingDb } from '../src/db/db';

describe('aislamiento de la caché por cuenta', () => {
  it('usa nombres distintos de la base antigua y de otra cuenta', () => {
    expect(accountDatabaseName('00000000-0000-0000-0000-000000000001')).toBe('ciclismo-user-00000000-0000-0000-0000-000000000001');
    expect(accountDatabaseName('00000000-0000-0000-0000-000000000001')).not.toBe(accountDatabaseName('00000000-0000-0000-0000-000000000002'));
  });
  it('rechaza nombres de base arbitrarios como identidad', () => {
    expect(() => accountDatabaseName('ciclismo')).toThrow();
  });
  it('abrir otra cuenta no muestra ni borra la información antigua', async () => {
    const legacy = new CyclingDb('test-account-legacy');
    const own = new CyclingDb(accountDatabaseName('00000000-0000-0000-0000-000000000099'));
    try {
      await legacy.meta.put({ key: 'original', value: 42 });
      expect(await own.meta.count()).toBe(0);
      expect((await legacy.meta.get('original'))?.value).toBe(42);
    } finally {
      await legacy.delete();
      await own.delete();
    }
  });
});
