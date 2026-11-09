// Pone en cada página del prototipo la versión de sus CSS y JS locales:
//   <script src="movil.js?v=3f9c1a2b">  (los 8 primeros caracteres del SHA-1 del fichero)
//
// Por qué: vite.config.ts no vigila docs/** (server.watch.ignored, por el EBUSY de
// Windows), así que Vite guarda para siempre su primera transformación de movil.js y
// el móvil recibe un kit antiguo («dur is not a function»). Con la versión en la URL,
// cada cambio del fichero es una URL nueva: Vite la transforma de cero y el navegador
// del móvil no tira de su caché. Como la versión sale del contenido, solo cambia
// cuando cambia el fichero.
//
// Uso, después de tocar movil.js, movil.css o cualquier otro CSS/JS del prototipo:
//   node docs/design/prototipo-movil/version.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hashes = new Map();
const hashOf = (name) => {
  if (!hashes.has(name)) {
    const p = resolve(here, name);
    hashes.set(name, existsSync(p) ? createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 8) : null);
  }
  return hashes.get(name);
};

let changed = 0;
for (const f of readdirSync(here).filter((n) => n.endsWith('.html'))) {
  const p = resolve(here, f), before = readFileSync(p, 'utf8');
  const after = before.replace(/\b(href|src)="([\w.-]+\.(?:css|js))(?:\?v=[\w-]*)?"/g, (m, attr, name) => {
    const h = hashOf(name);
    return h ? `${attr}="${name}?v=${h}"` : m;
  });
  if (after !== before) { writeFileSync(p, after); changed++; console.log(`versión puesta: ${f}`); }
}
// Sello de versión en la galería (index.html): huella de todo el prototipo y hora en que cambió.
// Así, en el móvil se ve de un vistazo si la página es la última.
{
  const files = readdirSync(here).filter((n) => /\.(html|css|js)$/.test(n)).sort();
  const strip = (t) => t.replace(/(<b data-build>)[^<]*(<\/b>)/, '$1$2');
  const all = createHash('sha1');
  for (const f of files) all.update(f).update(strip(readFileSync(resolve(here, f), 'utf8')));
  const build = all.digest('hex').slice(0, 7);
  const ip = resolve(here, 'index.html'), html = readFileSync(ip, 'utf8');
  const m = html.match(/<b data-build>([^<]*)<\/b>/);
  if (m && !m[1].startsWith(build)) {
    const d = new Date(), two = (n) => String(n).padStart(2, '0');
    const when = `${d.getDate()} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'][d.getMonth()]}, ${two(d.getHours())}:${two(d.getMinutes())}`;
    writeFileSync(ip, html.replace(m[0], `<b data-build>${build} · ${when}</b>`));
    console.log(`sello de versión: ${build} · ${when}`);
  }
}
console.log(`${changed} página(s) actualizadas. ${[...hashes].filter(([, h]) => h).map(([n, h]) => `${n}=${h}`).join(' ')}`);
