import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listChallenges, type Challenge } from '../../social/challenges';
import { Plus, Swords } from '../icons';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import { formatDay, isOpen, rivalLine, STATUS_LABEL } from '../retos/retoText';
import '../styles/social.css';

/** Retos: los 1 contra 1 del usuario, con su estado, el rival y el plazo. */
export function Retos() {
  const account = useAccount();
  return (
    <Page title="Retos" back="/mas" variant="narrow" className="page--retos" lead="Una ruta contra un amigo. Solo vosotros dos veis las cifras.">
      {account ? <RetosList account={account} /> : <p>Inicia sesión para ver tus retos.</p>}
    </Page>
  );
}

function RetosList({ account }: { account: Account }) {
  const { client } = account;
  const [rows, setRows] = useState<Challenge[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await listChallenges(client));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido completar.');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => void load()}>Reintentar</button>}>
        {error}
      </Banner>
    );
  if (!rows) return <p role="status">Cargando tus retos…</p>;
  if (!rows.length)
    return (
      <div className="card">
        <StateView
          icon={Swords}
          title="Sin retos todavía"
          text="Reta a un amigo con una ruta de tu biblioteca. Tendréis 30 días para hacerla."
          action={<Link className="btn btn--primary" to="/amigos">Ir a Amigos</Link>}
        />
      </div>
    );
  return (
    <>
      <Link className="btn btn--primary btn--block" to="/retos/nuevo">
        <Plus className="ic" aria-hidden="true" />
        Nuevo reto
      </Link>
      <ul className="amigos-list">
        {rows.map((c) => (
          <li key={c.id}>
            <Link className="person reto-row" to={`/retos/${c.id}`}>
              <span className="person-main">
                <span className="person-name">{c.routeName}</span>
                <span className="person-meta">{rivalLine(c)}</span>
                {isOpen(c) ? <span className="person-meta">Plazo: {formatDay(c.deadline)}</span> : null}
              </span>
              <span className="chip reto-status" data-status={c.status}>
                {STATUS_LABEL[c.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
