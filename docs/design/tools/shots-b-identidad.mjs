// Capturas del prototipo B «Identidad propia de montaña». Uso: node docs/design/tools/shots-b-identidad.mjs
// Chromium local y file:///, sin servidor. Las teselas de CyclOSM y los CDN del prototipo necesitan red.
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../prototipos/b-identidad');
const page = pathToFileURL(resolve(dir, 'inicio.html')).href;
const CHROME = 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const only = process.argv[2];

const shots = [
  { name: 'desktop-oscuro', w: 1440, h: 900, theme: 'dark' },
  { name: 'desktop-claro', w: 1440, h: 900, theme: 'light' },
  { name: 'movil-oscuro', w: 390, h: 844, theme: 'dark', full: true, mobile: true },
  { name: 'movil-claro', w: 390, h: 844, theme: 'light', full: true, mobile: true },
  { name: 'movil-oscuro-pantalla', w: 390, h: 844, theme: 'dark', mobile: true },
  { name: 'desktop-oscuro-completo', w: 1440, h: 900, theme: 'dark', full: true },
  { name: 'desktop-oscuro-reducido', w: 1440, h: 900, theme: 'dark', reduced: true },
  { name: 'estados-hover-foco', w: 1440, h: 900, theme: 'dark', states: true },
  { name: 'tablet-oscuro', w: 1100, h: 900, theme: 'dark', full: true },
].filter(s => !only || s.name === only);

const b = await chromium.launch({ executablePath: CHROME });
const errs = [];
for (const s of shots) {
  const ctx = await b.newContext({
    viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.mobile ? 2 : 1,
    hasTouch: !!s.mobile, isMobile: !!s.mobile,
    reducedMotion: s.reduced ? 'reduce' : 'no-preference',
  });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(`${s.name}: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${s.name}: ${e}`));
  await p.goto(`${page}?theme=${s.theme}`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#summit.on', { state: 'attached', timeout: 15000 })
    .catch(async () => errs.push(`${s.name}: placa de la cima sin mostrar (${await p.evaluate(() => document.getElementById('summit').className + ' / ' + document.body.className)})`));
  await p.waitForTimeout(1200);
  if (s.states) {
    // Foco de teclado en «12 meses» y hover en una fila de próximas salidas y en un enlace del menú.
    await p.focus('[data-range="6m"]');
    await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
    await p.hover('.ride >> nth=1');
    await p.waitForTimeout(300);
  }
  if (s.full && s.mobile) {
    // La captura de página completa deja lo fijo en el primer pantallazo: se ancla la barra al final del documento.
    await p.addStyleTag({ content: 'body{position:relative}.tabbar{position:absolute!important}' });
    await p.waitForTimeout(200);
  }
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await p.screenshot({ path: `${dir}/${s.name}.png`, fullPage: !!s.full });
  console.log(s.name, 'overflow-x:', overflow);
  await ctx.close();
}
console.log('errors:', JSON.stringify(errs));
await b.close();
