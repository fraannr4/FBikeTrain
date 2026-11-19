import { memo, useMemo, useRef, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { Ban, CircleAlert } from '../icons';
import { groupByDay, messageTime, type LocalMessage } from './model';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

type Props = {
  messages: LocalMessage[];
  now: number;
  myId: string;
  peerName: string;
  /** Mensaje propio bajo el que va «Visto». */
  seenId: string | null;
  /** Falso en solo lectura: «Reintentar» ya no serviría. */
  canRetry: boolean;
  onRetry: (id: string) => void;
  /** Pulsación larga, clic derecho o Intro sobre un mensaje: «Borrar» o «Denunciar». */
  onMenu: (message: LocalMessage) => void;
  threadRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
  loadingOlder: boolean;
};

/** Hilo de la conversación, por días. Es un `log`: el lector de pantalla dice los mensajes que llegan. */
export function MessageList({ messages, now, myId, peerName, seenId, canRetry, onRetry, onMenu, threadRef, onScroll, loadingOlder }: Props) {
  const days = useMemo(() => groupByDay(messages, now), [messages, now]);
  // Una sola parada de tabulador en el hilo: el último mensaje con menú. Entre mensajes se va con las flechas.
  const tabStopId = useMemo(() => [...messages].reverse().find((m) => !m.deleted && !m.state)?.id ?? null, [messages]);
  return (
    <div ref={threadRef} className="chat-thread" role="log" aria-live="polite" aria-label={`Mensajes con ${peerName}`} onScroll={onScroll}>
      {loadingOlder ? <p className="chat-system chat-older">Cargando mensajes anteriores…</p> : null}
      {days.map((day) => (
        <section className="chat-day" key={day.label} aria-label={day.label}>
          <h2 className="chat-day-label">{day.label}</h2>
          <ol className="chat-msgs">
            {day.items.map((m) => (
              <MessageItem key={m.id} m={m} own={m.senderId === myId} author={m.senderName || peerName} seen={m.id === seenId} tabStop={m.id === tabStopId} canRetry={canRetry} onRetry={onRetry} onMenu={onMenu} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

type ItemProps = {
  m: LocalMessage;
  own: boolean;
  author: string;
  seen: boolean;
  tabStop: boolean;
  canRetry: boolean;
  onRetry: (id: string) => void;
  onMenu: (message: LocalMessage) => void;
};

const MessageItem = memo(function MessageItem({ m, own, author, seen, tabStop, canRetry, onRetry, onMenu }: ItemProps) {
  const cls = ['chat-msg', own ? 'chat-msg--own' : 'chat-msg--in', m.state === 'failed' ? 'chat-msg--failed' : ''].filter(Boolean).join(' ');
  // Quién escribe, para quien no ve el lado de la burbuja.
  const who = <span className="sr-only">{own ? 'Tú: ' : `${author}: `}</span>;
  if (m.deleted) {
    return (
      <li className={cls}>
        <p className="chat-bubble chat-bubble--deleted">{who}<Ban className="ic" aria-hidden="true" />Mensaje borrado</p>
      </li>
    );
  }
  return (
    <li className={cls}>
      <Bubble message={m} tabStop={tabStop} onMenu={m.state ? undefined : onMenu}>
        {who}
        <span className="chat-text" dir="auto">{m.kind === 'text' ? m.body : 'Mensaje no compatible con esta versión'}</span>
        <time className="chat-time" dateTime={m.createdAt}>{messageTime(m.createdAt)}</time>
      </Bubble>
      {seen ? <p className="chat-status">Visto</p> : null}
      {m.state === 'failed' ? (
        <p className="chat-status chat-status--failed">
          <CircleAlert className="ic" aria-hidden="true" />No enviado
          {canRetry ? <button type="button" className="chat-retry" onClick={() => onRetry(m.id)}>Reintentar</button> : null}
        </p>
      ) : null}
    </li>
  );
});

/** Burbuja; si tiene menú, se abre con pulsación larga, clic derecho o, con el foco en ella, Intro. Las flechas llevan al mensaje de antes o al de después. */
function Bubble({ message, tabStop, onMenu, children }: { message: LocalMessage; tabStop: boolean; onMenu?: (m: LocalMessage) => void; children: ReactNode }) {
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  if (!onMenu) return <p className="chat-bubble">{children}</p>;
  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerDown = (e: PointerEvent<HTMLParagraphElement>) => {
    if (e.pointerType !== 'touch') return;
    cancel();
    press.current = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { press.current = null; onMenu(message); }, LONG_PRESS_MS) };
  };
  const onPointerMove = (e: PointerEvent<HTMLParagraphElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) cancel();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLParagraphElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const all = [...(e.currentTarget.closest('.chat-thread')?.querySelectorAll<HTMLElement>('.chat-bubble[tabindex]') ?? [])];
      const next = all[all.indexOf(e.currentTarget) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) {
        e.preventDefault();
        next.focus();
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      onMenu(message);
    }
  };
  return (
    <p
      className="chat-bubble"
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-haspopup="dialog"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => { e.preventDefault(); cancel(); onMenu(message); }}
      onKeyDown={onKeyDown}
    >
      {children}
    </p>
  );
}
