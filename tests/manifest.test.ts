import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Icon = { src: string; sizes: string; type: string; purpose: string };
const publicDir = resolve(__dirname, '../public');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8')) as { icons: Icon[] };

describe('manifest de la PWA', () => {
  it('trae un icono maskable de 512 px además de los dos normales', () => {
    expect(manifest.icons).toContainEqual({ src: 'brand-mark-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' });
    expect(manifest.icons.filter((icon) => icon.purpose === 'any').map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
  });

  it('cada icono declarado existe en public/', () => {
    for (const icon of manifest.icons) expect(existsSync(resolve(publicDir, icon.src)), icon.src).toBe(true);
  });
});
