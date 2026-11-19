import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { notifyCommunityChanged } from '../../social/communityBadge';
import { listCommunityChallenges } from '../../social/communityChallenges';
import { loadPublicProfile } from '../../social/publicProfile';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { ProfileHero } from '../profile/ProfileHero';
import { ProfileSkeleton } from '../profile/ProfileSkeleton';
import { JournalFeed } from '../profile/JournalFeed';
import { CommunitySafety } from '../profile/CommunitySafety';
import { FriendshipActions } from '../profile/FriendshipActions';
import { ProfileStats } from '../profile/ProfileStats';
import { WriteButton } from '../chat/WriteButton';
import '../styles/profile.css';
import '../styles/social.css';

type Data = Awaited<ReturnType<typeof loadPublicProfile>>;
const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';

export function Persona() {
  const account = useAccount();
  const { id = '' } = useParams();
  if (account?.user.id === id) return <Navigate to="/perfil" replace />;
  return <Page title="Perfil del ciclista" back="/ciclistas" className="page--profile">
    {account && !account.user.is_anonymous ? <PersonaView key={id} account={account} id={id} /> : <p>Necesitas una cuenta registrada para ver este perfil.</p>}
  </Page>;
}

function PersonaView({ account, id }: { account: Account; id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [together, setTogether] = useState<{ total: number; mine: number; theirs: number } | null>(null);
  const load = useCallback(() => loadPublicProfile(account.client, id), [account.client, id]);
  // Retos compartidos: salen de tu propia lista; no hay forma de leer los amigos ni los retos ajenos.
  useEffect(() => {
    let live = true;
    listCommunityChallenges(account.client, 0).then(rows => {
      const shared = rows.filter(c => c.members.some(m => m.id === id && m.status === 'accepted'));
      if (live) setTogether({ total: shared.length, mine: shared.filter(c => c.winner_ids.includes(account.user.id)).length, theirs: shared.filter(c => c.winner_ids.includes(id)).length });
    }, () => {});
    return () => { live = false; };
  }, [account.client, account.user.id, id]);
  useEffect(() => {
    let live = true;
    setError('');
    load().then(value => { if (live) setData(value); }, e => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [load, attempt]);

  async function act(run: () => Promise<void>, success: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      await run();
      // «Gente» vuelve a contar las solicitudes de amistad.
      notifyCommunityChanged();
      // Si falla el refresco, retirar las acciones hasta volver a conocer la relación.
      setData(null);
      setData(await load());
      setNotice(success);
      return true;
    } catch (e) { setError(message(e)); return false; }
    finally { setBusy(false); }
  }
  const blocked = () => { setData({ profile: null, friendship: null }); setNotice('Ciclista bloqueado. Puedes desbloquearlo desde Ciclistas.'); };

  const f = data?.friendship;
  return <>
    {error && <Banner tone="error" action={<button className="btn btn--ghost" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Reintentar</button>}>{error}</Banner>}
    {!data ? !error && <ProfileSkeleton label="Cargando el perfil…" /> : !data.profile ? <section className="card reto-card">
      <h2>Perfil no disponible</h2><p>Este ciclista ya no está disponible.</p><Link className="btn btn--secondary" to="/ciclistas">Buscar ciclistas</Link>
    </section> : <>
      <ProfileHero client={account.client} profile={data.profile} stats={together && <ProfileStats label={`Cifras de ${data.profile.display_name}`} items={[
        { value: together.total, label: 'Retos juntos', name: `${together.total} ${together.total === 1 ? 'reto juntos' : 'retos juntos'}`, to: '/retos?vista=historial' },
        { value: together.mine, label: 'Tus victorias', name: `${together.mine} tuyas` },
        { value: together.theirs, label: 'Sus victorias', name: `${together.theirs} suyas` },
      ]} />}>
        {f?.profile.locality && <p className="help">{f.profile.locality}</p>}
        <FriendshipActions client={account.client} targetId={id} name={data.profile.display_name} friendship={f ?? null} busy={busy} act={act} onBlocked={blocked} />
        {f?.status === 'accepted' && <div className="btn-row"><WriteButton client={account.client} userId={id} name={data.profile.display_name} icon /></div>}
      </ProfileHero>
      <section className="profile-public-journal" aria-label="Cuaderno del ciclista"><div className="profile-journal-heading"><span className="profile-eyebrow">Kilómetros con historia</span><h2>Su cuaderno de ruta</h2><p>Las historias que ha elegido compartir.</p></div><JournalFeed client={account.client} userId={account.user.id} targetId={data.profile.id} /></section>
      <CommunitySafety client={account.client} targetId={id} name={data.profile.display_name} onBlocked={blocked} />
    </>}
    {notice && <p role="status">{notice}</p>}
  </>;
}
