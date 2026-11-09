// Capturas del prototipo A «Fiel a la inspiración». Uso: node docs/design/tools/shots-a-fiel.mjs [solo-nombre]
// Chromium local y file:///, sin servidor. ECharts, Leaflet y las teselas de CyclOSM necesitan red.
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../prototipos/a-fiel');
const page = pathToFileURL(resolve(dir, 'inicio.html')).href;
const CHROME = 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const only = process.argv[2];

const shots = [
  { name: 'desktop-oscuro', w: 1440, h: 900, theme: 'dark' },
  { name: 'desktop-claro', w: 1440, h: 900, theme: 'light' },
  { name: 'movil-oscuro', w: 390, h: 844, theme: 'dark', full: true, mobile: true },
  { name: 'desktop-oscuro-completa', w: 1440, h: 900, theme: 'dark', full: true },
  { name: 'desktop-claro-completa', w: 1440, h: 900, theme: 'light', full: true },
  { name: 'movil-claro', w: 390, h: 844, theme: 'light', full: true, mobile: true },
  { name: 'movil-mas', w: 390, h: 844, theme: 'dark', mobile: true, act: async p => { await p.click('#more-btn'); await p.waitForTimeout(500); } },
  { name: 'tableta-oscuro', w: 834, h: 1112, theme: 'dark', full: true },
  { name: 'estados-hover-foco', w: 1440, h: 900, theme: 'dark', act: async p => {
      await p.hover('.nav-link[href="#historial"]');
      await p.focus('[data-metric="elev"]');
      await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
      await p.mouse.move(0, 0); await p.hover('.nav-link[href="#historial"]');
      await p.waitForTimeout(250);
    }, clip: { x: 0, y: 0, width: 1440, height: 900 } },
  { name: 'desktop-oscuro-reducido', w: 1440, h: 900, theme: 'dark', reduced: true },
];

const b = await chromium.launch({ executablePath: CHROME });
const errs = [];
for (const s of shots) {
  if (only && s.name !== only) continue;
  const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, isMobile: !!s.mobile, hasTouch: !!s.mobile, reducedMotion: s.reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(`${s.name}: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${s.name}: ${e}`));
  await p.goto(`${page}?theme=${s.theme}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2600);
  if (s.act) await s.act(p);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (s.full && s.w < 1080) {
    // la barra inferior es fija: se amplía el viewport a toda la página para que quede abajo, como al final del desplazamiento
    const hh = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: s.w, height: hh }); await p.waitForTimeout(900);
    await p.screenshot({ path: `${dir}/${s.name}.png` });
  } else await p.screenshot({ path: `${dir}/${s.name}.png`, fullPage: !!s.full });
  console.log(s.name, 'overflow-x:', overflow);
  await ctx.close();
}
console.log('errors:', JSON.stringify(errs));
await b.close();
