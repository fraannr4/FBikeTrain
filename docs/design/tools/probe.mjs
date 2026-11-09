// Sonda rápida del prototipo: abre una página y evalúa una expresión.
// Uso: node docs/design/tools/probe.mjs "inicio.html?theme=dark" "expresión JS" [ancho] [alto]
import { chromium } from 'file:///C:/Users/Fran.Romano/AppData/Local/npm-cache/_npx/411d535eabdf86de/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const [page, expr, w = '1440', h = '900'] = process.argv.slice(2);
const [file, query = ''] = page.split('?');
const b = await chromium.launch({ executablePath: 'C:/Users/Fran.Romano/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe' });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(pathToFileURL(resolve(here, '../prototipo-final', file)).href + (query ? '?' + query : ''), { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log(e.message));
await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(expr), null, 1));
await b.close();
