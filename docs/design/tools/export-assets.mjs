// Exporta los SVG finales a docs/design/assets/ a partir del prototipo ya renderizado.
// Uso: node docs/design/tools/export-assets.mjs
// Serializa el paisaje del hero (#land) con los tokens resueltos a valores fijos,
// para que el SVG funcione fuera de la app (Figma, README, favicon, etc.).
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const proto = resolve(here, '../prototipo-final');
const out = resolve(here, '../assets');
mkdirSync(out, { recursive: true });
const CHROME = 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

// Se ejecuta en la página: clona #land y fija en atributos el estilo calculado de cada nodo.
function serializeLand() {
  const src = document.getElementById('land');
  const clone = src.cloneNode(true);
  const SHAPE = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'fill-opacity', 'opacity', 'stroke-linejoin', 'stroke-linecap'];
  const DEFAULT = { stroke: 'none', 'stroke-width': '1px', 'stroke-opacity': '1', 'fill-opacity': '1', opacity: '1', 'stroke-linejoin': 'miter', 'stroke-linecap': 'butt', 'stop-opacity': '1' };
  const hex = (v) => v.replace(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g, (m, r, g, b, a) => a !== undefined ? m : '#' + [r, g, b].map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase());
  const a = src.querySelectorAll('*'), b = clone.querySelectorAll('*');
  a.forEach((node, i) => {
    const cs = getComputedStyle(node), c = b[i], tag = node.tagName.toLowerCase();
    const props = tag === 'stop' ? ['stop-color', 'stop-opacity'] : /^(path|rect|circle|ellipse|line|polyline|polygon)$/.test(tag) ? SHAPE : tag === 'g' ? ['opacity'] : [];
    props.forEach((p) => {
      const own = node.getAttribute(p);
      if (own && own.startsWith('url(')) return;
      const v = cs.getPropertyValue(p).trim();
      if (!v || DEFAULT[p] === v) { c.removeAttribute(p); return; }
      c.setAttribute(p, hex(v.replace(/url\("?[^#]*#([^")]+)"?\)/, 'url(#$1)')));
    });
    // El trazo de carga (.draw) se exporta ya dibujado y visible.
    if (node.classList.contains('draw')) c.removeAttribute('opacity');
    c.removeAttribute('style'); c.removeAttribute('class'); c.removeAttribute('pathLength');
  });
  const vb = src.getAttribute('viewBox');
  clone.removeAttribute('class'); clone.removeAttribute('id'); clone.removeAttribute('aria-hidden');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const [, , w, h] = vb.split(' ');
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  clone.setAttribute('preserveAspectRatio', 'xMidYMax slice');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
}

function logo(theme) {
  const t = theme === 'light'
    ? { body: '#FFFFFF', stroke: '#0E1730', band: '#1F5FD6', ink: '#0E1730' }
    : { body: '#EAF0FA', stroke: 'none', band: '#2A64DA', ink: '#0A1122' };
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 34" width="104" height="136">
  <title>FBikeTrain: hito kilométrico</title>
  <defs><clipPath id="hito-clip"><path d="M1.5 33V13A11.5 11.5 0 0 1 24.5 13V33Z"/></clipPath></defs>
  <path d="M1.5 33V13A11.5 11.5 0 0 1 24.5 13V33Z" fill="${t.body}" stroke="${t.stroke}" stroke-width="1.5"/>
  <rect x="0" y="0" width="26" height="11" fill="${t.band}" clip-path="url(#hito-clip)"/>
  <text x="13" y="28" text-anchor="middle" fill="${t.ink}" font-family="'Barlow Semi Condensed', 'Barlow', sans-serif" font-weight="700" font-size="15">F</text>
</svg>
`;
}

const browser = await chromium.launch({ executablePath: CHROME });
const jobs = [
  { file: 'hero-oscuro.svg', theme: 'dark', vp: { width: 1440, height: 900 } },
  { file: 'hero-claro.svg', theme: 'light', vp: { width: 1440, height: 900 } },
  { file: 'fondo-movil-oscuro.svg', theme: 'dark', vp: { width: 390, height: 844 }, mobile: true },
  { file: 'fondo-movil-claro.svg', theme: 'light', vp: { width: 390, height: 844 }, mobile: true }
];
for (const j of jobs) {
  const ctx = await browser.newContext({ viewport: j.vp, deviceScaleFactor: 1, isMobile: !!j.mobile, hasTouch: !!j.mobile, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.route(/tile|cyclosm|openstreetmap/i, (r) => r.abort());
  await page.goto(pathToFileURL(resolve(proto, 'inicio.html')).href + '?theme=' + j.theme);
  await page.waitForSelector('body[data-settled]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const svg = await page.evaluate(serializeLand);
  writeFileSync(resolve(out, j.file), svg, 'utf8');
  console.log(j.file, Math.round(svg.length / 1024) + ' KB');
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(out, 'logo-hito.svg'), logo('dark'), 'utf8');
writeFileSync(resolve(out, 'logo-hito-claro.svg'), logo('light'), 'utf8');
console.log('logo-hito.svg, logo-hito-claro.svg');
