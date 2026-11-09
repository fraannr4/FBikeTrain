// Capturas de la lámina del brief. Uso: node docs/design/tools/shots.mjs
// Adaptado del script de ejemplo del workflow: Chromium local y file:///, sin servidor.
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(resolve(here, '../board/index.html')).href;
const out = resolve(here, '../shots');
const CHROME = 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const shots = [
  { name: 'board-dark-1440', w: 1440, h: 900, theme: 'dark' },
  { name: 'board-light-1440', w: 1440, h: 900, theme: 'light' },
  { name: 'board-dark-390', w: 390, h: 844, theme: 'dark' },
  { name: 'board-light-390', w: 390, h: 844, theme: 'light' },
  { name: 'board-dark-1440-reduced', w: 1440, h: 900, theme: 'dark', reduced: true },
];

const b = await chromium.launch({ executablePath: CHROME });
const errs = [];
for (const s of shots) {
  const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, reducedMotion: s.reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(`${s.name}: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${s.name}: ${e}`));
  await p.goto(`${page}?theme=${s.theme}`);
  await p.waitForTimeout(1400);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await p.screenshot({ path: `${out}/${s.name}.png`, fullPage: true });
  console.log(s.name, 'overflow-x:', overflow);
  await ctx.close();
}
console.log('errors:', JSON.stringify(errs));
await b.close();
