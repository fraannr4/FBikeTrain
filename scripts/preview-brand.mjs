import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const svg = (await readFile(new URL('../public/brand-mark.svg', import.meta.url), 'utf8')).replace(/<style>[\s\S]*?<\/style>/, '');
const font = (await readFile(new URL('../node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2', import.meta.url))).toString('base64');
const panel = (theme, title) => `<section class="panel ${theme}"><h2>${title}</h2><div class="emblem">${svg}</div><div class="wordmark"><span>${svg}</span>FBikeTrain</div><div class="sizes">${[16,24,32].map(size => `<div><span style="width:${size}px;height:${size}px">${svg}</span><small>${size} px</small></div>`).join('')}</div></section>`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 740 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html lang="es"><meta charset="utf-8"><style>
    @font-face{font-family:Barlow;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:700}
    *{box-sizing:border-box}body{margin:0;background:#F5F1E6;color:#0E1730;padding:36px;font-family:system-ui,sans-serif}
    h1{font:700 38px/1.1 Barlow;margin:0 0 10px}p{margin:0;color:#56657F;font-size:15px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:28px}
    .panel{padding:24px;border-radius:22px;min-width:0;height:530px;border:1px solid #D9E1EE}.panel h2{font:700 22px Barlow;margin:0}.dark{background:#0A1122;color:#EAF0FA}.light{background:#EEF2F8;color:#0E1730}.cartography{background:#D8DFC5;color:#173D33}
    .emblem{width:190px;height:190px;margin:28px auto}.wordmark{display:flex;align-items:center;justify-content:center;gap:9px;font:700 32px Barlow;white-space:nowrap}.wordmark span{width:43px;height:43px;flex:none}
    svg{display:block;width:100%;height:100%}.road{stroke:currentColor}.relief{stroke:currentColor;opacity:.3}.destination{fill:#2465D5;stroke:#EEF2F8}.dark .destination{fill:#4C9BFF;stroke:#0A1122}.cartography .destination{stroke:#D8DFC5}
    .sizes{display:flex;justify-content:center;align-items:start;gap:32px;margin-top:40px}.sizes>div{display:grid;justify-items:center;align-items:center;gap:16px;grid-template-rows:32px auto}.sizes span{display:block}small{font-size:12px;opacity:.75}.note{margin-top:24px;font-size:14px}
    </style><h1>B · Trazado</h1><p>Una misma marca para toda la web: forma compartida, colores adaptados a cada superficie.</p><div class="grid">${panel('dark','Aplicación · Oscuro')}${panel('light','Aplicación · Claro')}${panel('cartography','Acceso · Cartografía')}</div><p class="note">SVG nativo · Símbolo, marca y tamaños pequeños · La adaptación Cartografía muestra la dirección del nuevo acceso.</p></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL('../docs/design/2026-11-09-logo-trazado-aplicaciones.png', import.meta.url)), fullPage: true });
  console.log('Preview: docs/design/2026-11-09-logo-trazado-aplicaciones.png');
} finally { await browser.close(); }
