import { useCallback, useEffect, useMemo, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { startOfDay } from 'date-fns';
import { Link, useParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listActivities } from '../../db/repo';
import type { StoredActivity } from '../../domain/types';
import { TZ } from '../../metrics/aggregate';
import { routePointsToGpx, type RoutePoint } from '../../routes/library';
import { compare, resultFromActivity, shortRideWarning } from '../../social/challengeCompare';
import { getChallenge, respondChallenge, submitChallengeResult, type Challenge, type ChallengeResult } from '../../social/challenges';
import { formatClock, formatKm, formatMeters, formatSpeed } from '../format';
import { Download, TriangleAlert } from '../icons';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { RideMap } from '../components/RideMap';
import { Sheet } from '../components/Sheet';
import { downloadText } from '../routes/sendGpx';
import { formatDay, isOpen, rivalLine, STATUS_LABEL } from '../retos/retoText';
import '../styles/social.css';

const message = (e: unknown) => (e instanceof Error ? e.message : 'No se ha podido completar.');

/** Detalle de un reto: la ruta, la respuesta, la salida elegida a mano y la comparativa. */
export function Reto() {
  const account = useAccount();
  const { id } = useParams();
  return (
    <Page title="Reto" back="/retos" variant="narrow" className="page--reto">
      {account ? <RetoView key={id} account={account} /> : <p>Inicia sesión para ver tus retos.</p>}
    </Page>
  );
}

function RetoView({ account }: { account: Account }) {
  const { client } = account;
  const { id = '' } = useParams();
  /** `undefined` mientras carga; `null` si el reto no está entre los míos. */
  const [challenge, setChallenge] = useState<Challenge | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState('');

  const load = useCallback(async () => {
    try {
      setChallenge(await getChallenge(client, id, account.user.id));
      setLoadError('');
    } catch (e) {
      setLoadError(message(e));
    }
  }, [client, id, account.user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const points = useMemo<RoutePoint[]>(
    () => (challenge?.points ?? []).map(([lat, lng, ele]) => (ele === undefined ? { lat, lng } : { lat, lng, ele })),
    [challenge?.points],
  );

  async function respond(accept: boolean) {
    if (!challenge) return;
    setBusy(true);
    setError('');
    try {
      await respondChallenge(client, challenge.id, accept);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(ride: StoredActivity) {
    if (!challenge) return;
    setBusy(true);
    setPickError('');
    try {
      await submitChallengeResult(client, challenge.id, resultFromActivity(ride));
      setPicking(false);
      await load();
    } catch (e) {
      setPickError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => void load()}>Reintentar</button>}>
        {loadError}
      </Banner>
    );
  if (challenge === undefined) return <p role="status">Cargando el reto…</p>;
  if (challenge === null)
    return (
      <div className="card reto-card">
        <p>Ese reto ya no está disponible.</p>
        <Link className="btn btn--secondary" to="/retos">Ver tus retos</Link>
      </div>
    );

  const c = challenge;
  const rival = c.rival.display_name;
  return (
    <>
      <section className="card reto-card" aria-labelledby="reto-ruta">
        <div className="reto-title">
          <h2 id="reto-ruta">{c.routeName}</h2>
          <span className="chip reto-status" data-status={c.status}>
            {STATUS_LABEL[c.status]}
          </span>
        </div>
        <p className="person-meta">
          {rivalLine(c)}
          {isOpen(c) ? `. Plazo: ${formatDay(c.deadline)}` : ''}
        </p>
        <dl className="reto-figures">
          <div>
            <dt>Distancia</dt>
            <dd>{formatKm(c.distanceM, 1)}</dd>
          </div>
          <div>
            <dt>Desnivel</dt>
            <dd>{c.elevGainM === null ? 'Sin altitud' : formatMeters(c.elevGainM)}</dd>
          </div>
        </dl>
        <RideMap points={points} label="Mapa de la ruta del reto" className="reto-map" />
        <button type="button" className="btn btn--secondary btn--block" onClick={() => downloadText(routePointsToGpx(c.routeName, points), 'fbiketrain-reto.gpx')}>
          <Download className="ic" aria-hidden="true" />
          Descargar GPX
        </button>
      </section>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {c.status === 'pending' && !c.iAmChallenger ? (
        <section className="card reto-card" aria-label="Responder al reto">
          <p>
            {rival} te reta a hacer esta ruta antes del {formatDay(c.deadline)}.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void respond(true)}>
              Aceptar
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void respond(false)}>
              Rechazar
            </button>
          </div>
        </section>
      ) : null}
      {c.status === 'pending' && c.iAmChallenger ? <p className="help">Esperando a que {rival} acepte el reto.</p> : null}
      {c.status === 'declined' ? <p className="help">{c.iAmChallenger ? `${rival} ha rechazado el reto.` : 'Rechazaste este reto.'}</p> : null}
      {c.status === 'expired' ? <p className="help">Pasaron 30 días sin terminarlo. El reto ya no admite resultados.</p> : null}

      {c.status === 'accepted' ? (
        <section className="card reto-card" aria-labelledby="reto-tuyo">
          <h2 id="reto-tuyo">Tu resultado</h2>
          {c.mine ? <ResultFigures result={c.mine} /> : <p>Haz la ruta, importa la salida y elígela aquí.</p>}
          <button type="button" className={c.mine ? 'btn btn--secondary btn--block' : 'btn btn--primary btn--block'} onClick={() => { setPickError(''); setPicking(true); }}>
            {c.mine ? 'Cambiar de salida' : 'Usar una salida'}
          </button>
          <p className="help">{c.theirs ? `${rival} ya ha elegido su salida.` : `${rival} todavía no ha elegido su salida.`}</p>
        </section>
      ) : null}

      {c.status === 'finished' && c.mine && c.theirs ? <Comparison mine={c.mine} theirs={c.theirs} rival={rival} /> : null}

      <PickRide open={picking} challenge={c} busy={busy} error={pickError} onClose={() => setPicking(false)} onPick={(ride) => void pick(ride)} />
    </>
  );
}

function ResultFigures({ result }: { result: ChallengeResult }) {
  return (
    <dl className="reto-figures">
      <div>
        <dt>Tiempo</dt>
        <dd>{formatClock(result.moving_time_s)}</dd>
      </div>
      <div>
        <dt>Velocidad</dt>
        <dd>{formatSpeed(result.avg_speed_ms)}</dd>
      </div>
      <div>
        <dt>Distancia</dt>
        <dd>{formatKm(result.distance_m, 1)}</dd>
      </div>
      <div>
        <dt>Fecha</dt>
        <dd>{formatDay(`${result.activity_date}T12:00:00Z`)}</dd>
      </div>
    </dl>
  );
}

function Comparison({ mine, theirs, rival }: { mine: ChallengeResult; theirs: ChallengeResult; rival: string }) {
  const { winner, rows } = compare(mine, theirs);
  const headline = winner === 'mine' ? 'Has ganado' : winner === 'theirs' ? `Ha ganado ${rival}` : 'Empate';
  const cell = (value: string, better: boolean) =>
    better ? (
      <>
        <b>{value}</b>
        <span className="sr-only"> (mejor)</span>
      </>
    ) : (
      value
    );
  return (
    <section className="card reto-card" aria-labelledby="reto-ganador">
      <h2 id="reto-ganador">{headline}</h2>
      <p className="help">Gana el menor tiempo en movimiento. La cifra mejor de cada fila va en negrita.</p>
      <table className="reto-table" aria-label="Comparativa del reto">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Cifra</span>
            </th>
            <th scope="col">Tú</th>
            <th scope="col">{rival}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{cell(r.mine, r.better === 'mine')}</td>
              <td>{cell(r.theirs, r.better === 'theirs')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Salidas desde el día del reto (medianoche en Madrid), primero las de distancia más parecida a la ruta. */
function PickRide({ open, challenge, busy, error, onClose, onPick }: {
  open: boolean;
  challenge: Challenge;
  busy: boolean;
  error: string;
  onClose: () => void;
  onPick: (ride: StoredActivity) => void;
}) {
  const [rides, setRides] = useState<StoredActivity[] | null>(null);
  const [readError, setReadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const since = Date.parse(challenge.createdAt);
  const target = challenge.distanceM;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRides(null);
    setReadError(false);
    listActivities({ from: startOfDay(new TZDate(since, TZ)).getTime(), to: Date.now() }).then(
      (rows) => {
        if (alive) setRides(rows.sort((a, b) => Math.abs(a.totals.distanceM - target) - Math.abs(b.totals.distanceM - target)));
      },
      () => {
        if (alive) setReadError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [open, since, target, attempt]);

  return (
    <Sheet open={open} onClose={onClose} title="Elige tu salida" sub={`Salidas desde el ${formatDay(since)}`} closeLabel="Cerrar sin elegir">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {readError ? (
        <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => setAttempt((n) => n + 1)}>Reintentar</button>}>
          No se han podido leer tus salidas. Comprueba el almacenamiento del navegador e inténtalo de nuevo.
        </Banner>
      ) : rides === null ? (
        <p role="status">Leyendo tus salidas…</p>
      ) : rides.length === 0 ? (
        <div className="reto-card">
          <p>No hay salidas desde el {formatDay(since)}. Importa la salida con la que hiciste la ruta.</p>
          <Link className="btn btn--secondary" to="/importar">Importar salidas</Link>
        </div>
      ) : (
        <ul className="amigos-list">
          {rides.map((ride) => {
            const name = ride.name?.trim() || `Salida del ${formatDay(ride.startTime)}`;
            return (
              <li key={ride.id} className="person">
                <span className="person-main">
                  <span className="person-name">{name}</span>
                  <span className="person-meta">
                    {formatDay(ride.startTime)}: {formatKm(ride.totals.distanceM, 1)} en {formatClock(ride.totals.movingTimeS)}
                  </span>
                  {shortRideWarning(ride, target) ? (
                    <span className="reto-warn">
                      <TriangleAlert className="ic" aria-hidden="true" />
                      Esta salida es bastante más corta que la ruta del reto
                    </span>
                  ) : null}
                </span>
                <span className="person-actions">
                  <button type="button" className="btn btn--primary" disabled={busy} aria-label={`Usar esta salida: ${name}`} onClick={() => onPick(ride)}>
                    Usar esta salida
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
