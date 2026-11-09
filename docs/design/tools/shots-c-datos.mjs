// Capturas del prototipo C «Datos primero». Uso: node docs/design/tools/shots-c-datos.mjs [sufijo]
// Chromium local y file:///, sin servidor. Comprueba desbordamiento horizontal y errores de consola.
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../prototipos/c-datos');
const page = pathToFileURL(resolve(dir, 'inicio.html')).href;
const CHROME = 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const suf = process.argv[2] ? `-${process.argv[2]}` : '';

const shots = [
  { name: 'desktop-oscuro', w: 1440, h: 900, theme: 'dark' },
  { name: 'desktop-claro', w: 1440, h: 900, theme: 'light' },
  { name: 'movil-oscuro', w: 390, h: 844, theme: 'dark', full: true, mobile: true },
  { name: 'desktop-oscuro-completa', w: 1440, h: 900, theme: 'dark', full: true },
  { name: 'movil-claro', w: 390, h: 844, theme: 'light', full: true, mobile: true },
  { name: 'estados-hover-foco', w: 1440, h: 900, theme: 'dark', states: true },
  { name: 'desktop-oscuro-reducido', w: 1440, h: 900, theme: 'dark', reduced: true },
];

const b = await chromium.launch({ executablePath: CHROME });
const errs = [];
for (const s of shots) {
  const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.mobile ? 2 : 1,
    hasTouch: !!s.mobile, isMobile: !!s.mobile, reducedMotion: s.reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(`${s.name}: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${s.name}: ${e}`));
  await p.goto(`${page}?theme=${s.theme}`, { waitUntil: 'networkidle' }).catch(e => errs.push(`${s.name}: goto ${e.message}`));
  await p.waitForTimeout(1800);
  // En headless la línea de tiempo de las animaciones CSS no siempre avanza: se fija el estado final
  await p.evaluate(() => document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} }));
  await p.waitForTimeout(150);
  if (s.states) {
    // foco de teclado en la pastilla «Desnivel» y hover sobre una próxima salida y la cruceta de la gráfica
    await p.focus('#metrics button[data-m="elev"]');
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
    const ch = await p.locator('#chart').boundingBox();
    await p.mouse.move(ch.x + ch.width * .60, ch.y + ch.height * .5);
    await p.waitForTimeout(300);
    await p.mouse.move(ch.x + ch.width * .62, ch.y + ch.height * .52, { steps: 4 });
    await p.waitForTimeout(1200);
  }
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (s.full && s.mobile) {
    // la barra inferior es fixed: se alarga el viewport para que quede al pie y no a mitad de la captura
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: s.w, height: h });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${dir}/${s.name}${suf}.png` });
  } else await p.screenshot({ path: `${dir}/${s.name}${suf}.png`, fullPage: !!s.full });
  console.log(s.name, 'overflow-x:', overflow);
  await ctx.close();
}
console.log('errors:', JSON.stringify(errs));
await b.close();
