import { useEffect, useId, useRef, useState } from 'react';
import { formatCount } from '../format';
import { Archive, Bell, Upload } from '../icons';
import type { Notice } from './inicioNotices';

const ICON = { import: Upload, backup: Archive } as const;

/**
 * Campana de avisos locales. Sin avisos no pinta nada. El panel solo existe abierto;
 * Esc (que devuelve el foco a la campana) y pulsar fuera lo cierran.
 */
export function Notices({ notices }: { notices: Notice[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      bellRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (notices.length === 0) return null;
  const n = notices.length;

  return (
    <div className="notices" ref={wrapRef}>
      <button
        ref={bellRef}
        type="button"
        className="round press"
        aria-label={`Avisos, ${formatCount(n)} ${n === 1 ? 'aviso' : 'avisos'}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={20} strokeWidth={2} aria-hidden="true" />
        <span className="badge" aria-hidden="true">
          {formatCount(n)}
        </span>
      </button>
      {open ? (
        <section id={panelId} className="notices-panel" aria-labelledby={titleId}>
          <h2 id={titleId}>Avisos</h2>
          <ul>
            {notices.map((x) => {
              const Icon = ICON[x.id];
              return (
                <li key={x.id}>
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <div>
                    <p>{x.text}</p>
                    <a className="link" href={x.href} onClick={() => setOpen(false)}>
                      {x.action}
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
