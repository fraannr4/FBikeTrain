import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listActivities } from '../../db/repo';
import type { StoredActivity } from '../../domain/types';
import { localDay } from '../../metrics/calendar';
import { createPost, deletePost, listJournal, type JournalPost, type JournalRide } from '../../social/journal';
import { Banner } from '../components/Banner';
import { Bike, Pencil, Plus, Trash2 } from '../icons';
import { formatDuration, formatKm, formatMeters } from '../format';
import { ProfileAvatar } from './ProfileAvatar';

type Props = {
  client: SupabaseClient;
  userId: string;
  targetId: string | null;
  statsVisibility?: 'everyone' | 'friends';
  showComposer?: boolean;
  /** Recarga autores y audiencias tras editar el perfil, conservando el borrador abierto. */
  refreshKey?: string | number;
};
const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión e inténtalo de nuevo.';
const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' });
const rideDate = (day: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(`${day}T12:00:00Z`));

/** Cada cuaderno tiene su propia instancia: ninguna respuesta tardía cruza de perfil o de cuenta. */
export function JournalFeed(props: Props) {
  return <FeedView key={`${props.userId}:${props.targetId ?? 'friends'}`} {...props} />;
}

function FeedView({ client, userId, targetId, statsVisibility = 'everyone', showComposer = false, refreshKey }: Props) {
  const [posts, setPosts] = useState<JournalPost[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composer, setComposer] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const live = useRef(true);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true); setError(''); setMoreError('');
    try {
      const rows = await listJournal(client, targetId);
      if (live.current && request === revision.current) { setPosts(rows); setMore(rows.length === 20); }
    } catch (e) { if (live.current && request === revision.current) setError(errorMessage(e)); }
    finally { if (live.current && request === revision.current) { setLoading(false); setLoadingMore(false); } }
  }, [client, targetId, refreshKey]);

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => { live.current = false; revision.current++; };
  }, [refresh]);

  async function loadMore() {
    const last = posts?.at(-1);
    if (!last || loadingMore || loading) return;
    const request = revision.current;
    setLoadingMore(true); setMoreError('');
    try {
      const rows = await listJournal(client, targetId, { createdAt: last.created_at, id: last.id });
      if (!live.current || request !== revision.current) return;
      setPosts(current => {
        const ids = new Set((current ?? []).map(post => post.id));
        return [...(current ?? []), ...rows.filter(post => !ids.has(post.id))];
      });
      setMore(rows.length === 20);
    } catch (e) { if (live.current && request === revision.current) setMoreError(errorMessage(e)); }
    finally { if (live.current && request === revision.current) setLoadingMore(false); }
  }

  async function remove(id: string) {
    if (deleting) return;
    setDeleting(id); setError(''); setNotice('');
    try {
      await deletePost(client, id);
      if (!live.current) return;
      setPosts(current => (current ?? []).filter(post => post.id !== id));
      setConfirm(null); setNotice('Publicación borrada.');
      await refresh();
    } catch (e) { if (live.current) setError(errorMessage(e)); }
    finally { if (live.current) setDeleting(null); }
  }

  const mine = targetId === userId;
  return <section className="journal" aria-label={targetId === null ? 'Feed de amigos' : 'Cuaderno de ruta'}>
    {showComposer && <div className="journal-composer">
      {!composer ? <button type="button" className="btn btn--primary journal-write" onClick={() => { setComposer(true); setNotice(''); }}><Pencil className="ic" aria-hidden="true" />Escribir en mi cuaderno</button> :
        <Composer client={client} statsVisibility={statsVisibility} onCancel={() => setComposer(false)} onPublished={() => {
          setComposer(false); setNotice('Publicado en tu cuaderno.'); void refresh();
        }} />}
    </div>}
    {notice && <p className="journal-notice" role="status">{notice}</p>}
    {error && <Banner tone="error" action={<button type="button" className="btn btn--ghost" disabled={loading} onClick={() => void refresh()}>Reintentar</button>}>{error}</Banner>}
    {posts === null ? !error && <p className="journal-loading" role="status">Abriendo el cuaderno…</p> : posts.length === 0 ?
      <div className="journal-empty">
        <span className="journal-empty-icon" aria-hidden="true"><Bike className="ic" /></span>
        <h3>{targetId === null ? 'Las buenas historias se ruedan en compañía' : mine ? 'Cada salida tiene una historia' : 'Un cuaderno por estrenar'}</h3>
        <p>{targetId === null ? 'Aquí aparecerán las publicaciones que compartáis tú y tus amigos.' : mine ? 'Escribe lo que te llevas de la ruta: una sensación, una cima o un pequeño logro.' : 'Todavía no hay publicaciones que puedas ver.'}</p>
        {targetId === null && <Link className="btn btn--secondary" to="/amigos">Buscar ciclistas</Link>}
      </div> : <ol className="journal-list">
        {posts.map(post => <li key={post.id}><article className="journal-card" aria-label={`Publicación de ${post.author.display_name}`}>
          <header className="journal-header">
            <Link className="journal-author" to={post.author_id === userId ? '/perfil' : `/personas/${encodeURIComponent(post.author_id)}`} aria-label={`Ver perfil de ${post.author.display_name}`}>
              <ProfileAvatar client={client} userId={post.author_id} name={post.author.display_name} version={post.author.avatar_version} size="small" />
              <span><strong>{post.author.display_name}</strong><span className="journal-meta">@{post.author.username}</span></span>
            </Link>
            <span className="journal-audience" data-audience={post.visibility}>{post.visibility === 'friends' ? 'Solo amigos' : 'Comunidad'}</span>
          </header>
          {post.body && <p className="journal-body">{post.body}</p>}
          {post.ride && <RideFigures ride={post.ride} />}
          <footer className="journal-footer">
            <time className="journal-meta" dateTime={post.created_at}>{dateTime.format(new Date(post.created_at))}</time>
            {post.author_id === userId && <button type="button" className="btn btn--ghost journal-delete" aria-label="Borrar publicación" disabled={deleting !== null} onClick={() => setConfirm(post.id)}><Trash2 className="ic" aria-hidden="true" /><span>Borrar</span></button>}
          </footer>
          {confirm === post.id && <div className="journal-confirm" role="group" aria-label="Confirmar borrado">
            <p>¿Borrar esta publicación de tu cuaderno?</p>
            <div className="btn-row"><button type="button" className="btn btn--secondary" disabled={deleting !== null} onClick={() => setConfirm(null)}>Conservar</button><button type="button" className="btn btn--primary" disabled={deleting !== null} onClick={() => void remove(post.id)}>{deleting === post.id ? 'Borrando…' : 'Sí, borrar'}</button></div>
          </div>}
        </article></li>)}
      </ol>}
    {moreError && <Banner tone="error">{moreError}</Banner>}
    {more && <button type="button" className="btn btn--secondary journal-more" disabled={loadingMore || loading} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : moreError ? 'Reintentar publicaciones anteriores' : 'Ver publicaciones anteriores'}</button>}
  </section>;
}

function RideFigures({ ride }: { ride: JournalRide }) {
  return <div className="journal-ride">
    <p className="journal-ride-date"><Bike className="ic" aria-hidden="true" />Salida del {rideDate(ride.activity_date)}</p>
    <dl className="journal-figures">
      <div><dt>Distancia</dt><dd>{formatKm(ride.distance_m, 1)}</dd></div>
      <div><dt>Desnivel</dt><dd>{ride.elev_gain_m === null ? 'Sin dato' : formatMeters(ride.elev_gain_m)}</dd></div>
      <div><dt>En movimiento</dt><dd>{formatDuration(ride.moving_time_s)}</dd></div>
    </dl>
  </div>;
}

/** La selección local no sale del dispositivo: el payload se construye con una lista cerrada. */
function Composer({ client, statsVisibility, onCancel, onPublished }: { client: SupabaseClient; statsVisibility: 'everyone' | 'friends'; onCancel: () => void; onPublished: () => void }) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'friends' | 'everyone'>('friends');
  const [rides, setRides] = useState<StoredActivity[] | null>(null);
  const [addingRide, setAddingRide] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [rideError, setRideError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selected = addingRide ? rides?.find(ride => ride.id === selectedId) : undefined;
  const ride: JournalRide | null = selected ? {
    activity_date: localDay(selected.startTime),
    distance_m: Math.round(selected.totals.distanceM),
    moving_time_s: Math.round(selected.totals.movingTimeS),
    elev_gain_m: Number.isFinite(selected.totals.elevGainM) && selected.totals.elevGainM >= 0 ? Math.round(selected.totals.elevGainM) : null,
  } : null;
  const friendsOnly = statsVisibility === 'friends' && ride !== null;
  useEffect(() => { if (friendsOnly) setVisibility('friends'); }, [friendsOnly]);

  async function loadRides() {
    setAddingRide(true); setRideError('');
    try {
      const rows = await listActivities();
      if (alive.current) setRides(rows.sort((a, b) => b.startTime - a.startTime).slice(0, 30));
    } catch { if (alive.current) setRideError('No se pudieron leer tus salidas. Puedes reintentar o publicar solo el texto.'); }
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!body.trim() && !ride) { setError('Escribe algo o elige una salida para tu cuaderno.'); return; }
    if (ride && (!Number.isFinite(ride.distance_m) || ride.distance_m <= 0 || !Number.isFinite(ride.moving_time_s) || ride.moving_time_s <= 0)) {
      setError('Esta salida no tiene cifras válidas para compartir. Elige otra o publica solo el texto.'); return;
    }
    setBusy(true);
    try {
      await createPost(client, { body: body.trim(), visibility: friendsOnly ? 'friends' : visibility, ride });
      if (!alive.current) return;
      // Se descarta el borrador al confirmar la escritura, antes del refresco del feed.
      setBody(''); setSelectedId(''); setAddingRide(false); setVisibility('friends');
      onPublished();
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  }

  return <form className="journal-editor" aria-label="Nueva publicación" onSubmit={publish}>
    <fieldset disabled={busy}>
      <label className="journal-field"><span className="field-label">¿Qué te llevas de la ruta?</span><textarea className="input" rows={4} maxLength={1000} placeholder="Una carretera que volverías a recorrer. Ese último kilómetro. Lo que hoy salió mejor." value={body} onChange={e => setBody(e.target.value)} /></label>
      <p className="journal-counter">{body.length}/1000</p>
      {!addingRide ? <button type="button" className="btn btn--secondary" onClick={() => void loadRides()}><Plus className="ic" aria-hidden="true" />Añadir cifras de una salida</button> : <div className="journal-attachment">
        {rideError ? <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => void loadRides()}>Reintentar salidas</button>}>{rideError}</Banner> : rides === null ? <p role="status">Leyendo tus últimas salidas…</p> : rides.length === 0 ? <p>No tienes salidas importadas en este dispositivo.</p> :
          <label className="journal-field"><span className="field-label">Salida que quieres compartir</span><select className="input" value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">Elige una salida</option>{rides.map(item => <option key={item.id} value={item.id}>{localDay(item.startTime)} · {item.name?.trim() || 'Salida'} · {formatKm(item.totals.distanceM, 1)}</option>)}</select></label>}
        {ride && <div className="journal-preview"><RideFigures ride={ride} /><p className="help">Compartes las cifras, nunca el mapa.</p></div>}
        <button type="button" className="btn btn--ghost" onClick={() => { setAddingRide(false); setSelectedId(''); }}>Quitar salida</button>
      </div>}
      <label className="journal-field"><span className="field-label">Quién verá esta publicación</span><select className="input" value={friendsOnly ? 'friends' : visibility} onChange={e => setVisibility(e.target.value as 'friends' | 'everyone')}><option value="friends">Solo amigos</option><option value="everyone" disabled={friendsOnly}>Toda la comunidad</option></select></label>
      {friendsOnly && <p className="help">Tus cifras están configuradas solo para amigos. Esta publicación respetará esa privacidad.</p>}
      {error && <p className="account-error" role="alert">{error}</p>}
      <div className="btn-row journal-editor-actions"><button type="button" className="btn btn--secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="btn btn--primary">{busy ? 'Publicando…' : 'Publicar en mi cuaderno'}</button></div>
    </fieldset>
  </form>;
}
