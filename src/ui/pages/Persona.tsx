import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { acceptFriendship, removeFriendship, requestFriendship } from '../../social/friends';
import { loadPublicProfile } from '../../social/publicProfile';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import '../styles/social.css';

type Data = Awaited<ReturnType<typeof loadPublicProfile>>;
const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';

export function Persona() {
  const account = useAccount();
  const { id = '' } = useParams();
  if (account?.user.id === id) return <Navigate to="/perfil" replace />;
  return <Page title="Perfil del ciclista" back="/amigos" variant="narrow">
    {account ? <PersonaView key={id} account={account} id={id} /> : <p>Inicia sesión para ver este perfil.</p>}
  </Page>;
}

function PersonaView({ account, id }: { account: Account; id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => loadPublicProfile(account.client, id), [account.client, id]);
  useEffect(() => {
    let live = true;
    setError('');
    load().then(value => { if (live) setData(value); }, e => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, [load, attempt]);

  async function act(run: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await run();
      // Si falla el refresco, retirar las acciones hasta volver a conocer la relación.
      setData(null);
      setData(await load());
      setNotice(success);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  const f = data?.friendship;
  return <>
    {error && <Banner tone="error" action={<button className="btn btn--ghost" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Reintentar</button>}>{error}</Banner>}
    {!data ? !error && <p role="status">Cargando el perfil…</p> : !data.profile ? <section className="card reto-card">
      <h2>Perfil no disponible</h2><p>Este ciclista ya no está disponible.</p><Link className="btn btn--secondary" to="/amigos">Buscar ciclistas</Link>
    </section> : <>
      <section className="card reto-card" aria-label="Identidad del ciclista">
        <h2>{data.profile.display_name}</h2><p className="person-meta">@{data.profile.username}</p>
        {f?.profile.locality && <p className="help">{f.profile.locality}</p>}
        {f?.status === 'accepted' ? <>
          <p className="person-state" data-tone="good">Sois amigos</p>
          <Link className="btn btn--primary btn--block" to={`/retos/nuevo?amigo=${encodeURIComponent(id)}`} aria-label={`Retar a ${data.profile.display_name}`}>Retar a este amigo</Link>
          <button className="btn btn--secondary" disabled={busy} onClick={() => void act(() => removeFriendship(account.client, f.friendship_id), 'Amistad retirada.')}>Quitar de amigos</button>
        </> : f?.direction === 'received' ? <>
          <p>Te ha enviado una solicitud de amistad.</p>
          <div className="btn-row"><button className="btn btn--primary" disabled={busy} onClick={() => void act(() => acceptFriendship(account.client, f.friendship_id), 'Solicitud aceptada.')}>Aceptar solicitud</button>
          <button className="btn btn--secondary" disabled={busy} onClick={() => void act(() => removeFriendship(account.client, f.friendship_id), 'Solicitud rechazada.')}>Rechazar solicitud</button></div>
        </> : f ? <>
          <p>Solicitud de amistad pendiente</p>
          <button className="btn btn--secondary" disabled={busy} onClick={() => void act(() => removeFriendship(account.client, f.friendship_id), 'Solicitud cancelada.')}>Cancelar solicitud</button>
        </> : <button className="btn btn--primary" disabled={busy} onClick={() => void act(() => requestFriendship(account.client, id), 'Solicitud de amistad enviada.')}>Solicitar amistad</button>}
      </section>
      <p className="help">Los tracks y mapas de las salidas son privados. En los retos solo se comparte la ruta elegida y las cifras del resultado con el otro participante.</p>
    </>}
    {notice && <p role="status">{notice}</p>}
  </>;
}
