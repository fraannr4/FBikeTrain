import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listCommunityChallenges, listCommunityNotifications, readCommunityNotification, respondCommunityChallenge, CHALLENGE_LABELS, formatCommunityScore, rankedCommunityMembers, type CommunityChallenge, type CommunityNotification } from '../../social/communityChallenges';
import { syncCommunityScores } from '../../social/challengeScoring';
import { timeLeftLabel } from '../../social/challengeStatus';
import { notifyCommunityChanged } from '../../social/communityBadge';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { Skeleton } from '../components/Skeleton';
import { SegmentedControl } from '../components/SegmentedControl';
import { formatCount } from '../format';
import { Search } from '../icons';
import { RivalRow } from '../retos/RivalRow';
import { RetosEmpty } from '../retos/RetosEmpty';
import { DuelComparison } from '../retos/DuelComparison';
import '../styles/community-challenges.css';

export const communityError = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';
export const communityDate = (s: string) => new Date(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
type View = 'active' | 'notifications' | 'finished';
const VIEW_PARAM: Record<string, View> = { avisos: 'notifications', historial: 'finished' };

/** Pestaña Retos: rivales con su estado, invitaciones con respuesta en la tarjeta y el marcador. */
export function CommunityRetos() {
  const account = useAccount();
  return <Page title="Retos" variant="narrow" className="page--community"
    actions={<Link className="icon-btn" to="/ciclistas" aria-label="Buscar ciclistas"><Search className="ic" aria-hidden="true" /></Link>}>
    {account && !account.user.is_anonymous ? <CommunityRetosList account={account} /> : <p>Inicia sesión con una cuenta registrada para participar.</p>}
  </Page>;
}
function CommunityRetosList({ account }: { account: Account }) {
  const [params] = useSearchParams();
  const [rows, setRows] = useState<CommunityChallenge[] | null>(null);
  const [notifications, setNotifications] = useState<CommunityNotification[]>([]);
  const [view, setView] = useState<View>(() => VIEW_PARAM[params.get('vista') ?? ''] ?? 'active');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [notificationMore, setNotificationMore] = useState(false);
  const limit = useRef(50);
  const notificationLimit = useRef(50);
  const loading = useRef(false);
  const load = useCallback(async (sync = false) => {
    if (loading.current) return;
    loading.current = true; setBusy(true);
    try {
      if (sync) await syncCommunityScores(account.client, account.user.id);
      const [challengePages, noticePages] = await Promise.all([
        Promise.all(Array.from({ length: Math.ceil(limit.current / 50) }, (_, i) => listCommunityChallenges(account.client, i * 50))),
        Promise.all(Array.from({ length: Math.ceil(notificationLimit.current / 50) }, (_, i) => listCommunityNotifications(account.client, i * 50))),
      ]);
      setRows([...new Map(challengePages.flat().map(c => [c.id, c])).values()]);
      setNotifications([...new Map(noticePages.flat().map(n => [n.id, n])).values()]);
      setMore(challengePages.at(-1)?.length === 50); setNotificationMore(noticePages.at(-1)?.length === 50); setError('');
    } catch (e) { setError(communityError(e)); }
    finally { loading.current = false; setBusy(false); }
  }, [account.client, account.user.id]);
  useEffect(() => {
    void load(false);
    const refresh = () => { if (!document.hidden) void load(false); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  async function next() {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    try {
      if (view === 'notifications') {
        const nextRows = await listCommunityNotifications(account.client, notificationLimit.current);
        setNotifications(previous => [...new Map([...previous, ...nextRows].map(n => [n.id, n])).values()]); notificationLimit.current += 50; setNotificationMore(nextRows.length === 50);
      } else {
        const nextRows = await listCommunityChallenges(account.client, limit.current);
        setRows(previous => [...new Map([...(previous ?? []), ...nextRows].map(c => [c.id, c])).values()]); limit.current += 50; setMore(nextRows.length === 50);
      }
    } catch (e) { setError(communityError(e)); }
    finally { loading.current = false; setBusy(false); }
  }
  async function read(n: CommunityNotification) {
    try { await readCommunityNotification(account.client, n.id); setNotifications(previous => previous.map(row => row.id === n.id ? { ...row, read_at: new Date().toISOString() } : row)); }
    catch (e) { setError(communityError(e)); }
  }
  async function respond(c: CommunityChallenge, accept: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    // Respuesta instantánea: la tarjeta cambia al tocar y vuelve si el servidor lo rechaza.
    const before = rows;
    setRows(previous => previous?.map(row => row.id !== c.id ? row : { ...row, members: row.members.map(m => m.id === account.user.id ? { ...m, status: accept ? 'accepted' : 'declined' } : m) }) ?? previous);
    setNotice(accept ? `Reto aceptado: «${c.title}». Ya está en juego.` : `Invitación rechazada: «${c.title}».`);
    try {
      await respondCommunityChallenge(account.client, c.id, accept);
      notifyCommunityChanged();
    } catch (e) { setRows(before); setNotice(''); setError(communityError(e)); }
    finally { setBusy(false); }
  }
  const userId = account.user.id;
  const myStatus = (c: CommunityChallenge) => c.members.find(m => m.id === userId)?.status;
  const invitations = rows?.filter(c => c.status === 'active' && myStatus(c) === 'pending') ?? [];
  const active = rows?.filter(c => c.status === 'active' && myStatus(c) === 'accepted') ?? [];
  const finished = rows?.filter(c => c.status === 'finished' || myStatus(c) === 'declined') ?? [];
  const unread = notifications.filter(n => !n.read_at).length;
  return <>
    {rows && <RivalRow client={account.client} rows={rows} userId={userId} />}
    <SegmentedControl<View> label="Vistas de retos" value={view} onChange={setView} options={[
      { value: 'active', label: 'En juego' },
      { value: 'notifications', label: unread ? `Avisos (${formatCount(unread)})` : 'Avisos' },
      { value: 'finished', label: 'Historial' },
    ]} />
    {error && <Banner tone="error" action={<button className="btn btn--ghost" onClick={() => void load(true)} disabled={busy}>Reintentar</button>}>{error}</Banner>}
    {notice && <p className="community-notice-line" role="status">{notice}</p>}
    {!rows && !error && <ChallengesSkeleton />}
    {view === 'notifications' ? <section aria-label="Notificaciones de retos" className="community-stack">
      {!notifications.length && <div className="card community-empty"><h2>Al día con la grupeta</h2><p>Aquí aparecerán las invitaciones, respuestas y retos terminados.</p></div>}
      {notifications.map(n => <article key={n.id} className="card community-notice" data-unread={!n.read_at}>
        <div><strong>{n.kind === 'invitation' ? 'Te han invitado a un reto' : n.kind === 'finished' ? 'Reto terminado' : n.kind === 'accepted' ? 'Han aceptado tu reto' : n.kind === 'declined' ? 'Han rechazado una invitación' : n.kind === 'friendship' ? 'Nueva solicitud de amistad' : n.kind === 'friendship_accepted' ? 'Solicitud de amistad aceptada' : 'Novedades en tu reto'}</strong><p>{communityDate(n.created_at)}</p></div>
        {n.challenge_id && <Link className="btn btn--secondary" to={`/retos/comunidad/${n.challenge_id}`} onClick={() => void read(n)}>Ver reto</Link>}
        {!n.challenge_id && n.actor_id && <Link className="btn btn--secondary" to={`/personas/${n.actor_id}`} onClick={() => void read(n)}>Ver ciclista</Link>}
        {!n.read_at && <button className="btn btn--ghost" onClick={() => void read(n)}>Marcar leído</button>}
      </article>)}
    </section> : view === 'active' ? <section className="community-stack" aria-label="Retos en juego">
      {invitations.map(c => <InvitationCard key={c.id} challenge={c} userId={userId} busy={busy} onRespond={accept => void respond(c, accept)} />)}
      {active.map(row => <ChallengeCard key={row.id} challenge={row} account={account} />)}
      {rows && !invitations.length && !active.length && <RetosEmpty account={account} />}
    </section> : <section className="community-stack" aria-label="Historial de retos">
      {rows && !finished.length && <div className="card community-empty"><h2>Cada reto deja huella</h2><p>Los retos terminados y sus ganadores aparecerán aquí.</p></div>}
      {finished.map(row => <ChallengeCard key={row.id} challenge={row} account={account} />)}
    </section>}
    {(view === 'notifications' ? notificationMore : more) && <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => void next()}>Cargar más</button>}
    <div className="community-refresh"><span>Se actualiza cada 30 s mientras estás aquí.</span><button className="btn btn--ghost" disabled={busy} onClick={() => void load(true)}>Actualizar</button></div>
    <p className="community-footnote">Los tracks y tu ubicación se quedan en tu dispositivo. Solo compartes cifras con los participantes al aceptar.</p>
    <Link className="btn btn--ghost" to="/retos/anteriores">Retos anteriores de ruta</Link>
  </>;
}
/** «Te han retado»: se responde en la propia tarjeta, sin abrir el detalle. */
function InvitationCard({ challenge: c, userId, busy, onRespond }: { challenge: CommunityChallenge; userId: string; busy: boolean; onRespond: (accept: boolean) => void }) {
  const from = c.members.find(m => m.id === c.creator_id && m.id !== userId)?.display_name ?? 'Un ciclista';
  return <article className="card community-challenge community-invite" aria-label={`${from} te reta: ${c.title}`}>
    <div className="community-card-top"><span className="chip community-invite-chip">Te reta {from}</span><span className="community-eyebrow">{CHALLENGE_LABELS[c.kind]}</span></div>
    <h2>{c.title}</h2>
    <p>{c.members.length === 2 ? 'Duelo' : `Grupeta · ${c.members.length} ciclistas`} · Hasta {communityDate(c.deadline)}</p>
    <div className="btn-row community-invite-actions">
      <button className="btn btn--primary" disabled={busy} onClick={() => onRespond(true)} aria-label={`Aceptar reto «${c.title}»`}>Aceptar reto</button>
      <button className="btn btn--secondary" disabled={busy} onClick={() => onRespond(false)} aria-label={`Ahora no: «${c.title}»`}>Ahora no</button>
    </div>
    <Link className="community-card-link" to={`/retos/comunidad/${c.id}`}>Ver invitación <span aria-hidden="true">→</span></Link>
  </article>;
}
function ChallengeCard({ challenge: c, account }: { challenge: CommunityChallenge; account: Account }) {
  const userId = account.user.id;
  const mine = c.members.find(m => m.id === userId);
  const rival = c.members.find(m => m.id !== userId);
  const leader = rankedCommunityMembers(c).find(m => (m.score ?? 0) > 0);
  const winner = c.members.filter(m => c.winner_ids.includes(m.id));
  const progress = c.target_value && mine?.score ? Math.min(100, mine.score / c.target_value * 100) : 0;
  return <Link className="card community-challenge" to={`/retos/comunidad/${c.id}`}>
    <div className="community-card-top"><span className="community-eyebrow">{CHALLENGE_LABELS[c.kind]}</span><span className="chip">{c.status === 'finished' ? 'Terminado' : mine?.status === 'pending' ? 'Te han retado' : mine?.status === 'declined' ? 'Rechazado' : 'En marcha'}</span></div>
    {c.status === 'active' && mine?.status === 'accepted' && <p className="community-time">{timeLeftLabel(c.deadline, Date.now())}</p>}
    <p className="community-opponent-line">{c.members.length > 2 ? `Tu grupeta · ${c.members.length} ciclistas` : mine?.status === 'pending' ? `${rival?.display_name ?? 'Un ciclista'} te reta` : rival?.status === 'pending' && c.creator_id === userId ? `Has retado a ${rival.display_name}` : `Tú contra ${rival?.display_name ?? 'otro ciclista'}`}</p>
    <h2>{c.title}</h2><p>{c.members.length === 2 ? 'Duelo' : 'Grupeta'} · {c.members.filter(m => m.status === 'accepted').length}/{c.members.length} participantes · Hasta {communityDate(c.deadline)}</p>
    {c.members.length === 2 && <DuelComparison client={account.client} userId={userId} challenge={c} compact />}
    {c.status === 'finished' ? <strong className="community-card-result" data-result={winner.length === 0 ? 'none' : winner.some(m => m.id === userId) ? 'won' : 'lost'}>{winner.length ? `${winner.length > 1 ? 'Empate: ' : 'Gana '}${winner.map(m => m.id === userId ? 'tú' : m.display_name).join(', ')}` : c.members.filter(m => m.status === 'accepted').length < 2 ? 'Sin ganador: faltó rival' : 'Sin ganador: no hubo registros'}</strong> : c.members.length > 2 && <div className="community-card-result"><strong>{formatCommunityScore(c.kind, mine?.score ?? null)}</strong>{c.target_value && <span> / {formatCommunityScore(c.kind, c.target_value)}</span>}</div>}
    {c.members.length > 2 && c.target_value && c.kind !== 'segment' && <progress aria-label={`Progreso de ${c.title}`} max={100} value={progress} />}
    {leader && c.status !== 'finished' && c.members.length > 2 && <p className="community-leader">En cabeza: {leader.id === userId ? 'tú' : leader.display_name} · {formatCommunityScore(c.kind, leader.score)}</p>}
    <span className="community-card-link">{mine?.status === 'pending' && c.status !== 'finished' ? 'Ver invitación' : 'Ver marcador'} <span aria-hidden="true">→</span></span>
  </Link>;
}
function ChallengesSkeleton() {
  return <div aria-busy="true" className="community-stack">
    <span className="sr-only">Cargando tus retos…</span>
    {[0, 1].map(i => <div className="card community-challenge community-skeleton" key={i} aria-hidden="true">
      <Skeleton width="38%" /><Skeleton variant="title" width="70%" /><Skeleton width="52%" /><Skeleton variant="box" height={84} />
    </div>)}
  </div>;
}
