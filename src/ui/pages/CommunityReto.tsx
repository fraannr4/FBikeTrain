import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { CHALLENGE_LABELS, formatCommunityScore, getCommunityChallenge, getRouteChallengeGeometry, lowerWins, rankedCommunityMembers, respondCommunityChallenge, type CommunityChallenge } from '../../social/communityChallenges';
import { routePointsToGpx, type RoutePoint } from '../../routes/library';
import { formatKm } from '../format';
import { Download, Info } from '../icons';
import { RideMap } from '../components/RideMap';
import { downloadText } from '../routes/sendGpx';
import { syncCommunityScores } from '../../social/challengeScoring';
import { timeLeftLabel } from '../../social/challengeStatus';
import { Banner } from '../components/Banner';
import { Disclosure } from '../components/Disclosure';
import { Page } from '../components/Page';
import { Skeleton } from '../components/Skeleton';
import { LikeFor } from '../likes/LikeButton';
import { useLikes } from '../likes/useLikes';
import { DuelComparison } from '../retos/DuelComparison';
import { communityDate, communityError } from './CommunityRetos';
import '../styles/community-challenges.css';

export function CommunityReto() {
  const account = useAccount();
  const { id = '' } = useParams();
  return <Page title="El reto" back="/retos" variant="narrow" className="page--community">{account && !account.user.is_anonymous ? <ChallengeDetail key={id} account={account} id={id} /> : <p>Inicia sesión con una cuenta registrada para ver el reto.</p>}</Page>;
}
function ChallengeDetail({ account, id }: { account: Account; id: string }) {
  const [row, setRow] = useState<CommunityChallenge | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loading = useRef(false);
  const [route, setRoute] = useState<{ points: RoutePoint[]; distanceM: number } | null>(null);
  const isRoute = row?.kind === 'route';
  useEffect(() => {
    if (!isRoute) return;
    let live = true;
    getRouteChallengeGeometry(account.client, id).then(g => { if (live) setRoute(g); }, e => { if (live) setError(communityError(e)); });
    return () => { live = false; };
  }, [account.client, id, isRoute]);
  const load = useCallback(async (sync = false) => {
    if (loading.current) return;
    loading.current = true; setBusy(true);
    try {
      if (sync) await syncCommunityScores(account.client, account.user.id);
      setRow(await getCommunityChallenge(account.client, id)); setLoaded(true); setError('');
    } catch (e) { setError(communityError(e)); }
    finally { loading.current = false; setBusy(false); }
  }, [account.client, account.user.id, id]);
  useEffect(() => {
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  async function respond(accept: boolean) {
    if (loading.current) return;
    loading.current = true;
    setBusy(true); setError('');
    try {
      await respondCommunityChallenge(account.client, id, accept);
      loading.current = false;
      await load(accept);
    }
    catch (e) { setError(communityError(e)); }
    finally { loading.current = false; setBusy(false); }
  }
  async function useThisDevice() {
    if (loading.current) return;
    loading.current = true;
    setBusy(true); setError('');
    try {
      await syncCommunityScores(account.client, account.user.id, { challengeId: id, replaceRemote: true });
      loading.current = false;
      await load(false);
    } catch (e) { setError(communityError(e)); }
    finally { loading.current = false; setBusy(false); }
  }
  const likes = useLikes(account.client, account.user.id, 'challenge', row ? [row.id] : []);
  const mine = row?.members.find(m => m.id === account.user.id);
  const rival = row?.members.find(m => m.id !== account.user.id);
  const duel = row?.members.length === 2;
  const ranked = row ? rankedCommunityMembers(row) : [];
  const winners = row?.members.filter(m => row.winner_ids.includes(m.id)) ?? [];
  return <>
    {error && <Banner tone="error" action={<button className="btn btn--ghost" disabled={busy} onClick={() => void load(true)}>Reintentar</button>}>{error}</Banner>}
    {!loaded && !error && <div aria-busy="true" className="card community-detail-hero" role="status"><span className="sr-only">Preparando el marcador…</span><div aria-hidden="true" className="community-skeleton"><Skeleton width="30%" /><Skeleton variant="title" width="64%" /><Skeleton width="48%" /><Skeleton variant="box" height={110} /></div></div>}
    {loaded && !row && <section className="card community-empty"><h2>Reto no disponible</h2><p>Este reto ya no está disponible para tu cuenta.</p><Link className="btn btn--secondary" to="/retos">Volver a Retos</Link></section>}
    {row && <>
      <section className={`card community-detail-hero${duel ? ' community-detail-hero--duel' : ''}`}>
        <div className="community-card-top"><span className="community-eyebrow">{CHALLENGE_LABELS[row.kind]}</span><span className="chip">{row.members.length === 2 ? 'Duelo' : 'Grupo'} · {row.members.length}</span></div>
        {duel && <p className="community-duel-heading">Tú contra {rival?.display_name}</p>}
        <h2>{row.title}</h2>
        <p>{row.status === 'finished' ? 'Terminó' : 'Hasta'} {communityDate(row.deadline)}{row.status === 'active' && <> · <strong className="community-time-left">{timeLeftLabel(row.deadline, Date.now())}</strong></>}</p>
        <LikeFor likes={likes} id={row.id} />
        {duel && <DuelComparison client={account.client} userId={account.user.id} challenge={row} />}
        {row.target_value && (duel ? <p className="community-duel-reference">Referencia del duelo: {formatCommunityScore(row.kind, row.target_value)}</p> : <div className="community-goal"><small>LA META</small><strong>{formatCommunityScore(row.kind, row.target_value)}</strong></div>)}
        {isRoute && <div className="community-route">
          {route ? <RideMap points={route.points} label="Mapa de la ruta del reto" className="community-route-map" /> : <p role="status">Cargando la ruta…</p>}
          {row.route_distance_m && <p className="community-route-figure"><strong>{formatKm(row.route_distance_m, 1)}</strong> de ruta · gana el menor tiempo en movimiento</p>}
          <button type="button" className="btn btn--secondary btn--block" disabled={!route} onClick={() => route && downloadText(routePointsToGpx(row.title, route.points), 'fbiketrain-reto-ruta.gpx')}><Download className="ic" aria-hidden="true" />Descargar GPX</button>
        </div>}
        {(row.kind === 'speed' || row.kind === 'segment') && row.distance_m && <p>Distancia de referencia: {(row.distance_m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km</p>}
        {row.status === 'finished' ? <div className="community-winner" role="status"><span className="community-eyebrow">RETO CERRADO</span><h3>{winners.length > 1 ? 'Victoria compartida' : winners.length === 1 && winners[0].id === account.user.id ? '¡Has ganado!' : winners.length === 1 ? `Gana ${winners[0].display_name}` : 'Sin ganador'}</h3>{winners.length > 1 && <p>{winners.map(w => w.id === account.user.id ? 'Tú' : w.display_name).join(' · ')}</p>}<p>{winners.length ? 'El marcador final conserva los registros recibidos antes del cierre.' : ranked.length < 2 ? 'No llegó a aceptar ningún rival.' : 'No hubo registros válidos antes del cierre.'}</p></div> : mine?.status === 'pending' ? <div className="community-invitation"><h3>{duel ? `${rival?.display_name} te reta` : '¿Te apuntas?'}</h3><p>Al aceptar compartirás tu cifra con los participantes. Contarán tus salidas desde ese momento hasta el cierre.</p><div className="btn-row"><button className="btn btn--primary" disabled={busy} onClick={() => void respond(true)}>Aceptar reto</button><button className="btn btn--secondary" disabled={busy} onClick={() => void respond(false)}>Rechazar</button></div></div> : mine?.status === 'declined' ? <p>Has rechazado este reto.</p> : <div className={`community-my-score${duel ? ' community-my-score--duel' : ''}`}>{!duel && <><small>TU MARCADOR</small><strong>{formatCommunityScore(row.kind, mine?.score ?? null)}</strong></>}{mine?.updated_at ? <p>Último envío: {communityDate(mine.updated_at)}</p> : <p>{isRoute ? 'Recorre la ruta e importa la salida: se detecta sola en este dispositivo.' : 'Importa una salida durante el plazo para estrenar el marcador.'}</p>}</div>}
        {row.status === 'active' && mine?.status === 'accepted' && !isRoute && <details className="community-device-option">
          <summary>Cambiar de dispositivo</summary>
          <p className="help">Reemplaza tu marcador por las salidas guardadas aquí, incluso si está vacío. Úsalo solo si has cambiado de dispositivo.</p>
          <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => void useThisDevice()}>Usar las salidas de este dispositivo</button>
        </details>}
      </section>
      <section className="community-stack" aria-label="Marcador del reto">
        <div className="community-score-heading"><h2>{row.status === 'finished' ? 'Clasificación final' : 'Marcador en marcha'}</h2><button className="btn btn--secondary" disabled={busy} onClick={() => void load(true)}>Actualizar</button></div>
        <p className="help">{row.status === 'finished' ? 'El plazo ha terminado.' : 'Se consulta cada 30 s. Cada ciclista envía sus cifras al abrir la app o importar.'} {lowerWins(row.kind) ? 'Gana el menor tiempo.' : 'Gana la mayor cifra.'} Los empates comparten victoria.</p>
        <ol className="community-scoreboard">{ranked.map(m => {
          const previous = ranked.findIndex(p => p.score === m.score);
          const place = m.score && m.score > 0 ? previous + 1 : null;
          const progress = row.target_value && m.score ? Math.min(100, m.score / row.target_value * 100) : 0;
          return <li className="card community-score-row" key={m.id} data-mine={m.id === account.user.id} data-winner={row.winner_ids.includes(m.id)}>
            <span className="community-place" aria-label={place ? `Posición ${place}` : 'Sin registro'}>{place ?? '—'}</span>
            <div className="community-score-person"><Link to={m.id === account.user.id ? '/perfil' : `/personas/${m.id}`}>{m.display_name}{m.id === account.user.id ? ' · Tú' : ''}</Link><small>{m.updated_at ? `Actualizado ${communityDate(m.updated_at)}` : 'Sin salidas registradas'}{row.winner_ids.includes(m.id) ? ' · Ganador' : ''}</small>{row.target_value && row.kind !== 'segment' && <progress aria-label={`Progreso de ${m.display_name}`} max={100} value={progress} />}</div>
            <strong>{formatCommunityScore(row.kind, m.score)}</strong>
          </li>;
        })}</ol>
        {row.members.some(m => m.status !== 'accepted') && <div className="card community-pending"><h3>La invitación</h3><ul>{row.members.filter(m => m.status !== 'accepted').map(m => <li key={m.id}><span>{m.display_name}</span><span>{m.status === 'declined' ? 'Rechazado' : row.status === 'finished' ? 'Sin respuesta' : 'Pendiente'}</span></li>)}</ul></div>}
      </section>
      <Disclosure title="Así cuenta tu esfuerzo" icon={Info}><div className="community-rules"><p>Solo cuentan salidas completas desde tu aceptación hasta el cierre e importadas antes del plazo. Los datos de ejemplo quedan fuera. Actualiza desde el dispositivo donde guardas tus salidas.</p><p>{isRoute ? 'Cuenta una salida que recorra al menos el 90 % de la ruta en su sentido, con una media de 60 km/h como mucho. El tiempo es en movimiento, entre el paso más cercano al inicio y el más cercano al final. Se calcula en tu dispositivo y se guarda tu mejor tiempo; de la salida solo se comparten el tiempo, la cobertura, la fecha y su id local, nunca el track.' : row.kind === 'segment' ? 'Se comparan subidas detectadas equivalentes mediante una firma. El reconocimiento es aproximado; no se comparte el track.' : row.kind === 'speed' ? 'La mejor media usa un tramo continuo de la distancia elegida y tiempo transcurrido, incluidas las paradas. Los tracks sin información suficiente no puntúan.' : 'El marcador suma las cifras de las salidas importadas dentro de tu ventana de participación.'}</p><p>Compartimos solo tu cifra y su actualización. Los archivos importados no tienen una verificación independiente: estos retos se basan en la confianza.</p></div></Disclosure>
    </>}
  </>;
}
