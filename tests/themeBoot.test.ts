import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// El script clásico en línea del <head>: el que no es type="module" ni tiene src.
function bootScript(): string {
  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const inline = scripts.find(([, attrs = '']) => !/type=["']module["']/.test(attrs) && !/\ssrc=/.test(attrs));
  if (!inline) throw new Error('index.html no tiene el script del tema');
  return inline[2];
}

function runBoot(storage: Pick<Storage, 'getItem'>) {
  // El parámetro tapa el localStorage global solo dentro del script.
  new Function('localStorage', bootScript())(storage);
}

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: () => value };
}

const throwingStorage = new Proxy({} as Pick<Storage, 'getItem'>, {
  get() {
    throw new DOMException('Acceso denegado', 'SecurityError');
  },
});

describe('theme boot script', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '<meta name="theme-color" content="#0A1122">';
  });

  it('boot script defaults to dark', () => {
    runBoot(storageWith(null));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('boot script applies a stored light theme', () => {
    runBoot(storageWith('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#EEF2F8');
  });

  it('boot script ignores unknown values', () => {
    runBoot(storageWith('sepia'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('boot script falls back to dark when storage throws', () => {
    expect(() => runBoot(throwingStorage)).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('index.html declares FBikeTrain, color-scheme and viewport-fit', () => {
    expect(html).toContain('<title>FBikeTrain</title>');
    expect(html).toMatch(/<meta name="color-scheme" content="dark light"\s*\/?>/);
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
    expect(html).toMatch(/<html lang="es"/);
  });
});
