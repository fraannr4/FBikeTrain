import { useEffect, useRef, useState } from 'react';
import { profileShareUrl } from '../../social/challengeStatus';
import { Check, Share2 } from '../icons';

/** Compartir el enlace al perfil: hoja del sistema si existe y, si no, copia al portapapeles. */
export function ShareProfileButton({ userId, name, onResult }: { userId: string; name: string; onResult: (message: string) => void }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const confirm = (message: string) => {
    onResult(message); setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1800);
  };
  async function share() {
    const url = profileShareUrl(window.location.href, userId);
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: `${name} en FBikeTrain`, url }); return; }
      catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); confirm('Enlace copiado. Pégalo donde quieras.'); }
    catch { onResult(`No se pudo copiar. Este es tu enlace: ${url}`); }
  }
  return <button className="btn btn--secondary profile-share" type="button" onClick={() => void share()} aria-label="Compartir perfil" data-done={done || undefined}>
    <span className="profile-share-icon" aria-hidden="true"><Share2 className="ic" /><Check className="ic" /></span>Compartir
  </button>;
}
