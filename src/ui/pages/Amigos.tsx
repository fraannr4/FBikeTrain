import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import {
  acceptFriendship,
  listFriends,
  removeFriendship,
  requestFriendship,
  searchProfiles,
  searchProfilesNear,
  type FriendRow,
  type ProfileCard,
} from '../../social/friends';
import { formatCount } from '../format';
import { MapPin, Search, UserPlus, Users } from '../icons';
import { Banner } from '../components/Banner';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { SegmentedControl } from '../components/SegmentedControl';
import { StateView } from '../components/StateView';
import '../styles/social.css';

type Tab = 'buscar' | 'amigos';
type Results = { title: string; empty: string; rows: ProfileCard[] };
const EMPTY_FRIENDS = 'Todavía no tienes amigos. Busca a alguien por su nombre o cerca de ti.';
const NO_AREA = 'Indica tu zona en Ajustes para buscar cerca.';
const message = (e: unknown) => (e instanceof Error ? e.message : 'No se ha podido completar.');

/** Amigos: buscar personas por nombre o cerca, y gestionar solicitudes y amistades. */
export function Amigos() {
  const account = useAccount();
  return (
    <Page title="Amigos" back="/mas" variant="narrow" className="page--amigos" lead="Busca a otros ciclistas por su nombre o cerca de tu zona.">
      {account ? <AmigosView account={account} /> : <p>Inicia sesión para buscar amigos.</p>}
    </Page>
  );
}

function AmigosView({ account }: { account: Account }) {
  const { client } = account;
  const [tab, setTab] = useState<Tab>('buscar');
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [listError, setListError] = useState('');
  /** null mientras se lee la zona propia (o si no se pudo leer: entonces decide el servidor). */
  const [hasArea, setHasArea] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [nearMissing, setNearMissing] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFriends(await listFriends(client));
      setListError('');
    } catch (e) {
      setListError(message(e));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    let alive = true;
    Promise.resolve()
      .then(() => client.rpc('my_area'))
      .then(({ data, error: err }) => {
        const row = (Array.isArray(data) ? data[0] : data) as { locality?: string | null } | null;
        if (alive && !err && row) setHasArea(Boolean(row.locality));
      })
      .catch(() => {
        /* sin zona conocida: la búsqueda cercana la valida el servidor */
      });
    return () => {
      alive = false;
    };
  }, [client, refresh]);

  async function find(run: () => Promise<Results>) {
    setSearching(true);
    setError('');
    try {
      setResults(await run());
    } catch (e) {
      setError(message(e));
    } finally {
      setSearching(false);
    }
  }

  function byName(e: FormEvent) {
    e.preventDefault();
    setNearMissing(false);
    const term = q.trim();
    if (term.length < 3) {
      setFieldError('Escribe al menos 3 letras.');
      return;
    }
    setFieldError('');
    void find(async () => ({
      title: `Resultados para «${term}»`,
      empty: 'Nadie se llama así. Revisa cómo se escribe o prueba con su nombre de usuario.',
      rows: await searchProfiles(client, term),
    }));
  }

  function near(radius: 25 | 50) {
    setFieldError('');
    if (hasArea === false) {
      setNearMissing(true);
      setResults(null);
      return;
    }
    setNearMissing(false);
    void find(async () => ({
      title: `Cerca de ti, a ${radius} km o menos`,
      empty: radius === 25 ? 'Nadie con la zona visible a 25 km o menos. Prueba con 50 km.' : 'Nadie con la zona visible a 50 km o menos.',
      rows: await searchProfilesNear(client, radius),
    }));
  }

  async function act(id: string, run: () => Promise<void>) {
    setBusyId(id);
    setError('');
    try {
      await run();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyId(null);
    }
  }

  const relation = new Map((friends ?? []).map((f) => [f.profile.id, f]));
  const received = (friends ?? []).filter((f) => f.status === 'pending' && f.direction === 'received');
  const sent = (friends ?? []).filter((f) => f.status === 'pending' && f.direction === 'sent');
  const accepted = (friends ?? []).filter((f) => f.status === 'accepted');

  function resultActions(card: ProfileCard): ReactNode {
    const f = relation.get(card.id);
    const busy = busyId === card.id;
    if (!f)
      return (
        <ActionButton label="Solicitar amistad" name={card.display_name} busy={busy} primary onClick={() => act(card.id, () => requestFriendship(client, card.id))} />
      );
    if (f.status === 'accepted') return <span className="person-state" data-tone="good">Amigos</span>;
    if (f.direction === 'sent') return <span className="person-state">Pendiente</span>;
    return <ActionButton label="Aceptar" name={card.display_name} busy={busy} primary onClick={() => act(card.id, () => acceptFriendship(client, f.friendship_id))} />;
  }

  return (
    <>
      <SegmentedControl<Tab>
        label="Vista de amigos"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'buscar', label: 'Buscar', icon: Search },
          { value: 'amigos', label: received.length ? `Amigos (${formatCount(received.length)})` : 'Amigos', icon: Users },
        ]}
      />
      {error ? <Banner tone="error">{error}</Banner> : null}

      {tab === 'buscar' ? (
        <>
          <section className="card amigos-search" aria-label="Buscar personas">
            <form className="amigos-query" role="search" onSubmit={byName}>
              <Field
                label="Nombre o usuario"
                type="search"
                value={q}
                maxLength={60}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                error={fieldError || undefined}
                onChange={(e) => setQ(e.target.value)}
              />
              <button type="submit" className="btn btn--primary" disabled={searching}>
                Buscar
              </button>
            </form>
            <fieldset className="amigos-near">
              <legend>Cerca de mí</legend>
              <div className="btn-row">
                {([25, 50] as const).map((r) => (
                  <button key={r} type="button" className="btn btn--secondary" aria-label={`Cerca de mí: ${r} km`} disabled={searching} onClick={() => near(r)}>
                    <MapPin className="ic" aria-hidden="true" />
                    {r} km
                  </button>
                ))}
              </div>
            </fieldset>
            {nearMissing ? (
              <Banner action={<Link className="btn btn--ghost" to="/ajustes?abrir=zona">Indicar mi zona</Link>}>{NO_AREA}</Banner>
            ) : null}
          </section>
          <p className="sr-only" role="status">
            {searching ? 'Buscando…' : results ? `${formatCount(results.rows.length)} resultados` : ''}
          </p>
          {results ? (
            <section className="amigos-group" aria-label={results.title}>
              <h2>{results.title}</h2>
              {results.rows.length ? (
                <ul className="amigos-list">
                  {results.rows.map((card) => (
                    <Person key={card.id} card={card}>
                      {resultActions(card)}
                    </Person>
                  ))}
                </ul>
              ) : (
                <p className="help">{results.empty}</p>
              )}
            </section>
          ) : null}
        </>
      ) : friends === null ? (
        listError ? (
          <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => void refresh()}>Reintentar</button>}>
            {listError}
          </Banner>
        ) : (
          <p role="status">Cargando tus amigos…</p>
        )
      ) : friends.length === 0 ? (
        <div className="card">
          <StateView
            icon={UserPlus}
            title="Sin amigos todavía"
            text={EMPTY_FRIENDS}
            action={
              <button type="button" className="btn btn--primary" onClick={() => setTab('buscar')}>
                <Search className="ic" aria-hidden="true" />
                Buscar personas
              </button>
            }
          />
        </div>
      ) : (
        <>
          <FriendGroup title="Solicitudes recibidas" rows={received}>
            {(f) => (
              <>
                <ActionButton label="Aceptar" name={f.profile.display_name} busy={busyId === f.friendship_id} primary onClick={() => act(f.friendship_id, () => acceptFriendship(client, f.friendship_id))} />
                <ActionButton label="Rechazar" name={f.profile.display_name} busy={busyId === f.friendship_id} onClick={() => act(f.friendship_id, () => removeFriendship(client, f.friendship_id))} />
              </>
            )}
          </FriendGroup>
          <FriendGroup title="Solicitudes enviadas" rows={sent}>
            {(f) => <ActionButton label="Cancelar" name={f.profile.display_name} busy={busyId === f.friendship_id} onClick={() => act(f.friendship_id, () => removeFriendship(client, f.friendship_id))} />}
          </FriendGroup>
          <FriendGroup title="Tus amigos" rows={accepted}>
            {(f) => (
              <>
                <Link className="btn btn--primary" to={`/retos/nuevo?amigo=${encodeURIComponent(f.profile.id)}`} aria-label={`Retar a ${f.profile.display_name}`}>
                  Retar
                </Link>
                <ActionButton label="Quitar" name={f.profile.display_name} busy={busyId === f.friendship_id} onClick={() => act(f.friendship_id, () => removeFriendship(client, f.friendship_id))} />
              </>
            )}
          </FriendGroup>
        </>
      )}
    </>
  );
}

function FriendGroup({ title, rows, children }: { title: string; rows: FriendRow[]; children: (f: FriendRow) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <section className="amigos-group" aria-label={title}>
      <h2>{title}</h2>
      <ul className="amigos-list">
        {rows.map((f) => (
          <Person key={f.friendship_id} card={f.profile}>
            {children(f)}
          </Person>
        ))}
      </ul>
    </section>
  );
}

function Person({ card, children }: { card: ProfileCard; children: ReactNode }) {
  const where = [card.locality, card.distance_km !== null ? `a menos de ${formatCount(card.distance_km)} km` : null].filter(Boolean).join(', ');
  return (
    <li className="person">
      <span className="person-main">
        <span className="person-name">{card.display_name}</span>
        <span className="person-meta">@{card.username}</span>
        {where ? <span className="person-meta">{where}</span> : null}
      </span>
      <span className="person-actions">{children}</span>
    </li>
  );
}

/** Botón por persona: el texto visible primero y el nombre después, para que el lector sepa a quién. */
function ActionButton({ label, name, busy, primary, onClick }: { label: string; name: string; busy: boolean; primary?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={primary ? 'btn btn--primary' : 'btn btn--secondary'} aria-label={`${label} a ${name}`} disabled={busy} onClick={onClick}>
      {label}
    </button>
  );
}
