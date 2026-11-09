import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Especificador no literal: el script es JavaScript sin tipos y se ejecuta tal cual en el despliegue.
const SCRIPT = '../scripts/check-bundle-secrets.mjs';
const load = async () => (await import(/* @vite-ignore */ SCRIPT)) as { findSecrets: (dir: string) => string[] };

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('el bundle publicado no lleva secretos', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    mkdirSync(join(dir, 'assets'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('un bundle con la clave publicable y la URL del proyecto está limpio', async () => {
    writeFileSync(join(dir, 'assets', 'index.js'), 'const u="https://x.supabase.co",k="sb_publishable_abc123";fetch(u+"/functions/v1/ors-proxy")');
    expect((await load()).findSecrets(dir)).toEqual([]);
  });

  it.each([
    ['clave de Groq', 'const k="gsk_' + 'A'.repeat(40) + '"'],
    ['clave secreta de Supabase', 'const k="sb_secret_' + 'b'.repeat(30) + '"'],
    ['JWT de service_role', `const k="${b64url({ alg: 'HS256' })}.${b64url({ role: 'service_role', iss: 'supabase' })}.firma"`],
    ['clave de ORS', 'const k="' + Buffer.from('{"org":"5b3ce3597851110001cf6248","id":"x"}').toString('base64') + '"'],
    ['nombre de un secreto del servidor', 'Deno.env.get("ORS_API_KEY")'],
  ])('detecta %s', async (_name, code) => {
    writeFileSync(join(dir, 'assets', 'index.js'), code);
    expect((await load()).findSecrets(dir)).toHaveLength(1);
  });
});
