import { isAllowedRwgpsPath } from '../../../src/routes/sources/rwgpsService.ts';

/**
 * Cuenta común de Ride with GPS, compartida por las funciones `rwgps` y `route-sources`. La clave y el
 * token solo existen aquí: nunca salen en una respuesta ni en los registros.
 */

const API = 'https://ridewithgps.com';
const MAX_RESPONSE_BYTES = 15_000_000;

export function rwgpsApi(env: { apiKey: string; fixedToken: string; email: string; password: string }): {
  enabled: boolean;
  get: (path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;
} {
  const { apiKey, fixedToken, email, password } = env;

  /** Token de la cuenta común: el fijo, o uno pedido con el correo y la contraseña y guardado en memoria. */
  let cachedToken = '';
  async function authToken(renew: boolean, signal: AbortSignal): Promise<string> {
    if (fixedToken) return fixedToken;
    if (cachedToken && !renew) return cachedToken;
    const response = await fetch(`${API}/api/v1/auth_tokens.json`, {
      method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-rwgps-api-key': apiKey },
      body: JSON.stringify({ user: { email, password } }),
    });
    const json = await response.json().catch(() => null) as { auth_token?: { auth_token?: unknown } } | null;
    const token = json?.auth_token?.auth_token;
    if (!response.ok || typeof token !== 'string' || token.length < 8) throw new Error('auth');
    cachedToken = token;
    return token;
  }

  async function readCapped(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) return null;
    let text = ''; let size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('oversize'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    try { return JSON.parse(text); } catch { return null; }
  }

  /** Solo GET a la lista cerrada de `isAllowedRwgpsPath`; sin redirecciones. Un 401 renueva el token una vez. */
  async function get(path: string, signal: AbortSignal): Promise<{ status: number; json: unknown }> {
    if (!isAllowedRwgpsPath(path)) throw new Error('path');
    for (const renew of [false, true]) {
      let token: string;
      // Sin token de la cuenta común el servicio no está disponible (503 en el handler): el cliente para el lote.
      try { token = await authToken(renew, signal); }
      catch (e) { if (signal.aborted) throw e; return { status: 401, json: null }; }
      const response = await fetch(`${API}${path}`, {
        method: 'GET', signal, redirect: 'error',
        headers: { Accept: 'application/json', 'x-rwgps-api-key': apiKey, 'x-rwgps-auth-token': token },
      });
      if (response.status === 401 && !fixedToken && !renew) { await response.body?.cancel(); continue; }
      if (response.status !== 200) { await response.body?.cancel(); return { status: response.status, json: null }; }
      return { status: 200, json: await readCapped(response) };
    }
    return { status: 401, json: null };
  }

  return { enabled: Boolean(apiKey && (fixedToken || (email && password))), get };
}
