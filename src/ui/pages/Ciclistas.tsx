import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { blockCyclist, listBlockedCyclists, listCyclists, type BlockedCyclist, type Cyclist } from '../../social/community';
import { acceptFriendship, listFriends, requestFriendship, type FriendRow } from '../../social/friends';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { Check, Lock, Search, User, UserPlus, X } from '../icons';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import '../styles/community.css';

const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';
const PAGE_SIZE = 50;

export function cyclistActivityDay(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sin actividad reciente';
  return `Actividad: ${new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(value))}`;
}

export function Ciclistas() {
  const account = useAccount();
  return <Page title="Ciclistas" back="/perfil" className="page--cyclists" actions={<Link className="icon-btn" to="/perfil" aria-label="Tu perfil"><User className="ic" aria-hidden="true" /></Link>}>
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
  const searchInput = useRef<HTMLInputElement>(null);

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
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  function search(e: FormEvent) {
    e.preventDefault();
    setTerm(query.trim());
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

  const people = rows.filter(person => person.id !== account.user.id);
  return <div className="cyclists-workspace">
    <div className="cyclists-discovery">
    <form className="cyclists-search" onSubmit={search} role="search" aria-label="Buscar ciclistas">
      <button className="cyclists-search-icon" type="submit" aria-label="Buscar"><Search className="ic" aria-hidden="true" /></button>
      <input ref={searchInput} aria-label="Nombre o usuario" type="search" autoComplete="off" maxLength={60} value={query} onChange={e => setQuery(e.target.value)} placeholder="Busca un ciclista" />
      {query && <button className="cyclists-search-icon" type="button" aria-label="Limpiar búsqueda" onClick={() => { setQuery(''); setTerm(''); searchInput.current?.focus(); }}><X className="ic" aria-hidden="true" /></button>}
    </form>
    <nav className="cyclists-filters" aria-label="Vistas de ciclistas"><span aria-current="page">Todos</span><Link to="/amigos?vista=amigos">Amigos</Link></nav>
    </div>
    <div className="cyclists-section-heading"><h2>{term ? `Resultados para «${term}»` : 'Actividad reciente'}</h2><span>{people.length}{more ? '+' : ''} {people.length === 1 ? 'ciclista' : 'ciclistas'}</span></div>
    {error && <Banner tone="error" action={<button className="btn btn--ghost" disabled={loading} onClick={() => void load(term, rows.length ? nextOffset : 0, generation.current)}>Reintentar</button>}>{error}</Banner>}
    {relationError && <Banner tone="error" action={<button className="btn btn--ghost" disabled={Boolean(busyId)} onClick={() => void loadRelations()}>Reintentar solicitudes</button>}>{relationError}</Banner>}
    {notice && <p role="status" className="cyclists-notice">{notice}</p>}
    {!loading && !error && !people.length && <section className="card cyclists-empty"><h3>{term ? 'No hemos encontrado a nadie' : 'La grupeta está por llegar'}</h3><p>{term ? 'Prueba con otro nombre o deja la búsqueda vacía para ver a toda la comunidad.' : 'Los otros ciclistas registrados aparecerán aquí. Tu perfil está disponible en Perfil.'}</p></section>}
    <ul className="cyclists-list" aria-label="Ciclistas registrados">
      {people.map(person => {
        const relation = friends?.find(f => f.profile.id === person.id);
        return <li className="cyclist-card" key={person.id}>
          <ProfileAvatar client={client} userId={person.id} name={person.display_name} version={person.avatar_version} className="cyclist-photo" />
          <Link className="cyclist-profile" to={`/personas/${encodeURIComponent(person.id)}`} aria-label={`Ver perfil de ${person.display_name}`}><strong>{person.display_name}</strong><span>@{person.username}</span><small>{relation?.status === 'accepted' ? 'Ya sois amigos' : relation?.direction === 'sent' ? 'Solicitud enviada' : cyclistActivityDay(person.last_active_at)}</small></Link>
          <div className="cyclist-actions">
            <Link className="btn btn--primary" to={`/retos/nuevo?ciclista=${encodeURIComponent(person.id)}`} aria-label={`Retar a ${person.display_name}`}>Retar</Link>
            {relation?.status === 'accepted' ? <span className="cyclist-friend" aria-label="Amistad aceptada"><Check className="ic" aria-hidden="true" /></span> : relation?.direction === 'sent' ? <span className="cyclist-friend" aria-label="Solicitud enviada"><Check className="ic" aria-hidden="true" /></span> : <button className="cyclist-add" disabled={friends === null || busyId !== null} onClick={() => void friendship(person, relation)} aria-label={relation?.direction === 'received' ? `Aceptar amistad de ${person.display_name}` : `Solicitar amistad a ${person.display_name}`} aria-busy={busyId === person.id}>{relation?.direction === 'received' ? <Check className="ic" aria-hidden="true" /> : <UserPlus className="ic" aria-hidden="true" />}</button>}
          </div>
        </li>;
      })}
    </ul>
    {loading && <p role="status">Cargando ciclistas…</p>}
    {more && <button className="btn btn--secondary btn--block" disabled={loading} onClick={() => void load(term, nextOffset, generation.current)}>Ver más ciclistas</button>}
    <p className="cyclists-privacy"><Lock className="ic" aria-hidden="true" />Solo ves ciclistas registrados. Tu zona y tus tracks siguen protegidos.</p>
    <section className="cyclists-blocks">
      <button className="btn btn--ghost btn--block" aria-expanded={blocksOpen} onClick={() => { setBlocksOpen(v => !v); if (!blocksOpen) void loadBlocks(); }}>Ciclistas bloqueados</button>
      {blocksOpen && <div>{blocksError && <Banner tone="error" action={<button className="btn btn--ghost" disabled={blocksBusy} onClick={() => void loadBlocks()}>Reintentar</button>}>{blocksError}</Banner>}{blocksBusy && <p role="status">Actualizando bloqueos…</p>}{blocked?.length === 0 && <p>No has bloqueado a ningún ciclista.</p>}<ul className="cyclists-blocked-list">{blocked?.map(person => <li key={person.id}><span>{person.display_name}<small>@{person.username}</small></span><button className="btn btn--secondary" disabled={blocksBusy} onClick={() => void unblock(person)} aria-label={`Desbloquear a ${person.display_name}`}>Desbloquear</button></li>)}</ul></div>}
    </section>
  </div>;
}
