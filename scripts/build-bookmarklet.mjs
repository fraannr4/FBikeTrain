// Genera public/wikiloc-marcador.html: el marcador «→ FBikeTrain» minificado y su página de instalación.
// Uso: npm run build:bookmarklet (también lo lanza npm run build).
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = new URL('../public/wikiloc-marcador.html', import.meta.url);

/** Empaqueta una entrada sin escribir en disco y devuelve su código. */
async function bundle(entry, format) {
  const result = await build({
    root,
    configFile: false,
    envFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      write: false,
      emptyOutDir: false,
      minify: format === 'iife',
      target: 'es2019',
      lib: { entry, formats: [format], name: 'fbtMarcador', fileName: 'marcador' },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap(output => output.output).filter(item => item.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`Se esperaba un único fichero para ${entry}.`);
  return chunks[0].code.trim();
}

const code = await bundle('src/bookmarklet/main.ts', 'iife');
const page = await bundle('src/bookmarklet/installPage.ts', 'es');
const { renderInstallPage } = await import(`data:text/javascript;base64,${Buffer.from(page).toString('base64')}`);
await writeFile(target, renderInstallPage(code));
console.log(`Marcador: ${(code.length / 1024).toFixed(1)} KB de código. Página: ${fileURLToPath(target)}`);
