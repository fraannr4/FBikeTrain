import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount, type Account } from '../../auth/AccountBoundary';
import { listCyclists, type Cyclist } from '../../social/community';
import { CHALLENGE_LABELS, createCommunityChallenge, type ChallengeKind } from '../../social/communityChallenges';
import { segmentOptions } from '../../social/challengeScoring';
import { Banner } from '../components/Banner';
import { Page } from '../components/Page';
import { communityError } from './CommunityRetos';
import '../styles/community-challenges.css';

export function CommunityNuevoReto() {
  const account = useAccount();
  return <Page title="Nuevo reto" back="/retos" variant="narrow" className="page--community" lead="Elige a quién retas y en qué os medís. El otro ciclista tendrá que aceptar.">
    {account && !account.user.is_anonymous ? <ChallengeForm account={account} /> : <p>Inicia sesión con una cuenta registrada para crear retos.</p>}
  </Page>;
}
function ChallengeForm({ account }: { account: Account }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const template = params.get('plantilla') === '100km';
  const [title, setTitle] = useState(template ? '+100 km esta semana' : '');
  const [kind, setKind] = useState<ChallengeKind>('distance');
  const [days, setDays] = useState(7);
  const [target, setTarget] = useState(template ? '100' : '');
  const [distance, setDistance] = useState('10');
  const [group, setGroup] = useState(false);
  const [chosen, setChosen] = useState<Pick<Cyclist, 'id' | 'username' | 'display_name'>[]>([]);
  const [cyclists, setCyclists] = useState<Cyclist[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [segments, setSegments] = useState<Awaited<ReturnType<typeof segmentOptions>>>([]);
  const [segment, setSegment] = useState('');
  const [segmentError, setSegmentError] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setSearchError('');
    listCyclists(account.client, search, offset).then(rows => {
      if (!live) return;
      setCyclists(previous => offset ? [...previous, ...rows] : rows); setHasMore(rows.length === 50);
    }, e => { if (live) setSearchError(communityError(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [account.client, search, offset, attempt]);
  useEffect(() => {
    const id = params.get('ciclista') ?? params.get('amigo');
    if (!id || id === account.user.id) return;
    let live = true;
    account.client.from('profiles').select('id,username,display_name').eq('id', id).maybeSingle().then(({ data, error: e }) => {
      if (!live) return;
      if (e) setSearchError('No se pudo cargar el ciclista seleccionado. Búscalo de nuevo.');
      else if (data) setChosen([data]);
    });
    return () => { live = false; };
  }, [account.client, account.user.id, params]);
  useEffect(() => {
    if (kind !== 'segment') return;
    let live = true;
    segmentOptions().then(rows => { if (live) { setSegments(rows); setSegment(previous => previous || rows[0]?.key || ''); } }, e => { if (live) setSegmentError(communityError(e)); });
    return () => { live = false; };
  }, [kind]);
  function select(row: Cyclist) {
    setChosen(previous => previous.some(p => p.id === row.id) ? previous.filter(p => p.id !== row.id) : group ? [...previous, row].slice(0, 19) : [row]);
  }
  function quick(nextKind: ChallengeKind, nextTitle: string, nextTarget: string) { setKind(nextKind); setTitle(nextTitle); setTarget(nextTarget); setDays(7); }
  async function send(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!chosen.length || (!group && chosen.length !== 1) || (group && chosen.length < 2)) { setError(group ? 'Elige al menos dos ciclistas para un reto de grupo.' : 'Elige a un ciclista para el duelo.'); return; }
    if (kind === 'segment' && !segment) { setError('Elige una subida detectada de tu historial.'); return; }
    setSending(true);
    try {
      const selected = segments.find(s => s.key === segment);
      const id = await createCommunityChallenge(account.client, {
        title: title.trim(), kind, duration_days: days, invited_ids: chosen.map(p => p.id),
        target_value: target && kind !== 'segment' ? Number(target) * (kind === 'distance' ? 1000 : kind === 'speed' ? 1 / 3.6 : 1) : null,
        distance_m: kind === 'speed' ? Math.round(Number(distance) * 1000) : kind === 'segment' ? Math.round(selected?.distanceM ?? 0) : null,
        segment_key: kind === 'segment' ? segment : null,
      });
      navigate(`/retos/comunidad/${id}`);
    } catch (e) { setError(communityError(e)); setSending(false); }
  }
  const people = cyclists.filter(p => p.id !== account.user.id);
  const unit = kind === 'distance' ? 'km' : kind === 'elevation' ? 'm' : kind === 'speed' ? 'km/h' : 'salidas';
  return <form className="community-stack" onSubmit={send}>
    <fieldset className="card community-form-section" disabled={sending}>
      <legend>1. Elige rival</legend>
      <div className="community-tabs"><button type="button" className="btn" aria-pressed={!group} onClick={() => { setGroup(false); setChosen(previous => previous.slice(0, 1)); }}>Duelo</button><button type="button" className="btn" aria-pressed={group} onClick={() => setGroup(true)}>Grupo</button></div>
      <p className="help">{group ? 'Invita entre 2 y 19 ciclistas. Cada persona decide si acepta.' : 'Invita a cualquier ciclista registrado, aunque aún no seáis amigos.'}</p>
      {chosen.length > 0 && <div className="community-selected" aria-label="Ciclistas seleccionados">{chosen.map(p => <button type="button" className="btn btn--secondary" key={p.id} onClick={() => setChosen(previous => previous.filter(x => x.id !== p.id))} aria-label={`Quitar a ${p.display_name}`}>{p.display_name} <span aria-hidden="true">×</span></button>)}</div>}
      <label className="field"><span className="field-label">Buscar ciclistas</span><input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre o usuario" /></label>
      <button type="button" className="btn btn--secondary" disabled={loading} onClick={() => { setOffset(0); setSearch(query.trim()); setAttempt(n => n + 1); }}>Buscar</button>
      {searchError && <Banner tone="error" action={<button type="button" className="btn btn--ghost" onClick={() => setAttempt(n => n + 1)}>Reintentar</button>}>{searchError}</Banner>}
      {loading && <p role="status">Cargando ciclistas…</p>}
      {!loading && !people.length && !searchError && <div><p>No hay ciclistas con ese nombre.</p><Link className="btn btn--ghost" to="/ciclistas">Abrir Ciclistas</Link></div>}
      <div className="community-pick-list" aria-label="Elegir participantes">{people.map(p => <label className="community-pick" key={p.id}><input type="checkbox" checked={chosen.some(c => c.id === p.id)} disabled={group && chosen.length >= 19 && !chosen.some(c => c.id === p.id)} onChange={() => select(p)} /><span><strong>{p.display_name}</strong><small>@{p.username}</small></span></label>)}</div>
      {hasMore && <button type="button" className="btn btn--secondary btn--block" disabled={loading} onClick={() => setOffset(n => n + 50)}>Más ciclistas</button>}
    </fieldset>
    <fieldset className="card community-form-section" disabled={sending}>
      <legend>2. Define el duelo</legend>
      <div className="community-quick" aria-label="Plantillas rápidas">
        <button type="button" className="btn btn--secondary" onClick={() => quick('distance', '+100 km esta semana', '100')}>100 km</button>
        <button type="button" className="btn btn--secondary" onClick={() => quick('elevation', 'A por los 1.000 metros', '1000')}>1.000 m</button>
        <button type="button" className="btn btn--secondary" onClick={() => quick('rides', 'Tres salidas en compañía', '3')}>3 salidas</button>
      </div>
      <label className="field"><span className="field-label">Nombre del reto</span><input className="input" required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="La próxima meta de la grupeta" /></label>
      <label className="field"><span className="field-label">Tipo de reto</span><select className="input" value={kind} onChange={e => { setKind(e.target.value as ChallengeKind); setTarget(''); }}>
        {Object.entries(CHALLENGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select></label>
      {kind === 'speed' && <label className="field"><span className="field-label">Distancia de la mejor media (km)</span><input className="input" type="number" min={1} max={500} step={0.1} required value={distance} onChange={e => setDistance(e.target.value)} /><span className="help">Se busca el tramo continuo más rápido de esta distancia. El tiempo incluye las paradas.</span></label>}
      {kind === 'segment' ? <>
        {segmentError && <Banner tone="error">{segmentError}</Banner>}
        <label className="field"><span className="field-label">Subida de referencia</span><select className="input" required value={segment} onChange={e => setSegment(e.target.value)}><option value="">Elige una subida</option>{segments.map(s => <option key={s.key} value={s.key}>{s.name} · {(s.distanceM / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km</option>)}</select></label>
        {!segments.length && <p className="help">Importa una salida con una subida detectada para crear este reto.</p>}
        <p className="help">Gana el menor tiempo en subidas detectadas equivalentes. El reconocimiento es aproximado; no se comparte el track.</p>
      </> : <label className="field"><span className="field-label">Objetivo ({unit}, opcional)</span><input className="input" type="number" min={kind === 'rides' || kind === 'elevation' ? 1 : 0.1} step={kind === 'rides' || kind === 'elevation' ? 1 : 0.1} value={target} onChange={e => setTarget(e.target.value)} placeholder="Sin objetivo fijo" /><span className="help">El objetivo guía el progreso. Gana quien consiga la mayor cifra al terminar el plazo.</span></label>}
      <label className="field"><span className="field-label">Duración (días)</span><input className="input" type="number" min={1} max={30} step={1} required value={days} onChange={e => setDays(Number(e.target.value))} /><span className="help">De 1 a 30 días desde que creas el reto.</span></label>
    </fieldset>
    <p className="community-footnote">Al crear o aceptar compartes únicamente tu marcador con los participantes. Cuentan las salidas desde tu aceptación hasta el cierre, importadas antes del plazo. Actualiza desde el dispositivo donde guardas tus salidas.</p>
    {error && <Banner tone="error">{error}</Banner>}
    <button className="btn btn--primary btn--block" disabled={sending}>{sending ? 'Enviando invitaciones…' : `Lanzar ${group ? 'reto de grupo' : 'duelo'}`}</button>
  </form>;
}
