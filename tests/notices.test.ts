import { inicioNotices } from '../src/ui/inicio/inicioNotices';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;

describe('inicioNotices', () => {
  it('import reminder after more than 7 days', () => {
    const n = inicioNotices({ now: NOW, rides: 10, lastImportAt: NOW - 9 * DAY, lastBackupAt: NOW - 1 * DAY });
    expect(n).toEqual([
      { id: 'import', text: 'Última importación hace 9 días.', action: 'Importar salidas nuevas', href: '#/importar' },
    ]);
    expect(inicioNotices({ now: NOW, rides: 10, lastImportAt: NOW - 7 * DAY, lastBackupAt: NOW - 1 * DAY })).toEqual([]);
  });

  it('backup reminder when imports are newer than the last backup', () => {
    expect(inicioNotices({ now: NOW, rides: 10, lastImportAt: NOW - 3 * DAY, lastBackupAt: NOW - 12 * DAY })).toEqual([
      {
        id: 'backup',
        text: 'Tienes salidas importadas después de tu última copia, de hace 12 días.',
        action: 'Hacer copia',
        href: '#/ajustes',
      },
    ]);
  });

  it('no backup yet', () => {
    const n = inicioNotices({ now: NOW, rides: 3, lastImportAt: NOW - 1 * DAY });
    expect(n.map((x) => x.text)).toEqual(['Aún no has hecho ninguna copia de seguridad.']);
  });

  it('import goes before backup', () => {
    const n = inicioNotices({ now: NOW, rides: 3, lastImportAt: NOW - 1_000 * DAY });
    expect(n.map((x) => x.id)).toEqual(['import', 'backup']);
    expect(n[0].text).toBe('Última importación hace 1000 días.');
  });

  it('no notices without rides', () => {
    expect(inicioNotices({ now: NOW, rides: 0, lastImportAt: NOW - 30 * DAY })).toEqual([]);
  });

  it('no notices when up to date', () => {
    expect(inicioNotices({ now: NOW, rides: 10, lastImportAt: NOW - 3 * DAY, lastBackupAt: NOW - 1 * DAY })).toEqual([]);
  });
});
