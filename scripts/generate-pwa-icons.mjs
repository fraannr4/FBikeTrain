import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Rasteriza el SVG de marca existente, sobre el papel claro de tokens.css.
// El maskable lo recorta el lanzador de Android: al 56 % la marca cabe en el círculo seguro del 80 %.
const icons = [
  { size: 192, scale: 72, name: 'brand-mark-192' },
  { size: 512, scale: 72, name: 'brand-mark-512' },
  { size: 512, scale: 56, name: 'brand-mark-maskable-512' },
];
const svg = await readFile(new URL('../public/brand-mark.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  for (const { size, scale, name } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1, colorScheme: 'light' });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#F7F4EA}body{display:grid;place-items:center}svg{width:${scale}%;height:${scale}%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../public/${name}.png`, import.meta.url)) });
    await page.close();
  }
} finally { await browser.close(); }
