import { existsSync, readFileSync } from 'node:fs';
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
    document.head.innerHTML = '<meta name="theme-color" content="#14221F"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">';
  });

  it('boot script defaults to dark', () => {
    runBoot(storageWith(null));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('boot script applies a stored light theme', () => {
    runBoot(storageWith('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#F7F4EA');
  });

  // iPhone pinta los s�mbolos de la barra de estado en blanco con black-translucent: ilegibles sobre el papel claro.
  it('boot script keeps the iPhone status bar readable on each theme', () => {
    const style = () => document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content');
    runBoot(storageWith(null));
    expect(style()).toBe('black-translucent');
    runBoot(storageWith('light'));
    expect(style()).toBe('default');
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

  it('index.html lets an iPhone install the app with its own icon and name', () => {
    expect(html).toContain('<link rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png" />');
    expect(existsSync(resolve(__dirname, '../public/apple-touch-icon.png'))).toBe(true);
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="FBikeTrain" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
  });
});
