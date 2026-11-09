// Comprueba que la web publicada (dist) no lleva claves de servidor. Uso: node scripts/check-bundle-secrets.mjs [dist]
// La URL del proyecto y la clave publicable de Supabase son públicas y no cuentan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATTERNS = [
  ['clave de Groq', /gsk_[A-Za-z0-9]{20,}/],
  ['clave secreta de Supabase', /sb_secret_[A-Za-z0-9_-]{10,}/],
  // Las claves de ORS son JSON en base64 con la organización de HeiGIT: {"org":"5b3ce3597851110001cf6248",...
  ['clave de ORS', /eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgi|5b3ce3597851110001cf6248/],
  ['nombre de un secreto del servidor', /\b(?:SUPABASE_SERVICE_ROLE_KEY|ORS_API_KEY|GROQ_API_KEY)\b/],
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]*/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Un hallazgo por fichero: «ruta: tipo de secreto». */
export function findSecrets(dir) {
  const found = [];
  for (const path of files(dir)) {
    const text = readFileSync(path, 'latin1');
    let kind = PATTERNS.find(([, re]) => re.test(text))?.[0];
    if (!kind) {
      for (const [, payload] of text.matchAll(JWT)) {
        try {
          if (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role') kind = 'JWT de service_role';
        } catch {
          /* no es un JWT */
        }
      }
    }
    if (kind) found.push(`${relative(dir, path)}: ${kind}`);
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? 'dist';
  const found = findSecrets(dir);
  if (found.length > 0) {
    console.error(`FAIL: el bundle lleva secretos:\n${found.join('\n')}`);
    process.exit(1);
  }
  console.log(`PASS: ningún secreto en ${dir}.`);
}
