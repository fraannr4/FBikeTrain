import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listCommunityChallenges, listCommunityNotifications, readCommunityNotification, CHALLENGE_LABELS, formatCommunityScore, rankedCommunityMembers, type CommunityChallenge, type CommunityNotification } from '../../social/communityChallenges';
import { syncCommunityScores } from '../../social/challengeScoring';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { DuelComparison } from '../retos/DuelComparison';
import '../styles/community-challenges.css';

export const communityError = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';
export const communityDate = (s: string) => new Date(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function CommunityRetos() {
  const account = useAccount();
  return <Page title="Retos" back="/perfil" variant="narrow" className="page--community" lead="Elige a otro ciclista. Enviad la invitación y medid vuestro esfuerzo.">
    {account && !account.user.is_anonymous ? <CommunityRetosList account={account} /> : <p>Inicia sesión con una cuenta registrada para participar.</p>}
  </Page>;
}
function CommunityRetosList({ account }: { account: Account }) {
  const [rows, setRows] = useState<CommunityChallenge[] | null>(null);
  const [notifications, setNotifications] = useState<CommunityNotification[]>([]);
  const [view, setView] = useState<'active' | 'finished' | 'notifications'>('active');
  const [error, setError] = useState('');
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
  const visible = rows?.filter(row => row.status === view) ?? [];
  const unread = notifications.filter(n => !n.read_at).length;
  return <>
    <div className="community-rival-entry"><div><span className="community-eyebrow">DE CICLISTA A CICLISTA</span><p>¿A quién retas hoy?</p></div><Link className="btn btn--primary" to="/ciclistas">Elegir rival <span aria-hidden="true">↗</span></Link></div>
    <div className="community-tabs" aria-label="Vistas de retos">
      <button className="btn" aria-pressed={view === 'active'} onClick={() => setView('active')}>En marcha</button>
      <button className="btn" aria-pressed={view === 'finished'} onClick={() => setView('finished')}>Historial</button>
      <button className="btn" aria-pressed={view === 'notifications'} onClick={() => setView('notifications')}>Avisos{unread ? ` (${unread})` : ''}</button>
    </div>
    <div className="community-refresh"><span>Se actualiza cada 30 s mientras estás aquí.</span><button className="btn btn--ghost" disabled={busy} onClick={() => void load(true)}>Actualizar</button></div>
    {error && <Banner tone="error" action={<button className="btn btn--ghost" onClick={() => void load(true)} disabled={busy}>Reintentar</button>}>{error}</Banner>}
    {!rows && !error && <p role="status">Cargando tus retos…</p>}
    {view === 'notifications' ? <section aria-label="Notificaciones de retos" className="community-stack">
      {!notifications.length && <div className="card community-empty"><h2>Al día con la grupeta</h2><p>Aquí aparecerán las invitaciones, respuestas y retos terminados.</p></div>}
      {notifications.map(n => <article key={n.id} className="card community-notice" data-unread={!n.read_at}>
        <div><strong>{n.kind === 'invitation' ? 'Te han invitado a un reto' : n.kind === 'finished' ? 'Reto terminado' : n.kind === 'accepted' ? 'Han aceptado tu reto' : n.kind === 'declined' ? 'Han rechazado una invitación' : n.kind === 'friendship' ? 'Nueva solicitud de amistad' : n.kind === 'friendship_accepted' ? 'Solicitud de amistad aceptada' : 'Novedades en tu reto'}</strong><p>{communityDate(n.created_at)}</p></div>
        {n.challenge_id && <Link className="btn btn--secondary" to={`/retos/comunidad/${n.challenge_id}`} onClick={() => void read(n)}>Ver reto</Link>}
        {!n.challenge_id && n.actor_id && <Link className="btn btn--secondary" to={`/personas/${n.actor_id}`} onClick={() => void read(n)}>Ver ciclista</Link>}
        {!n.read_at && <button className="btn btn--ghost" onClick={() => void read(n)}>Marcar leído</button>}
      </article>)}
    </section> : <section className="community-stack" aria-label={view === 'active' ? 'Retos en marcha' : 'Historial de retos'}>
      {rows && !visible.length && <div className="card community-empty"><h2>{view === 'active' ? 'Tu próximo rival está en Ciclistas' : 'Cada reto deja huella'}</h2><p>{view === 'active' ? 'Elige a alguien y envíale una invitación. Aquí verás vuestros marcadores.' : 'Los retos terminados y sus ganadores aparecerán aquí.'}</p>{view === 'active' && <Link className="btn btn--secondary" to="/ciclistas">Buscar un rival</Link>}</div>}
      {visible.map(row => <ChallengeCard key={row.id} challenge={row} account={account} />)}
    </section>}
    {(view === 'notifications' ? notificationMore : more) && <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => void next()}>Cargar más</button>}
    <p className="community-footnote">Los tracks y tu ubicación se quedan en tu dispositivo. Solo compartes cifras con los participantes al aceptar.</p>
    <Link className="btn btn--ghost" to="/retos/anteriores">Retos anteriores de ruta</Link>
  </>;
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
    <p className="community-opponent-line">{c.members.length > 2 ? `Tu grupeta · ${c.members.length} ciclistas` : mine?.status === 'pending' ? `${rival?.display_name ?? 'Un ciclista'} te reta` : rival?.status === 'pending' && c.creator_id === userId ? `Has retado a ${rival.display_name}` : `Tú contra ${rival?.display_name ?? 'otro ciclista'}`}</p>
    <h2>{c.title}</h2><p>{c.members.length === 2 ? 'Duelo' : 'Grupeta'} · {c.members.filter(m => m.status === 'accepted').length}/{c.members.length} participantes · Hasta {communityDate(c.deadline)}</p>
    {c.members.length === 2 && <DuelComparison client={account.client} userId={userId} challenge={c} compact />}
    {c.status === 'finished' ? <strong className="community-card-result">{winner.length ? `${winner.length > 1 ? 'Empate: ' : 'Gana '}${winner.map(m => m.id === userId ? 'tú' : m.display_name).join(', ')}` : c.members.filter(m => m.status === 'accepted').length < 2 ? 'Sin ganador: faltó rival' : 'Sin ganador: no hubo registros'}</strong> : c.members.length > 2 && <div className="community-card-result"><strong>{formatCommunityScore(c.kind, mine?.score ?? null)}</strong>{c.target_value && <span> / {formatCommunityScore(c.kind, c.target_value)}</span>}</div>}
    {c.members.length > 2 && c.target_value && c.kind !== 'segment' && <progress aria-label={`Progreso de ${c.title}`} max={100} value={progress} />}
    {leader && c.status !== 'finished' && <p className="community-leader">En cabeza: {leader.id === userId ? 'tú' : leader.display_name} · {formatCommunityScore(c.kind, leader.score)}</p>}
    <span className="community-card-link">{mine?.status === 'pending' && c.status !== 'finished' ? 'Ver invitación' : 'Ver marcador'} <span aria-hidden="true">→</span></span>
  </Link>;
}
