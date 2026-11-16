import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listCyclists } from '../../social/community';
import {
  acceptFriendship,
  listFriends,
  removeFriendship,
  requestFriendship,
  searchProfilesNear,
  type FriendRow,
  type ProfileCard,
} from '../../social/friends';
import { formatCount } from '../format';
import { Search, UserPlus } from '../icons';
import { Banner } from '../components/Banner';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { StateView } from '../components/StateView';
import '../styles/social.css';

const NO_AREA = 'Indica tu zona en Ajustes para buscar cerca.';
const MAX_SUGGESTIONS = 8;
const message = (e: unknown) => (e instanceof Error ? e.message : 'No se ha podido completar.');
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');

/**
 * Amigos, dentro del perfil: solicitudes recibidas arriba, tu lista con buscador, las enviadas y
 * sugerencias (cercanos por banda de zona; sin zona, ciclistas activos). Buscar a cualquiera es Ciclistas.
 */
export function Amigos() {
  const account = useAccount();
  return (
    <Page title="Amigos" back="/perfil" variant="narrow" className="page--amigos">
      {account ? <AmigosView account={account} /> : <p>Inicia sesión para ver a tus amigos.</p>}
    </Page>
  );
}

type Suggestions = { rows: ProfileCard[]; noArea: boolean };

function AmigosView({ account }: { account: Account }) {
  const { client } = account;
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [listError, setListError] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  /** Sugerencias a las que has enviado solicitud aquí: siguen a la vista con «Solicitud enviada». */
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());

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
  }, [refresh]);

  useEffect(() => {
    let live = true;
    searchProfilesNear(client, 50)
      .then((rows) => ({ rows, noArea: false }))
      .catch(async (e: unknown) => ({ rows: await listCyclists(client).catch(() => []), noArea: message(e) === NO_AREA }))
      .then((value) => { if (live) setSuggestions(value); });
    return () => { live = false; };
  }, [client]);

  async function act(id: string, run: () => Promise<void>) {
    if (busyId !== null || friends === null || listError) return;
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

  const busy = busyId !== null;
  const rows = friends ?? [];
  const received = rows.filter((f) => f.status === 'pending' && f.direction === 'received');
  const sent = rows.filter((f) => f.status === 'pending' && f.direction === 'sent');
  const accepted = rows.filter((f) => f.status === 'accepted');
  const term = fold(q.trim());
  const shown = term ? accepted.filter((f) => fold(`${f.profile.display_name} ${f.profile.username}`).includes(term)) : accepted;
  const relation = new Set(rows.map((f) => f.profile.id));
  const suggested = (suggestions?.rows ?? [])
    .filter((c) => c.id !== account.user.id && (!relation.has(c.id) || asked.has(c.id)))
    .slice(0, MAX_SUGGESTIONS);

  return (
    <>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {listError ? (
        <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => void refresh()}>Reintentar</button>}>{listError}</Banner>
      ) : null}
      {friends === null ? (
        !listError && <p role="status">Cargando tus amigos…</p>
      ) : (
        <>
          <FriendGroup title="Solicitudes recibidas" rows={received}>
            {(f) => (
              <>
                <ActionButton label="Aceptar" name={f.profile.display_name} busy={busy} primary onClick={() => act(f.friendship_id, () => acceptFriendship(client, f.friendship_id))} />
                <ActionButton label="Rechazar" name={f.profile.display_name} busy={busy} onClick={() => act(f.friendship_id, () => removeFriendship(client, f.friendship_id))} />
              </>
            )}
          </FriendGroup>
          {accepted.length ? (
            <section className="amigos-group" aria-label="Tus amigos">
              <h2>Tus amigos · {formatCount(accepted.length)}</h2>
              <Field label="Buscar entre tus amigos" type="search" value={q} maxLength={60} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" onChange={(e) => setQ(e.target.value)} />
              {shown.length ? (
                <ul className="amigos-list">
                  {shown.map((f) => (
                    <Person key={f.friendship_id} card={f.profile}>
                      <Link className="btn btn--primary" to={`/retos/nuevo?ciclista=${encodeURIComponent(f.profile.id)}`} aria-label={`Retar a ${f.profile.display_name}`}>Retar</Link>
                      <ActionButton label="Quitar" name={f.profile.display_name} busy={busy} onClick={() => act(f.friendship_id, () => removeFriendship(client, f.friendship_id))} />
                    </Person>
                  ))}
                </ul>
              ) : (
                <p className="help">Ningún amigo coincide con «{q.trim()}».</p>
              )}
            </section>
          ) : !listError ? (
            <div className="card">
              <StateView
                icon={UserPlus}
                title="Todavía no tienes amigos."
                text="Busca ciclistas por su nombre o añade a alguien de las sugerencias."
                action={<Link className="btn btn--primary" to="/ciclistas"><Search className="ic" aria-hidden="true" />Buscar ciclistas</Link>}
              />
            </div>
          ) : null}
          <FriendGroup title="Solicitudes enviadas" rows={sent}>
            {(f) => <ActionButton label="Cancelar" name={f.profile.display_name} busy={busy} onClick={() => act(f.friendship_id, () => removeFriendship(client, f.friendship_id))} />}
          </FriendGroup>
          {!listError ? (
            <section className="amigos-group" aria-label="Sugerencias">
              <h2>Sugerencias</h2>
              {suggestions?.noArea ? (
                <Banner action={<Link className="btn btn--ghost" to="/ajustes?abrir=zona">Indicar mi zona</Link>}>Indica tu zona para ver ciclistas cerca de ti. Mientras, estos son los más activos.</Banner>
              ) : null}
              {suggestions === null ? (
                <p role="status">Buscando ciclistas…</p>
              ) : suggested.length ? (
                <ul className="amigos-list">
                  {suggested.map((c) => (
                    <Person key={c.id} card={c}>
                      {asked.has(c.id) ? (
                        <span className="person-state">Solicitud enviada</span>
                      ) : (
                        <ActionButton label="Añadir" name={c.display_name} busy={busy} primary onClick={() => act(c.id, async () => { await requestFriendship(client, c.id); setAsked((s) => new Set(s).add(c.id)); })} />
                      )}
                    </Person>
                  ))}
                </ul>
              ) : (
                <p className="help">Sin sugerencias por ahora.</p>
              )}
              <Link className="btn btn--ghost" to="/ciclistas"><Search className="ic" aria-hidden="true" />Buscar ciclistas</Link>
            </section>
          ) : null}
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
  const where = [card.locality, card.distance_km !== null && card.distance_km !== undefined ? `a menos de ${formatCount(card.distance_km)} km` : null].filter(Boolean).join(', ');
  return (
    <li className="person">
      <Link className="person-main person-profile" to={`/personas/${encodeURIComponent(card.id)}`} aria-label={card.display_name}>
        <span className="person-name">{card.display_name}</span>
        <span className="person-meta">@{card.username}</span>
        {where ? <span className="person-meta">{where}</span> : null}
      </Link>
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
