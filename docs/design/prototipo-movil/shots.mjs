// Capturas y comprobaciones móviles del prototipo. Uso:
//   node docs/design/prototipo-movil/shots.mjs <pagina> [sufijo] [opciones]
//
//   <pagina>          nombre del HTML sin extensión (kit, inicio, historial...)
//   [sufijo]          se añade al nombre de la captura (p. ej. «filtros», «vacio»)
//
// Opciones:
//   --click=<css>     pulsa ese elemento antes de capturar (se puede repetir, en orden)
//   --scroll=<px>     desplaza la página antes de capturar (cabecera encogida)
//   --q=<a=b&c=d>     parámetros extra de la URL (?estado=vacio...)
//   --full            añade una captura de página completa por resolución y tema
//   --only=<WxH>      solo esa resolución (p. ej. --only=390x844)
//   --theme=dark|light  solo ese tema
//   --reduced         emula prefers-reduced-motion: reduce
//   --http            sirve desde Vite (http://localhost:5173) en vez de file://
//   --wait=<ms>       espera extra antes de capturar (p. ej. a que acabe una animación de entrada)
//
// Resoluciones: 360x780, 390x844, 412x915, 430x932 y 844x390 apaisado, con
// deviceScaleFactor 2, isMobile y hasTouch. Temas oscuro y claro.
// Comprobaciones en cada captura (fallan el proceso con código 1):
//   - sin scroll horizontal (scrollWidth <= innerWidth) ni texto fuera de pantalla;
//   - ningún elemento interactivo visible con caja menor de 44x44 px
//     (los enlaces en línea dentro de un párrafo son la excepción de WCAG 2.5.8);
//   - ningún texto cortado: overflow oculto con scrollWidth > clientWidth
//     (las elipsis intencionadas se listan como aviso, no como fallo);
//   - contraste de texto: 4,5:1 (3:1 en texto grande) sobre el fondo compuesto;
//   - ningún texto por debajo de 12 px; ningún error de consola.
// Guarda PNG e informe JSON en docs/design/prototipo-movil/capturas/.
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'capturas');
mkdirSync(out, { recursive: true });
const CHROME = 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const opt = (k) => args.filter(a => a.startsWith(`--${k}=`)).map(a => a.slice(k.length + 3));
const flag = (k) => args.includes(`--${k}`);
const page = pos[0];
if (!page) { console.error('Falta la página: node shots.mjs <pagina> [sufijo] [opciones]'); process.exit(2); }
const suffix = pos[1] ? `-${pos[1]}` : '';
const clicks = opt('click');
const scroll = +(opt('scroll')[0] || 0);
const extraQ = opt('q')[0] || '';
const only = opt('only')[0];
const onlyTheme = opt('theme')[0];
const extraWait = +(opt('wait')[0] || 0);

const VIEWPORTS = [
  { w: 360, h: 780 }, { w: 390, h: 844 }, { w: 412, h: 915 }, { w: 430, h: 932 },
  { w: 844, h: 390, landscape: true },
].filter(v => !only || `${v.w}x${v.h}` === only);
const THEMES = ['dark', 'light'].filter(t => !onlyTheme || t === onlyTheme);

function urlFor(theme) {
  const q = `?theme=${theme}${extraQ ? '&' + extraQ : ''}`;
  return flag('http')
    ? `http://localhost:5173/docs/design/prototipo-movil/${page}.html${q}`
    : pathToFileURL(resolve(here, `${page}.html`)).href + q;
}

/* ---- Comprobaciones dentro de la página ---- */
function audit() {
  // En móvil, si algo desborda, el navegador ensancha el viewport de diseño y innerWidth crece con él:
  // se compara con el ancho de la pantalla emulada, que no cambia.
  const de = document.documentElement, W = Math.min(innerWidth, screen.width || innerWidth), y0 = scrollY;
  const r = { hscroll: Math.max(0, de.scrollWidth - W), targets: [], clipped: [], ellipsis: [], offscreen: [], contrast: [], tiny: [], unchecked: 0 };
  const modal = document.querySelector('dialog[open]');
  const desc = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const c = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    return `${el.tagName.toLowerCase()}${c} "${t}"`;
  };
  const effOpacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const visible = (el) => {
    if (modal && !modal.contains(el)) return null;                       // detrás de un modal: inerte
    if (el.closest('[hidden], [aria-hidden="true"], .sr-only, dialog:not([open]), [inert]')) return null;
    const shut = el.closest('details:not([open])');                     // acordeón cerrado: solo se ve el summary
    if (shut && !el.closest('summary')) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const b = el.getBoundingClientRect();
    if (b.width <= 1 || b.height <= 1) return null;
    if (effOpacity(el) < 0.05) return null;
    return b;
  };
  const ownText = (el) => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const inHScroller = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };

  // 1. Objetivos táctiles
  document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]').forEach(el => {
    const b = visible(el); if (!b) return;
    if (el.classList.contains('skip')) return;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement && ownText(el.parentElement)) return; // enlace en línea: excepción WCAG
    if (b.width < 43.5 || b.height < 43.5) r.targets.push(`${desc(el)} ${Math.round(b.width)}x${Math.round(b.height)}`);
  });

  // 2. Texto: tamaño, cortes, fuera de pantalla y contraste
  const parse = (s) => {
    let m = s.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = s.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  // Fondo compuesto: las capas que hay bajo el centro del texto (incluye hermanos
  // posicionados, como el indicador de un segmentado); si no se ve, sus ancestros.
  const bgOf = (el) => {
    const layers = [];
    let bx = el.getBoundingClientRect();
    if (bx.top < 0 || bx.bottom > innerHeight) {
      // Con una hoja abierta, lo que no se ve está dentro de su scroll: se lleva a la vista
      if (modal) el.scrollIntoView({ block: 'center', behavior: 'instant' }); else scrollTo(0, scrollY + bx.top - innerHeight / 2);
      bx = el.getBoundingClientRect();
    }
    let cx = bx.left + Math.min(bx.width / 2, 12), cy = bx.top + bx.height / 2;
    let stack = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementsFromPoint(cx, cy) : [];
    if (modal && !stack.includes(el)) {
      // Dentro de la hoja pero recortado por su scroll (bajo el pie fijo): se centra y se vuelve a mirar
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      bx = el.getBoundingClientRect(); cx = bx.left + Math.min(bx.width / 2, 12); cy = bx.top + bx.height / 2;
      stack = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementsFromPoint(cx, cy) : [];
    }
    const at = stack.indexOf(el);
    let chain = at >= 0 ? stack.slice(at) : [];
    if (!chain.length) for (let n = el; n; n = n.parentElement) chain.push(n);
    for (const n of chain) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage) && n !== el) return null; // imagen: no comprobable
      const c = parse(cs.backgroundColor);
      if (c === null) return null;
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
    }
    let base = [255, 255, 255, 1];
    if (!layers.length || layers[layers.length - 1][3] < 0.999) { const rb = parse(getComputedStyle(document.body).backgroundColor); if (rb) base = rb; }
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  document.querySelectorAll('body *').forEach(el => {
    if (el.closest('svg, script, style, template') || !ownText(el)) return;
    const b = visible(el); if (!b) return;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 12) r.tiny.push(`${desc(el)} ${fs}px`);
    const hidX = /hidden|clip/.test(cs.overflowX), hidY = /hidden|clip/.test(cs.overflowY);
    if ((hidX && el.scrollWidth > el.clientWidth + 1) || (hidY && el.scrollHeight > el.clientHeight + 2)) {
      (cs.textOverflow === 'ellipsis' ? r.ellipsis : r.clipped).push(desc(el));
    }
    if ((b.right > W + 1 || b.left < -1) && !inHScroller(el)) r.offscreen.push(`${desc(el)} [${Math.round(b.left)}, ${Math.round(b.right)}]`);
    const fg = parse(cs.color), bg = bgOf(el);
    if (!fg || !bg) { r.unchecked++; return; }
    const op = effOpacity(el); if (op < 0.6) return;                      // atenuado a propósito (deshabilitado)
    const f = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
    const L1 = lum(f), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) r.contrast.push(`${desc(el)} ${ratio.toFixed(2)}:1`);
  });
  scrollTo(0, y0);
  for (const k of ['targets', 'clipped', 'ellipsis', 'offscreen', 'contrast', 'tiny']) r[k] = [...new Set(r[k])];
  return r;
}

const browser = await chromium.launch({ executablePath: CHROME });
const report = [];
let failures = 0;
for (const theme of THEMES) {
  for (const v of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: v.w, height: v.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      reducedMotion: flag('reduced') ? 'reduce' : 'no-preference', locale: 'es-ES',
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(urlFor(theme), { waitUntil: 'load', timeout: 30000 }).catch(e => errs.push(e.message));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(350 + extraWait);
    for (const sel of clicks) {
      await p.locator(sel).first().click().catch(e => errs.push(`click ${sel}: ${e.message.split('\n')[0]}`));
      await p.waitForTimeout(450);
      // Si el clic abrió una hoja inferior, se espera a que acabe de subir (o 800 ms como tope)
      if (await p.locator('dialog.sheet[open]').count()) {
        await p.evaluate(() => new Promise(done => {
          const d = document.querySelector('dialog.sheet[open]');
          const t = setTimeout(done, 800);
          d.addEventListener('transitionend', e => { if (e.target === d) { clearTimeout(t); setTimeout(done, 60); } }, { once: false });
        }));
        // y dos fotogramas más, con margen: con la CPU cargada el contenido de la hoja se rasteriza tarde
        await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        await p.waitForTimeout(400);
      }
    }
    if (scroll) { await p.evaluate(y => scrollTo(0, y), scroll); await p.waitForTimeout(350); }
    const base = `${page}${suffix}-${v.w}x${v.h}-${theme === 'dark' ? 'oscuro' : 'claro'}`;
    await p.screenshot({ path: `${out}/${base}.png`, timeout: 120000 });
    if (flag('full')) {
      // En página completa, lo fijo (barra inferior, acción principal, avisos) se lleva al pie del documento
      const tag = await p.addStyleTag({ content: 'body{position:relative}.tabbar,.toasts,.fab,.dock{position:absolute!important}' });
      await p.waitForTimeout(150);
      await p.screenshot({ path: `${out}/${base}-completa.png`, fullPage: true, timeout: 120000 });
      await tag.evaluate(n => n.parentNode.removeChild(n));
    }
    const a = await p.evaluate(audit);   // después de capturar: la auditoría desplaza la página
    a.errors = errs;
    const fail = a.hscroll > 0 || a.targets.length || a.clipped.length || a.offscreen.length || a.contrast.length || a.tiny.length || errs.length;
    if (fail) failures++;
    report.push({ shot: base, ok: !fail, ...a });
    const parts = [];
    if (a.hscroll) parts.push(`scroll horizontal ${a.hscroll}px`);
    if (a.targets.length) parts.push(`objetivos <44: ${a.targets.join(' | ')}`);
    if (a.clipped.length) parts.push(`texto cortado: ${a.clipped.join(' | ')}`);
    if (a.offscreen.length) parts.push(`fuera de pantalla: ${a.offscreen.join(' | ')}`);
    if (a.contrast.length) parts.push(`contraste: ${a.contrast.join(' | ')}`);
    if (a.tiny.length) parts.push(`texto <12px: ${a.tiny.join(' | ')}`);
    if (errs.length) parts.push(`errores: ${errs.join(' | ')}`);
    const warn = a.ellipsis.length ? ` (aviso, elipsis: ${a.ellipsis.length})` : '';
    console.log(`${fail ? 'FALLO' : 'ok   '} ${base}${warn}${parts.length ? '\n      ' + parts.join('\n      ') : ''}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/${page}${suffix}-informe.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.length - failures}/${report.length} capturas sin fallos. Informe: capturas/${page}${suffix}-informe.json`);
process.exit(failures ? 1 : 0);
