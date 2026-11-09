// Sirve docs/design sin caché, para ver el prototipo en el móvil tal y como está en disco.
// Vite no vale para esto: su vigilante ignora docs/** y sigue sirviendo versiones viejas.
//   node docs/design/prototipo-movil/servir.mjs [puerto]      (5174 por defecto)
// En el móvil, con la misma wifi: http://<IP-del-PC>:5174/prototipo-movil/inicio.html
// Si no carga, Windows puede pedir permiso en el cortafuegos para Node la primera vez.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // docs/design
const PORT = +(process.argv[2] || 5174);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/prototipo-movil/index.html';
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }   // nada fuera de docs/design
    const st = await stat(file);
    const target = st.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',                                        // cada recarga lee el disco
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`Prototipo sin caché en http://localhost:${PORT}/prototipo-movil/inicio.html`);
  for (const ip of ips) console.log(`  en el móvil: http://${ip}:${PORT}/prototipo-movil/inicio.html`);
});
