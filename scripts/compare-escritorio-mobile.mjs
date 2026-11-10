import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle');

// Compara píxeles decodificados: los metadatos PNG no cuentan como diferencias.
const root = process.argv[2] ?? 'escritorio.local';
const results = [];
for (const folder of readdirSync(join(root, 'antes')).filter(name => /^(360|390|430)-/.test(name))) {
  for (const file of readdirSync(join(root, 'antes', folder)).filter(name => name.endsWith('.png'))) {
    const before = PNG.sync.read(readFileSync(join(root, 'antes', folder, file)));
    const after = PNG.sync.read(readFileSync(join(root, 'despues', folder, file)));
    let changed = 0;
    if (before.width !== after.width || before.height !== after.height) changed = -1;
    else if (!before.data.equals(after.data)) for (let i = 0; i < before.data.length; i += 4) {
      if ([0, 1, 2, 3].some(channel => before.data[i + channel] !== after.data[i + channel])) changed++;
    }
    results.push({ file: `${folder}/${file}`, changedPixels: changed, identical: changed === 0 });
  }
}
writeFileSync(join(root, 'comparacion-movil.json'), JSON.stringify(results, null, 2));
const differences = results.filter(result => !result.identical);
console.log(`${results.length - differences.length}/${results.length} capturas móviles idénticas.`);
if (differences.length) { console.log(differences); process.exitCode = 1; }
