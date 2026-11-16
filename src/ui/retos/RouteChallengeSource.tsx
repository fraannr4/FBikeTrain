import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Account } from '../../auth/AccountBoundary';
import { db } from '../../db/db';
import { getTrack, listActivities } from '../../db/repo';
import type { LatLng, StoredActivity } from '../../domain/types';
import { MAX_REFERENCE_FILE_BYTES, parseReferenceRoute, type RoutePoint } from '../../routes/library';
import type { LibraryRoute } from '../../routes/library/schema';
import { findLibrary } from '../../routes/sources/client';
import type { ChallengePoint } from '../../social/challenges';
import { PRIVACY_TRIM_M, prepareRouteChallenge } from '../../social/routeChallenge';
import { formatKm } from '../format';
import { Banner } from '../components/Banner';
import { RideMap } from '../components/RideMap';
import { formatDay } from './retoText';

export type ChosenRoute = { name: string; points: ChallengePoint[]; distanceM: number };
type Origin = 'library' | 'ride' | 'gpx';
const ORIGINS: [Origin, string][] = [['library', 'Biblioteca cercana'], ['ride', 'Mis salidas'], ['gpx', 'Subir GPX']];
const message = (e: unknown) => (e instanceof Error ? e.message : 'No se ha podido leer la ruta.');
const rideName = (a: StoredActivity) => a.name?.trim() || `Salida del ${formatDay(a.startTime)}`;

/**
 * Origen de la ruta del reto: biblioteca común cerca de Casa, una salida propia o un GPX. Lo que se
 * enseña es lo que se compartirá: la ruta ya recortada al inicio y al final, y simplificada.
 */
export function RouteChallengeSource({ account, rideId, onChange }: { account: Account; rideId?: string | null; onChange: (route: ChosenRoute | null) => void }) {
  const [origin, setOrigin] = useState<Origin>(rideId ? 'ride' : 'library');
  const [source, setSource] = useState<{ name: string; points: RoutePoint[] } | null>(null);
  const [error, setError] = useState('');
  const [home, setHome] = useState<LatLng | null | undefined>(undefined);
  const [distanceKm, setDistanceKm] = useState(60);
  const [library, setLibrary] = useState<LibraryRoute[] | null>(null);
  const [libraryId, setLibraryId] = useState('');
  const [searching, setSearching] = useState(false);
  const [rides, setRides] = useState<StoredActivity[] | null>(null);
  const [chosenRide, setChosenRide] = useState(rideId ?? '');

  const prepared = useMemo(() => {
    if (!source) return null;
    try { return { route: { name: source.name, ...prepareRouteChallenge(source.points) }, error: '' }; }
    catch (e) { return { route: null, error: message(e) }; }
  }, [source]);
  useEffect(() => { onChange(prepared?.route ?? null); }, [prepared, onChange]);
  const preview = useMemo(() => prepared?.route?.points.map(([lat, lng]) => ({ lat, lng })) ?? [], [prepared]);

  useEffect(() => {
    let live = true;
    db.settings.get('app').then(row => { if (live) setHome(row?.value.home ?? null); }, () => { if (live) setHome(null); });
    listActivities().then(rows => {
      if (live) setRides(rows.filter(a => a.hasTrack && a.sport === 'cycling' && !a.id.startsWith('demo-')).sort((a, b) => b.startTime - a.startTime).slice(0, 50));
    }, () => { if (live) setRides([]); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (origin !== 'ride' || !chosenRide) return;
    let live = true;
    const ride = rides?.find(a => a.id === chosenRide);
    getTrack(chosenRide).then(points => {
      if (!live) return;
      const gps = (points ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map(p => ({ lat: p.lat!, lng: p.lng! }));
      if (gps.length < 2) { setSource(null); setError('Esa salida no tiene recorrido GPS.'); return; }
      setError(''); setSource({ name: ride ? rideName(ride) : 'Mi salida', points: gps });
    }, () => { if (live) setError('No se ha podido leer la salida guardada.'); });
    return () => { live = false; };
  }, [origin, chosenRide, rides]);

  function pick(next: Origin) { setOrigin(next); setSource(null); setError(''); }
  async function searchLibrary() {
    if (!home) return;
    setSearching(true); setError('');
    try {
      const zone = await findLibrary({ lat: home.lat, lon: home.lng, radiusM: 20_000, distanceKm, elevGainM: null }, account.client.functions);
      setLibrary(zone.routes); setLibraryId('');
    } catch { setError('No se han podido cargar rutas de la biblioteca. Inténtalo más tarde o sube un GPX.'); }
    finally { setSearching(false); }
  }
  function chooseLibrary(route: LibraryRoute) {
    setLibraryId(route.id);
    setSource({ name: route.name || 'Ruta de la biblioteca', points: route.line.map(([lng, lat, ele]) => (ele === undefined ? { lat, lng } : { lat, lng, ele })) });
  }
  async function readGpx(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setSource(null); setError('');
    if (!file) return;
    try {
      if (file.size > MAX_REFERENCE_FILE_BYTES) throw new Error('El fichero supera el límite de 10 MB.');
      const parsed = parseReferenceRoute(await file.text(), file.name);
      setSource({ name: parsed.name, points: parsed.points });
    } catch (err) { setError(message(err)); }
  }

  return <div className="community-route-source">
    <div className="community-tabs" role="group" aria-label="Origen de la ruta">{ORIGINS.map(([value, label]) =>
      <button type="button" className="btn" key={value} aria-pressed={origin === value} onClick={() => pick(value)}>{label}</button>)}</div>
    {origin === 'library' && (home === null ? <p className="help">Guarda Casa en <Link to="/ajustes">Ajustes</Link> para buscar rutas de la biblioteca común cerca de ti, o elige otra fuente.</p> : <>
      <label className="field"><span className="field-label">Distancia aproximada (km)</span><input className="input" type="number" min={5} max={300} step={5} value={distanceKm} onChange={e => setDistanceKm(Math.min(300, Math.max(5, Number(e.target.value) || 60)))} /></label>
      <button type="button" className="btn btn--secondary btn--block" disabled={searching || !home} onClick={() => void searchLibrary()}>{searching ? 'Buscando rutas…' : 'Buscar rutas cerca de Casa'}</button>
      {library && !library.length && <p className="help">No hay rutas de la biblioteca cerca con esa distancia.</p>}
      {library && library.length > 0 && <div className="community-pick-list" aria-label="Rutas de la biblioteca">{library.map(r =>
        <label className="community-pick" key={r.id}><input type="radio" name="route-library" checked={libraryId === r.id} onChange={() => chooseLibrary(r)} /><span><strong>{r.name || 'Ruta sin nombre'}</strong><small>{formatKm(r.distanceM, 1)}{r.elevGainM !== null ? ` · ${Math.round(r.elevGainM)} m+` : ''}</small></span></label>)}</div>}
    </>)}
    {origin === 'ride' && (rides === null ? <p role="status">Leyendo tus salidas…</p> : !rides.length ? <p className="help">No hay salidas con GPS guardadas en este dispositivo.</p> :
      <label className="field"><span className="field-label">Salida</span><select className="input" value={chosenRide} onChange={e => setChosenRide(e.target.value)}>
        <option value="">Elige una salida</option>
        {rides.map(a => <option key={a.id} value={a.id}>{rideName(a)} · {formatKm(a.totals.distanceM, 1)}</option>)}
      </select></label>)}
    {origin === 'gpx' && <label className="field"><span className="field-label">Archivo GPX de la ruta</span><input className="input" type="file" accept=".gpx,.tcx" onChange={e => void readGpx(e)} /><span className="help">Un track con el recorrido; se queda en tu dispositivo hasta que lances el reto.</span></label>}
    {(error || prepared?.error) && <Banner tone="error">{error || prepared?.error}</Banner>}
    {prepared?.route && <>
      <RideMap points={preview} label="Mapa de la ruta del reto" className="community-route-map" />
      <p className="community-route-figure"><strong>{formatKm(prepared.route.distanceM, 1)}</strong> de ruta para el reto</p>
    </>}
    <p className="help">Se recortan {PRIVACY_TRIM_M} m al inicio y al final para no mostrar dónde empiezas. Solo los participantes verán la ruta; de tus salidas solo se comparte el tiempo.</p>
  </div>;
}
