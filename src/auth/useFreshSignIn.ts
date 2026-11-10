/**
 * Marca de «acceso recién hecho». Separa un inicio de sesión real (contraseña, enlace de
 * correo) del `SIGNED_IN` que Supabase repite al volver a la pestaña o de una sesión restaurada.
 * Se guarda en sessionStorage para sobrevivir a la redirección de OAuth; si el navegador lo
 * bloquea, queda en memoria para el acceso con contraseña.
 */
const KEY = 'fbiketrain-fresh-sign-in';
const MAX_AGE_MS = 10 * 60 * 1000;
let memory: number | null = null;

export function armFreshSignIn(): void {
  memory = Date.now();
  try { sessionStorage.setItem(KEY, String(memory)); } catch { /* sessionStorage bloqueado: basta la memoria */ }
}

export function disarmFreshSignIn(): void {
  memory = null;
  try { sessionStorage.removeItem(KEY); } catch { /* nada que limpiar */ }
}

/** Consume la marca: `true` solo una vez y solo si tiene menos de 10 minutos. */
export function takeFreshSignIn(): boolean {
  let stored: number | null = null;
  try { const raw = sessionStorage.getItem(KEY); stored = raw === null ? null : Number(raw); } catch { /* usa la memoria */ }
  const armedAt = stored ?? memory;
  disarmFreshSignIn();
  return armedAt !== null && Number.isFinite(armedAt) && Date.now() - armedAt >= 0 && Date.now() - armedAt <= MAX_AGE_MS;
}
