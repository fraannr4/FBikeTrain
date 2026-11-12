import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listReferenceRoutes, type ReferenceRoute } from '../../routes/library';
import { challengePoints, createChallenge } from '../../social/challenges';
import { listFriends, type ProfileCard } from '../../social/friends';
import { formatKm, formatMeters } from '../format';
import { Route as RouteIcon, UserPlus } from '../icons';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import '../styles/social.css';

type Data = { friends: ProfileCard[]; routes: ReferenceRoute[] };
const message = (e: unknown) => (e instanceof Error ? e.message : 'No se ha podido completar.');

/** Nuevo reto: un amigo aceptado y una ruta de la biblioteca. `?amigo=` y `?ruta=` los preseleccionan. */
export function NuevoReto() {
  const account = useAccount();
  return (
    <Page title="Nuevo reto" back="/retos" variant="narrow" className="page--reto" lead="Elige a un amigo y una ruta de tu biblioteca. Tendréis 30 días para hacerla.">
      {account ? <NuevoRetoForm account={account} /> : <p>Inicia sesión para retar a tus amigos.</p>}
    </Page>
  );
}

function NuevoRetoForm({ account }: { account: Account }) {
  const { client } = account;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState('');
  const [friendId, setFriendId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [rows, routes] = await Promise.all([listFriends(client), listReferenceRoutes()]);
      const friends = rows.filter((f) => f.status === 'accepted').map((f) => f.profile);
      setData({ friends, routes });
      const amigo = params.get('amigo');
      const ruta = params.get('ruta');
      setFriendId(friends.find((f) => f.id === amigo)?.id ?? friends[0]?.id ?? '');
      setRouteId(routes.find((r) => r.id === ruta)?.id ?? routes[0]?.id ?? '');
    } catch (e) {
      setLoadError(message(e));
    }
  }, [client, params]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const route = data?.routes.find((r) => r.id === routeId);
    if (!route || !friendId) return;
    setError('');
    setSending(true);
    try {
      const id = await createChallenge(client, {
        challengedId: friendId,
        routeName: route.name,
        points: challengePoints(route.points),
        distanceM: route.summary.distanceM,
        elevGainM: route.summary.elevGainM,
      });
      navigate(`/retos/${id}`);
    } catch (err) {
      setError(message(err));
      setSending(false);
    }
  }

  if (loadError)
    return (
      <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => void load()}>Reintentar</button>}>
        {loadError}
      </Banner>
    );
  if (!data) return <p role="status">Cargando tus amigos y tus rutas…</p>;
  if (!data.friends.length)
    return (
      <div className="card">
        <StateView
          icon={UserPlus}
          title="Necesitas un amigo aceptado para retarle"
          text="Busca a alguien en Amigos. Cuando acepte tu solicitud, podrás retarle."
          action={<Link className="btn btn--primary" to="/amigos">Ir a Amigos</Link>}
        />
      </div>
    );
  if (!data.routes.length)
    return (
      <div className="card">
        <StateView
          icon={RouteIcon}
          title="Guarda antes una ruta en tu biblioteca"
          text="El reto se hace sobre una ruta tuya: importada, generada o empalmada."
          action={<Link className="btn btn--primary" to="/rutas/biblioteca">Abrir la biblioteca</Link>}
        />
      </div>
    );

  const route = data.routes.find((r) => r.id === routeId);
  return (
    <form className="card reto-form" onSubmit={send}>
      <label className="field">
        <span className="field-label">Amigo</span>
        <select className="input" value={friendId} onChange={(e) => setFriendId(e.target.value)}>
          {data.friends.map((f) => (
            <option key={f.id} value={f.id}>
              {f.display_name} (@{f.username})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Ruta</span>
        <select className="input" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
          {data.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {route ? (
        <dl className="reto-figures">
          <div>
            <dt>Distancia</dt>
            <dd>{formatKm(route.summary.distanceM, 1)}</dd>
          </div>
          <div>
            <dt>Desnivel</dt>
            <dd>{route.summary.elevGainM === null ? 'Sin altitud' : formatMeters(route.summary.elevGainM)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="help">Tu amigo verá la ruta y podrá descargar el GPX. De las salidas solo se comparten las cifras de la que elija cada uno.</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <button type="submit" className="btn btn--primary btn--block" disabled={sending || !route}>
        Enviar reto
      </button>
    </form>
  );
}
