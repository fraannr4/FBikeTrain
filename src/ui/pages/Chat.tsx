import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import {
  deleteMessage,
  listConversations,
  listMessages,
  markRead,
  newMessageId,
  reportMessage,
  sendText,
  type Conversation,
} from '../../social/chat';
import { notifyChatChanged } from '../../social/chatBadge';
import { POLL_MS, subscribeConversation } from '../../social/chatRealtime';
import { Composer } from '../chat/Composer';
import { MessageList } from '../chat/MessageList';
import { isReadOnlyError, mergeMessages, seenMessageId, type LocalMessage } from '../chat/model';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { Sheet } from '../components/Sheet';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { StateView } from '../components/StateView';
import { useToast } from '../components/Toast';
import { useDesktopLayout, WIDE_QUERY } from '../hooks/useDesktopLayout';
import { usePageTitle } from '../hooks/usePageTitle';
import { ChevronLeft, CircleAlert, Lock, MessageCircle } from '../icons';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { useBack } from '../shell/navHistory';
import { ConversationList, REGISTERED_ONLY } from './Chats';
import '../styles/profile.css';
import '../styles/chat.css';

/** Mensajes por página: el mismo `page_size` que pide `listMessages`. */
const PAGE_SIZE = 50;
const UNAVAILABLE = 'Esta conversación ya no está disponible.';
const NOT_FRIENDS = 'Ya no sois amigos: no puedes escribir aquí.';
const message = (e: unknown) => (e instanceof Error ? e.message : 'No se ha podido completar. Comprueba la conexión e inténtalo de nuevo.');

/** `#/chat/:id`. Desde 1280 px, con la lista de conversaciones a la izquierda. */
export function Chat() {
  const account = useAccount();
  const { id = '' } = useParams();
  const wide = useDesktopLayout(WIDE_QUERY);
  if (!account || account.user.is_anonymous) return <Page title="Chat" back="/chat"><p>{REGISTERED_ONLY}</p></Page>;
  const view = <ChatView key={id} account={account} id={id} />;
  if (!wide) return view;
  return (
    <div className="chat-split">
      <nav className="chat-split-list" aria-label="Conversaciones">
        <ConversationList account={account} />
      </nav>
      {view}
    </div>
  );
}

/**
 * Una conversación. La cabecera sale de `listConversations()` (no hay RPC de una sola). El canal de
 * tiempo real solo avisa; con él caído se sondea cada `POLL_MS` a la vista. Envío optimista: si falla,
 * «No enviado» y «Reintentar» con el mismo `id`, que el servidor no duplica.
 */
function ChatView({ account, id }: { account: Account; id: string }) {
  const { client, user } = account;
  const myId = user.id;
  const toast = useToast();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<Conversation | 'missing' | null>(null);
  const [messages, setMessages] = useState<LocalMessage[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  const [readOnly, setReadOnly] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [menu, setMenu] = useState<LocalMessage | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const current = useRef<LocalMessage[]>([]);
  const inFlight = useRef(new Set<string>());
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const olderBusy = useRef(false);
  /** Hay algo sin marcar como leído: la primera carga, un mensaje ajeno nuevo o un marcado que falló. */
  const pendingRead = useRef(true);

  const apply = useCallback((fn: (cur: LocalMessage[]) => LocalMessage[]) => {
    setMessages((cur) => {
      const next = fn(cur ?? []);
      current.current = next;
      return next;
    });
  }, []);

  /** Última página y cabecera. Lo pendiente de leer se marca con la app a la vista; si llegó oculta, al volver. */
  const load = useCallback(async (initial: boolean) => {
    const [rows, page] = await Promise.allSettled([listConversations(client), listMessages(client, id)]);
    if (rows.status === 'fulfilled') {
      const found = rows.value.find((c) => c.id === id);
      if (!found) return setConversation('missing');
      setConversation(found);
    }
    if (page.status === 'rejected' && message(page.reason) === UNAVAILABLE) return setConversation('missing');
    if (rows.status === 'rejected' || page.status === 'rejected') {
      if (initial) setError(message(rows.status === 'rejected' ? rows.reason : (page as PromiseRejectedResult).reason));
      return;
    }
    const known = new Set(current.current.map((m) => m.id));
    const fresh = page.value.some((m) => m.senderId !== myId && !known.has(m.id));
    apply((cur) => mergeMessages(cur, page.value));
    setNow(Date.now());
    setError('');
    if (initial) setHasMore(page.value.length === PAGE_SIZE);
    if (fresh) pendingRead.current = true;
    if (pendingRead.current && !document.hidden) {
      pendingRead.current = false;
      markRead(client, id).then(notifyChatChanged, () => { pendingRead.current = true; });
    }
  }, [apply, client, id, myId]);

  useEffect(() => { void load(true); }, [load, attempt]);

  // Tiempo real: solo un aviso para volver a pedir la página. Sin canal vivo, sondeo a la vista.
  useEffect(() => {
    if (typeof client.channel !== 'function') return;
    return subscribeConversation(client, id, () => void load(false), setLive);
  }, [client, id, load]);
  useEffect(() => {
    if (live) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(false); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, load]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void load(false); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // El campo queda sobre el teclado: la altura de la pantalla sigue a la ventana visible.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const fit = () => root.style.setProperty('--chat-vh', `${Math.round(vv.height)}px`);
    fit();
    vv.addEventListener('resize', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      root.style.removeProperty('--chat-vh');
    };
  }, []);

  // Al cargar una página anterior, la vista no salta; si estabas abajo, sigues abajo.
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const loadOlder = useCallback(async () => {
    const oldest = current.current.find((m) => !m.state);
    if (!oldest || olderBusy.current) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const page = await listMessages(client, id, oldest.createdAt);
      const el = threadRef.current;
      if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      apply((cur) => mergeMessages(cur, page));
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      // Se vuelve a intentar al volver a subir.
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }, [apply, client, id]);

  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && hasMore) void loadOlder();
  };

  const deliver = useCallback(async (m: LocalMessage) => {
    if (inFlight.current.has(m.id)) return;
    inFlight.current.add(m.id);
    try {
      const saved = await sendText(client, id, m.body, m.id);
      apply((cur) => mergeMessages(cur, [saved]));
    } catch (e) {
      const text = message(e);
      apply((cur) => cur.map((x) => (x.id === m.id ? { ...x, state: 'failed' } : x)));
      if (isReadOnlyError(text)) setReadOnly(text);
      else toast(text, { tone: 'error' });
    } finally {
      inFlight.current.delete(m.id);
    }
  }, [apply, client, id, toast]);

  const send = useCallback((body: string) => {
    const m: LocalMessage = {
      id: newMessageId(), conversationId: id, senderId: myId, senderName: '', createdAt: new Date().toISOString(),
      kind: 'text', body, payload: {}, deleted: false, state: 'sending',
    };
    stick.current = true;
    apply((cur) => [...cur, m]);
    void deliver(m);
  }, [apply, deliver, id, myId]);

  const retry = useCallback((msgId: string) => {
    const m = current.current.find((x) => x.id === msgId);
    if (!m || m.state !== 'failed' || inFlight.current.has(msgId)) return;
    apply((cur) => cur.map((x) => (x.id === msgId ? { ...x, state: 'sending' } : x)));
    void deliver(m);
  }, [apply, deliver]);

  const peerName = conversation && conversation !== 'missing' ? (conversation.kind === 'group' ? conversation.title : conversation.peerName) || 'Ciclista' : '';
  usePageTitle(peerName || 'Conversación');

  if (conversation === 'missing') {
    return (
      <Page title="Chat" back="/chat">
        <StateView icon={MessageCircle} level={2} title={UNAVAILABLE} action={<Link className="btn btn--secondary" to="/chat">Volver a Chat</Link>} />
      </Page>
    );
  }
  if (error && (!conversation || !messages)) {
    return (
      <Page title="Chat" back="/chat">
        <StateView icon={CircleAlert} tone="error" level={2} title="No se ha podido abrir la conversación" text={error}
          action={<button type="button" className="btn btn--secondary" onClick={() => { setError(''); setAttempt((n) => n + 1); }}>Reintentar</button>} />
      </Page>
    );
  }

  const ready = conversation && messages;
  const lockedText = readOnly || (conversation && !conversation.canSend ? NOT_FRIENDS : '');
  return (
    <div className="chat-screen">
      <ChatBar conversation={conversation} account={account} name={peerName} />
      {ready ? (
        <MessageList
          messages={messages}
          now={now}
          myId={myId}
          peerName={peerName}
          seenId={seenMessageId(conversation, messages, myId)}
          canRetry={!lockedText}
          onRetry={retry}
          onMenu={setMenu}
          threadRef={threadRef}
          onScroll={onScroll}
          loadingOlder={loadingOlder}
        />
      ) : (
        <div className="chat-thread"><SkeletonRows rows={3} label="Cargando la conversación…" /></div>
      )}
      {!ready ? null : lockedText ? (
        <p className="chat-readonly" role="status"><Lock className="ic" aria-hidden="true" />{lockedText}</p>
      ) : (
        <Composer onSend={send} />
      )}
      <MessageMenu
        message={menu}
        myId={myId}
        peerName={peerName}
        onClose={() => setMenu(null)}
        onDelete={async (m) => {
          await deleteMessage(client, m.id);
          apply((cur) => cur.map((x) => (x.id === m.id ? { ...x, deleted: true } : x)));
          toast('Mensaje borrado.', { tone: 'good' });
        }}
        onReport={async (m, reason) => {
          await reportMessage(client, m.id, reason);
          toast(`Denuncia enviada. Has bloqueado a ${m.senderName || peerName}.`, { tone: 'good' });
          navigate('/chat');
        }}
      />
    </div>
  );
}

function ChatBar({ conversation, account, name }: { conversation: Conversation | null; account: Account; name: string }) {
  const back = useBack('/chat');
  const peerId = conversation?.kind === 'direct' ? conversation.peerId : null;
  const who = conversation ? (
    <>
      <ProfileAvatar client={account.client} userId={peerId ?? conversation.id} name={name} version={conversation.peerAvatarVersion ?? 0} />
      <span className="chat-peer-main"><h1 className="chat-peer-name" dir="auto">{name}</h1></span>
    </>
  ) : (
    <Skeleton variant="title" width="40%" />
  );
  return (
    <header className="appbar chat-bar">
      <div className="appbar-lead">
        <Link to={back.to} className="icon-btn" aria-label={back.label} onClick={back.onClick}>
          <ChevronLeft className="ic ic-lg" aria-hidden="true" />
        </Link>
      </div>
      {peerId ? (
        <Link className="chat-peer" to={`/personas/${encodeURIComponent(peerId)}`} aria-label={`${name}, ver su perfil`}>{who}</Link>
      ) : (
        <div className="chat-peer">{who}</div>
      )}
      <div className="appbar-actions" />
    </header>
  );
}

/** Hoja de un mensaje: «Borrar» si es tuyo; «Denunciar», con motivo y aviso de bloqueo, si es ajeno. */
function MessageMenu({ message: selected, myId, peerName, onClose, onDelete, onReport }: {
  message: LocalMessage | null;
  myId: string;
  peerName: string;
  onClose: () => void;
  onDelete: (m: LocalMessage) => Promise<void>;
  onReport: (m: LocalMessage, reason: string) => Promise<void>;
}) {
  // Mientras la hoja baja, `message` ya es null: se sigue enseñando el último para que el título no cambie.
  const last = useRef(selected);
  if (selected) last.current = selected;
  const m = selected ?? last.current;
  const own = m?.senderId === myId;
  const author = m?.senderName || peerName;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (busy) return;
    setReason('');
    setError('');
    onClose();
  };
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      setReason('');
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const report = (e: FormEvent) => {
    e.preventDefault();
    if (m) void run(() => onReport(m, reason));
  };
  const length = [...reason.trim()].length;
  return (
    <Sheet open={selected !== null} onClose={close} title={own ? 'Tu mensaje' : `Mensaje de ${author}`}>
      <div className="chat-menu">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {own ? (
          <>
            <p className="help">Se borra para los dos: quedará «Mensaje borrado».</p>
            <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={() => m && void run(() => onDelete(m))}>Borrar mensaje</button>
          </>
        ) : (
          <form className="chat-menu" onSubmit={report}>
            <label className="field">
              <span className="field-label">Motivo de la denuncia</span>
              <textarea className="input" rows={3} minLength={5} maxLength={500} value={reason} disabled={busy}
                placeholder="Cuéntanos qué ha ocurrido, sin incluir datos personales." onChange={(e) => setReason(e.target.value)} />
            </label>
            <p className="help">Al denunciar, también bloqueas a {author}: dejaréis de ser amigos y esta conversación dejará de verse. La denuncia es privada y se revisa a mano.</p>
            <button type="submit" className="btn btn--danger btn--block" disabled={busy || length < 5 || length > 500}>Denunciar y bloquear</button>
          </form>
        )}
      </div>
    </Sheet>
  );
}
