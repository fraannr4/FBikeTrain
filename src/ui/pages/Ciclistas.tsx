import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { blockCyclist, listBlockedCyclists, listCyclists, type BlockedCyclist, type Cyclist } from '../../social/community';
import { acceptFriendship, listFriends, requestFriendship, type FriendRow } from '../../social/friends';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { Search, Users } from '../icons';
import '../styles/community.css';

const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';
const PAGE_SIZE = 50;

export function cyclistActivityDay(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sin actividad reciente';
  return `Actividad: ${new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(value))}`;
}

export function Ciclistas() {
  const account = useAccount();
  return <Page title="Ciclistas" back="/perfil" className="page--cyclists" lead="La comunidad empieza con un saludo. Encuentra compañía y comparte tu próximo reto.">
    {!account || account.user.is_anonymous ? <p>Necesitas una cuenta registrada para acceder a la comunidad.</p> : <CyclistsView account={account} />}
  </Page>;
}

function CyclistsView({ account }: { account: Account }) {
  const { client } = account;
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<Cyclist[]>([]);
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [error, setError] = useState('');
  const [relationError, setRelationError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedCyclist[] | null>(null);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [blocksBusy, setBlocksBusy] = useState(false);
  const [blocksError, setBlocksError] = useState('');
  const generation = useRef(0);

  const loadRelations = useCallback(async () => {
    setRelationError('');
    try { setFriends(await listFriends(client)); }
    catch (e) { setFriends(null); setRelationError(message(e)); }
  }, [client]);

  const load = useCallback(async (q: string, offset: number, revision: number) => {
    setLoading(true); setError('');
    try {
      const page = await listCyclists(client, q, offset);
      if (revision !== generation.current) return;
      setRows(old => offset === 0 ? page : [...old, ...page.filter(p => !old.some(o => o.id === p.id))]);
      setNextOffset(offset + page.length); setMore(page.length === PAGE_SIZE);
    } catch (e) { if (revision === generation.current) setError(message(e)); }
    finally { if (revision === generation.current) setLoading(false); }
  }, [client]);

  useEffect(() => {
    const revision = ++generation.current;
    setRows([]); setMore(false); setNextOffset(0);
    void load(term, 0, revision);
    return () => { generation.current++; };
  }, [term, load]);
  useEffect(() => { void loadRelations(); }, [loadRelations]);

  function search(e: FormEvent) {
    e.preventDefault();
    if (query.trim() === term) void load(term, 0, ++generation.current);
    else setTerm(query.trim());
  }
  async function friendship(person: Cyclist, relation: FriendRow | undefined) {
    if (busyId || friends === null) return;
    setBusyId(person.id); setNotice(''); setRelationError('');
    try {
      if (relation?.direction === 'received') await acceptFriendship(client, relation.friendship_id);
      else await requestFriendship(client, person.id);
      await loadRelations();
      setNotice(relation?.direction === 'received' ? `Ahora eres amigo de ${person.display_name}.` : `Solicitud enviada a ${person.display_name}.`);
    } catch (e) { setRelationError(message(e)); }
    finally { setBusyId(null); }
  }
  async function loadBlocks() {
    setBlocksBusy(true); setBlocksError('');
    try { setBlocked(await listBlockedCyclists(client)); }
    catch (e) { setBlocksError(message(e)); }
    finally { setBlocksBusy(false); }
  }
  async function unblock(person: BlockedCyclist) {
    if (blocksBusy) return;
    setBlocksBusy(true); setBlocksError('');
    try {
      await blockCyclist(client, person.id, false);
      setBlocked(old => old?.filter(p => p.id !== person.id) ?? []);
      setNotice(`${person.display_name} ya no está bloqueado.`);
      await load(term, 0, ++generation.current);
    } catch (e) { setBlocksError(message(e)); }
    finally { setBlocksBusy(false); }
  }

  return <div className="cyclists-workspace">
    <section className="cyclists-intro" aria-label="Comunidad abierta">
      <Users className="ic" aria-hidden="true" /><div><span className="cyclists-eyebrow">TODOS TENEMOS ALGO QUE COMPARTIR</span><h2>Tu próxima grupeta,<br />a un saludo.</h2><p>Todos los ciclistas registrados, por actividad reciente. Puedes retar a cualquiera.</p></div>
      <Link className="btn btn--secondary" to="/amigos?vista=amigos">Mis amigos y solicitudes</Link>
    </section>
    <form className="cyclists-search" onSubmit={search} role="search" aria-label="Buscar ciclistas">
      <label className="field"><span className="field-label">Nombre o usuario</span><input className="input" type="search" maxLength={60} value={query} onChange={e => setQuery(e.target.value)} placeholder="Encuentra a alguien" /></label>
      <button className="btn btn--primary" type="submit"><Search className="ic" aria-hidden="true" /><span>Buscar</span></button>
    </form>
    <div className="cyclists-section-heading"><h2>{term ? `Resultados para «${term}»` : 'Nuestra comunidad'}</h2><span>Actividad reciente primero</span></div>
    {error && <Banner tone="error" action={<button className="btn btn--ghost" disabled={loading} onClick={() => void load(term, rows.length ? nextOffset : 0, generation.current)}>Reintentar</button>}>{error}</Banner>}
    {relationError && <Banner tone="error" action={<button className="btn btn--ghost" disabled={Boolean(busyId)} onClick={() => void loadRelations()}>Reintentar solicitudes</button>}>{relationError}</Banner>}
    {notice && <p role="status" className="cyclists-notice">{notice}</p>}
    {!loading && !error && !rows.length && <section className="card cyclists-empty"><h3>{term ? 'No hemos encontrado a nadie' : 'La grupeta está por llegar'}</h3><p>{term ? 'Prueba con otro nombre o deja la búsqueda vacía para ver a toda la comunidad.' : 'Los ciclistas registrados aparecerán aquí. Las cuentas anónimas quedan fuera.'}</p></section>}
    <ul className="cyclists-list" aria-label="Ciclistas registrados">
      {rows.map(person => {
        const self = person.id === account.user.id;
        const relation = friends?.find(f => f.profile.id === person.id);
        const initials = person.display_name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('');
        return <li className="cyclist-card" key={person.id}>
          <div className="cyclist-identity"><span className="cyclist-initials" aria-hidden="true">{initials}</span><Link className="cyclist-profile" to={self ? '/perfil' : `/personas/${encodeURIComponent(person.id)}`} aria-label={`Ver perfil de ${person.display_name}`}><strong>{person.display_name}{self ? ' · Tú' : ''}</strong><span>@{person.username}</span></Link></div>
          {person.bio && <p className="cyclist-bio">{person.bio}</p>}
          <p className="cyclist-meta">{cyclistActivityDay(person.last_active_at)}{person.locality ? ` · ${person.locality}` : ''}</p>
          {!self && <div className="cyclist-actions">
            {relation?.status === 'accepted' ? <span className="cyclist-friend">Ya sois amigos</span> : relation?.direction === 'sent' ? <span className="cyclist-friend">Solicitud enviada</span> : <button className="btn btn--secondary" disabled={friends === null || busyId !== null} onClick={() => void friendship(person, relation)} aria-label={relation?.direction === 'received' ? `Aceptar amistad de ${person.display_name}` : `Solicitar amistad a ${person.display_name}`}>{busyId === person.id ? 'Enviando…' : relation?.direction === 'received' ? 'Aceptar amistad' : 'Añadir amigo'}</button>}
            <Link className="btn btn--primary" to={`/retos/nuevo?ciclista=${encodeURIComponent(person.id)}`} aria-label={`Retar a ${person.display_name}`}>Lanzar reto<span aria-hidden="true"> ↗</span></Link>
          </div>}
        </li>;
      })}
    </ul>
    {loading && <p role="status">Cargando ciclistas…</p>}
    {more && <button className="btn btn--secondary btn--block" disabled={loading} onClick={() => void load(term, nextOffset, generation.current)}>Ver más ciclistas</button>}
    <p className="cyclists-privacy">Tu zona sigue siendo aproximada. Este directorio no muestra celdas ni distancias exactas.</p>
    <section className="cyclists-blocks">
      <button className="btn btn--ghost btn--block" aria-expanded={blocksOpen} onClick={() => { setBlocksOpen(v => !v); if (!blocksOpen) void loadBlocks(); }}>Ciclistas bloqueados</button>
      {blocksOpen && <div>{blocksError && <Banner tone="error" action={<button className="btn btn--ghost" disabled={blocksBusy} onClick={() => void loadBlocks()}>Reintentar</button>}>{blocksError}</Banner>}{blocksBusy && <p role="status">Actualizando bloqueos…</p>}{blocked?.length === 0 && <p>No has bloqueado a ningún ciclista.</p>}<ul className="cyclists-blocked-list">{blocked?.map(person => <li key={person.id}><span>{person.display_name}<small>@{person.username}</small></span><button className="btn btn--secondary" disabled={blocksBusy} onClick={() => void unblock(person)} aria-label={`Desbloquear a ${person.display_name}`}>Desbloquear</button></li>)}</ul></div>}
    </section>
  </div>;
}
