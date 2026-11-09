// Capturas definitivas del prototipo: cada página a 390x844, tema oscuro y claro, con las
// comprobaciones de shots.mjs (scroll horizontal, objetivos de 44 px, texto cortado, contraste...).
// Uso: node docs/design/prototipo-movil/definitivas.mjs
// Deja capturas/<pagina>-390-oscuro.png y capturas/<pagina>-390-claro.png.
import { execFileSync } from 'node:child_process';
import { renameSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'capturas');
const PAGES = ['index', 'inicio', 'historial', 'salida', 'subidas', 'repetidas', 'rutas', 'ia',
  'calendario', 'objetivos', 'mas', 'importar', 'ajustes', 'kit'];

let failed = 0;
for (const p of PAGES) {
  try {
    execFileSync(process.execPath, [resolve(here, 'shots.mjs'), p, 'def', '--only=390x844'], { stdio: 'inherit' });
  } catch { failed++; }
  for (const [theme, tag] of [['oscuro', 'oscuro'], ['claro', 'claro']]) {
    const from = resolve(out, `${p}-def-390x844-${theme}.png`), to = resolve(out, `${p}-390-${tag}.png`);
    if (existsSync(from)) { if (existsSync(to)) unlinkSync(to); renameSync(from, to); }
  }
  const rep = resolve(out, `${p}-def-informe.json`);
  if (existsSync(rep)) renameSync(rep, resolve(out, `${p}-390-informe.json`));
}
console.log(failed ? `\n${failed} página(s) con fallos: mira capturas/<pagina>-390-informe.json` : '\nTodas las páginas sin fallos.');
process.exit(failed ? 1 : 0);
