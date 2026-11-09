// Capturas del prototipo final. Uso:
//   node docs/design/tools/shots-final.mjs            (todas)
//   node docs/design/tools/shots-final.mjs inicio     (las que contienen «inicio» en el nombre)
// Chromium local y file:///, sin servidor. Las teselas CyclOSM y los CDN del prototipo necesitan red.
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../prototipo-final');
const out = resolve(dir, 'capturas');
const CHROME = 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const only = process.argv[2];

const D = { w: 1440, h: 900 }, M = { w: 390, h: 844, mobile: true };
const pages = ['inicio', 'importar', 'ajustes', 'historial', 'rutas'];
const shots = [];
for (const p of pages) {
  shots.push({ name: `${p}-escritorio-oscuro`, page: p, ...D, theme: 'dark' });
  shots.push({ name: `${p}-escritorio-claro`, page: p, ...D, theme: 'light' });
  shots.push({ name: `${p}-movil-oscuro`, page: p, ...M, theme: 'dark' });
  shots.push({ name: `${p}-movil-claro`, page: p, ...M, theme: 'light' });
}
shots.push(
  { name: 'inicio-escritorio-oscuro-completa', page: 'inicio', ...D, theme: 'dark', full: true },
  { name: 'inicio-escritorio-claro-completa', page: 'inicio', ...D, theme: 'light', full: true },
  { name: 'inicio-movil-oscuro-completa', page: 'inicio', ...M, theme: 'dark', full: true },
  { name: 'inicio-movil-claro-completa', page: 'inicio', ...M, theme: 'light', full: true },
  { name: 'inicio-movil-mas', page: 'inicio', ...M, theme: 'dark', sheet: true },
  { name: 'inicio-tableta-oscuro', page: 'inicio', w: 1100, h: 900, theme: 'dark', full: true },
  { name: 'inicio-escritorio-reducido', page: 'inicio', ...D, theme: 'dark', reduced: true },
  { name: 'inicio-estados-hover-foco', page: 'inicio', ...D, theme: 'dark', states: true },
  { name: 'inicio-fase1-oscuro', page: 'inicio', q: 'fase=1', ...D, theme: 'dark', full: true },
  { name: 'inicio-vacio-oscuro', page: 'inicio', q: 'estado=vacio', ...D, theme: 'dark' },
  { name: 'inicio-vacio-movil-claro', page: 'inicio', q: 'estado=vacio', ...M, theme: 'light' },
  { name: 'rutas-ia-escritorio-oscuro', page: 'rutas', q: 'modo=ia', ...D, theme: 'dark' },
  { name: 'importar-progreso-escritorio-oscuro', page: 'importar', q: 'estado=progreso', ...D, theme: 'dark' },
  { name: 'ajustes-escritorio-oscuro-completa', page: 'ajustes', ...D, theme: 'dark', full: true },
);
const list = shots.filter(s => !only || s.name.includes(only));

const b = await chromium.launch({ executablePath: CHROME });
const errs = [], report = [];
for (const s of list) {
  const ctx = await b.newContext({
    viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.mobile ? 2 : 1,
    hasTouch: !!s.mobile, isMobile: !!s.mobile,
    reducedMotion: s.reduced ? 'reduce' : 'no-preference',
  });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' && !/tile-cyclosm/.test(m.text())) errs.push(`${s.name}: ${m.text()}`); });
  p.on('pageerror', e => errs.push(`${s.name}: ${e}`));
  const url = pathToFileURL(resolve(dir, `${s.page}.html`)).href + `?theme=${s.theme}` + (s.q ? `&${s.q}` : '');
  await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => errs.push(`${s.name}: ${e.message}`));
  await p.waitForTimeout(2600);
  if (s.states) {
    await p.focus('[data-range="6m"]');
    await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
    await p.hover('.ride >> nth=1');
    const box = await p.locator('#chart').boundingBox();
    if (box) await p.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
    await p.waitForTimeout(400);
  }
  if (s.sheet) { await p.click('#more'); await p.waitForTimeout(500); }
  if (s.full && s.mobile) {
    await p.addStyleTag({ content: 'body{position:relative}.tabbar{position:absolute!important}' });
    await p.waitForTimeout(200);
  }
  const m = await p.evaluate(() => {
    const de = document.documentElement;
    const small = [];
    document.querySelectorAll('body *').forEach(n => {
      if (!n.childNodes.length || n.closest('svg, .leaflet-container, .sr-only, [hidden]')) return;
      const own = [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
      if (!own || !n.offsetParent) return;
      const fs = parseFloat(getComputedStyle(n).fontSize);
      if (fs < 12) small.push(`${n.tagName.toLowerCase()}.${n.className}: ${fs}px "${n.textContent.trim().slice(0, 30)}"`);
    });
    return { overflow: de.scrollWidth - de.clientWidth, height: de.scrollHeight, small: small.slice(0, 6) };
  });
  await p.screenshot({ path: `${out}/${s.name}.png`, fullPage: !!s.full });
  report.push(`${s.name}: overflow-x ${m.overflow}, alto ${m.height}${m.small.length ? ', texto <12px: ' + m.small.join(' | ') : ''}`);
  await ctx.close();
}
console.log(report.join('\n'));
console.log('errores:', errs.length ? '\n' + errs.join('\n') : 'ninguno');
await b.close();
