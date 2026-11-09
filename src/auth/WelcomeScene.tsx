import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { BRAND_DESTINATION, BRAND_ROAD, BrandMark } from '../ui/shell/BrandMark';
import { useReducedMotion } from '../ui/theme/motion';
import './welcome.css';

/** Tiempos del storyboard (ms). Deben coincidir con welcome.css. */
const LEAVE_AT = 1500, LEAVE_FOR = 300;
const REDUCED_LEAVE_AT = 700, REDUCED_LEAVE_FOR = 200;
const PROFILE_DEFAULT_NAME = 'Ciclista';

/** Nombre del saludo: perfil (si no es el genérico), metadatos, parte local del correo o nada. */
export function welcomeName(user: User, profileName?: string | null): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const candidates = [profileName === PROFILE_DEFAULT_NAME ? null : profileName, meta.display_name, meta.full_name, meta.name];
  for (const value of candidates) if (typeof value === 'string' && value.trim()) return value.trim();
  return user.email?.split('@')[0]?.trim() ?? '';
}

const motionPathSupported = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('offset-path', "path('M0 0L1 1')");

/** Bienvenida de un solo disparo tras un acceso real. Solo anima transform, opacity y stroke-dashoffset. */
export function WelcomeScene({ name, onLeave, onDone }: { name: string; onLeave: () => void; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const [rider] = useState(motionPathSupported);
  const callbacks = useRef({ onLeave, onDone });
  callbacks.current = { onLeave, onDone };
  const leave = useRef<() => void>(() => {});

  useEffect(() => {
    const exitFor = reduced ? REDUCED_LEAVE_FOR : LEAVE_FOR;
    let left = false;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (left) return;
      left = true;
      clearTimeout(leaveTimer);
      setLeaving(true);
      callbacks.current.onLeave();
      doneTimer = setTimeout(() => callbacks.current.onDone(), exitFor);
    };
    const leaveTimer = setTimeout(start, reduced ? REDUCED_LEAVE_AT : LEAVE_AT);
    leave.current = start;
    const onKey = () => start();
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(leaveTimer); clearTimeout(doneTimer); window.removeEventListener('keydown', onKey); };
    // La duración se fija al montar: cambiar la preferencia a mitad de escena no la reinicia.
  }, []);

  const greeting = name ? `Hola, ${name}.` : 'Hola.';
  return <div className={`welcome-scene${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" onClick={() => leave.current()}>
    <div className="welcome-mark" aria-hidden="true">
      <BrandMark className="welcome-brand" />
      <svg className="welcome-overlay" viewBox="0 0 64 64" fill="none" focusable="false">
        {!reduced && <circle className="welcome-ring" cx={BRAND_DESTINATION.cx} cy={BRAND_DESTINATION.cy} r="5" />}
        {!reduced && rider && <g className="welcome-rider" style={{ offsetPath: `path('${BRAND_ROAD}')` }}>
          <g className="welcome-rider-body">
            <circle cx="-3.4" cy="-2.6" r="2.4" /><circle cx="3.4" cy="-2.6" r="2.4" />
            <path d="M-3.4 -2.6L-0.8 -6.2L1.6 -2.6H-3.4M-0.8 -6.2H2.4L3.4 -2.6" />
            <path className="welcome-rider-figure" d="M-1.2 -7.4L1.4 -9.6L3 -8.2M-1.2 -7.4L0.6 -4.6" />
            <circle className="welcome-rider-head" cx="2" cy="-11" r="1.3" />
          </g>
        </g>}
      </svg>
    </div>
    <div className="welcome-copy">
      <h1 className="welcome-greeting">{greeting}</h1>
      <p className="welcome-subtitle">Tu próxima cima empieza aquí.</p>
    </div>
    <button type="button" className="btn btn--outline welcome-continue" onClick={e => { e.stopPropagation(); leave.current(); }}>Continuar</button>
  </div>;
}
