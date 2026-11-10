import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Rasteriza el SVG de marca existente, sobre el papel claro de tokens.css.
const svg = await readFile(new URL('../public/brand-mark.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1, colorScheme: 'light' });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#F7F4EA}body{display:grid;place-items:center}svg{width:72%;height:72%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../public/brand-mark-${size}.png`, import.meta.url)) });
    await page.close();
  }
} finally { await browser.close(); }
