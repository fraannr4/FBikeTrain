import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { TZDate } from '@date-fns/tz';
import { useAccount } from '../../auth/AccountBoundary';
import { authMessage } from '../../auth/AuthScreen';
import { listActivities } from '../../db/repo';
import { TZ } from '../../metrics/aggregate';
import { loadSettings, saveSettings } from '../../settings/settings';
import { listFriends } from '../../social/friends';
import { removeAvatar, uploadAvatar } from '../../social/avatar';
import type { RidingStyle } from '../../social/journal';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { Banner } from '../components/Banner';
import { Sheet } from '../components/Sheet';
import { SegmentedControl } from '../components/SegmentedControl';
import { BookOpen, Ellipsis, MapPin, Pencil, Search, Swords, Users } from '../icons';
import { formatCount, formatKm, formatMeters } from '../format';
import { ProfileHero } from '../profile/ProfileHero';
import { JournalFeed } from '../profile/JournalFeed';
import { RIDING_STYLES, ridingStyle } from '../profile/profileStyle';
import '../styles/profile.css';

type Profile = { username: string; display_name: string; stats_visibility: 'everyone' | 'friends'; bio: string; riding_style: RidingStyle; avatar_version: number };
type Year = { distance: number; elevation: number; rides: number; year: number };
const errorText = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';

export function Perfil() {
  const account = useAccount();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<'cuaderno' | 'amigos'>('cuaderno');
  const [year, setYear] = useState<Year | null>(null);
  const [friends, setFriends] = useState<number | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!account) return;
    let live = true; setError('');
    Promise.resolve().then(() => account.client.from('profiles').select('username,display_name,stats_visibility,bio,riding_style,avatar_version').eq('id', account.user.id).single())
      .then(({ data, error: err }) => {
        if (!live) return;
        if (err || !data) setError('No se pudo cargar tu perfil. Inténtalo de nuevo.');
        else setProfile({ ...data, bio: data.bio ?? '', riding_style: ridingStyle(data.riding_style), avatar_version: data.avatar_version ?? 0 } as Profile);
      }).catch(() => { if (live) setError('No se pudo cargar tu perfil. Comprueba la conexión e inténtalo de nuevo.'); });
    return () => { live = false; };
  }, [account?.client, account?.user.id, attempt]);
  useEffect(() => {
    if (!account) return;
    let live = true; const currentYear = new TZDate(Date.now(), TZ).getFullYear();
    listActivities({ from: new TZDate(currentYear, 0, 1, TZ).getTime(), to: Date.now() }).then(rows => {
      if (live) setYear({ year: currentYear, rides: rows.length, distance: rows.reduce((s, a) => s + a.totals.distanceM, 0), elevation: rows.reduce((s, a) => s + a.totals.elevGainM, 0) });
    }).catch(() => {});
    listFriends(account.client).then(rows => { if (live) setFriends(rows.filter(f => f.status === 'accepted').length); }).catch(() => {});
    return () => { live = false; };
  }, [account?.client, account?.user.id]);
  function edit() { setDraft(profile); setEditError(''); setEditing(true); }
  async function save(e: FormEvent) {
    e.preventDefault(); if (!account || !draft || busy || photoBusy) return;
    setBusy(true); setEditError(''); setNotice('');
    try {
      const next = { username: draft.username, display_name: draft.display_name.trim(), bio: draft.bio.trim(), riding_style: draft.riding_style, stats_visibility: draft.stats_visibility };
      if (!next.display_name) { setEditError('Escribe un nombre para tu perfil.'); return; }
      const { data, error: err } = await account.client.from('profiles').update(next).eq('id', account.user.id).select('id').single();
      if (err || !data) { setEditError(err?.code === '23505' ? 'Ese nombre de usuario ya está ocupado. Elige otro.' : 'No se pudo guardar el perfil. Inténtalo de nuevo.'); return; }
      setProfile(p => p ? { ...p, ...next } : p); setEditing(false); setNotice('Perfil guardado.');
      try { const settings = await loadSettings(); await saveSettings({ ...settings, displayName: next.display_name }); }
      catch { setNotice('Perfil guardado. El saludo local se actualizará cuando el almacenamiento vuelva a estar disponible.'); }
    } catch { setEditError('No se pudo guardar el perfil. Comprueba la conexión.'); }
    finally { setBusy(false); }
  }
  async function photo(file: File | undefined) {
    if (!account || !file || photoBusy) return;
    setPhotoBusy(true); setError(''); setNotice('');
    try { const version = await uploadAvatar(account.client, account.user.id, file); setProfile(p => p ? { ...p, avatar_version: version } : p); setNotice('Foto de perfil guardada.'); }
    catch (e) { setError(errorText(e)); }
    finally { setPhotoBusy(false); if (photoInput.current) photoInput.current.value = ''; }
  }
  async function clearPhoto() {
    if (!account || photoBusy) return;
    setPhotoBusy(true); setEditError('');
    try { await removeAvatar(account.client, account.user.id); setProfile(p => p ? { ...p, avatar_version: 0 } : p); setNotice('Foto de perfil retirada.'); }
    catch (e) { setEditError(errorText(e)); }
    finally { setPhotoBusy(false); }
  }
  async function logout() {
    if (!account || busy) return;
    setBusy(true); setEditError('');
    try { const { error: err } = await account.client.auth.signOut({ scope: 'local' }); if (err) throw err; }
    catch (e) { setEditError(authMessage(e)); }
    finally { setBusy(false); }
  }
  return <Page title="Tu perfil" className="page--profile">
    {!account ? <p>Inicia sesión para ver tu perfil.</p> : <>
      {error && <Banner tone="error" action={!profile ? <button className="btn btn--ghost" onClick={() => setAttempt(n => n + 1)}>Reintentar</button> : undefined}>{error}</Banner>}
      {!profile ? !error && <p role="status">Cargando tu perfil…</p> : <>
        <input ref={photoInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Archivo de foto de perfil" tabIndex={-1} onChange={e => void photo(e.target.files?.[0])} />
        <ProfileHero client={account.client} profile={{ ...profile, id: account.user.id }} own onPhoto={() => photoInput.current?.click()} photoBusy={photoBusy}>
          <button className="btn btn--primary" onClick={edit} aria-label="Editar perfil"><Pencil className="ic" aria-hidden="true" />Editar</button>
          <Link className="btn btn--secondary" to="/amigos?vista=amigos" aria-label="Mis amigos"><Users className="ic" aria-hidden="true" />{friends === null ? 'Mis amigos' : `${formatCount(friends)} ${friends === 1 ? 'amigo' : 'amigos'}`}</Link>
          <Link className="icon-btn profile-more" to="/mas" aria-label="Más opciones"><Ellipsis className="ic" aria-hidden="true" /></Link>
        </ProfileHero>
        {notice && <p className="profile-notice" role="status">{notice}</p>}
        <div className="profile-workspace"><div className="profile-stream">
          {year && <section className="profile-year" aria-label={`Tu año ${year.year} en este dispositivo`}><div className="profile-year-label"><span>Tu año, a tu ritmo</span><small>{year.year} · En este dispositivo</small></div><dl><div><dt>Distancia</dt><dd>{formatKm(year.distance)}</dd></div><div><dt>Desnivel</dt><dd>{formatMeters(year.elevation)}</dd></div><div><dt>Salidas</dt><dd>{formatCount(year.rides)}</dd></div></dl></section>}
          <SegmentedControl label="Vista del cuaderno" value={tab} onChange={setTab} options={[{ value: 'cuaderno', label: 'Mi cuaderno', icon: BookOpen }, { value: 'amigos', label: 'Mi grupeta', icon: Users }]} />
          <JournalFeed client={account.client} userId={account.user.id} targetId={tab === 'cuaderno' ? account.user.id : null} statsVisibility={profile.stats_visibility} refreshKey={`${profile.username}|${profile.display_name}|${profile.riding_style}|${profile.avatar_version}|${profile.stats_visibility}`} showComposer />
        </div><aside className="profile-sidebar" aria-label="Tu comunidad">
          <section className="profile-side-card"><span className="profile-eyebrow">LA BUENA COMPAÑÍA</span><h2>Tu próxima historia<br />puede empezar en grupo.</h2><p>Encuentra ciclistas, comparte lo que te mueve y pon una ruta por delante.</p>
            <Link className="btn btn--secondary btn--block" to="/amigos"><Search className="ic" aria-hidden="true" />Buscar ciclistas</Link>
            <Link className="profile-side-link" to="/retos"><Swords className="ic" aria-hidden="true" />Mis retos<span aria-hidden="true">↗</span></Link>
            <Link className="profile-side-link" to="/zona"><MapPin className="ic" aria-hidden="true" />Tu zona<span aria-hidden="true">↗</span></Link>
          </section><p className="profile-local-note">Tu cuaderno comparte lo que tú publicas. La sincronización de todo el historial y las comparativas entre perfiles siguen pendientes.</p>
        </aside></div>
      </>}
      <Sheet open={editing} onClose={() => { if (!busy && !photoBusy) setEditing(false); }} title="Editar perfil" sub="Un perfil que suene a ti.">
        {draft && <div className="profile-editor">{editError && <Banner tone="error">{editError}</Banner>}
          <form aria-label="Editar perfil" onSubmit={save}><fieldset disabled={busy || photoBusy}>
            <Field label="Nombre visible" required maxLength={60} autoComplete="nickname" value={draft.display_name} onChange={e => setDraft({ ...draft, display_name: e.target.value })} />
            <Field label="Nombre de usuario" required minLength={3} maxLength={32} pattern="[a-z0-9_]{3,32}" help="Entre 3 y 32 letras minúsculas, números o guiones bajos." autoCapitalize="none" spellCheck={false} value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} />
            <label className="field"><span className="field-label">Sobre ti</span><textarea className="input" rows={3} maxLength={280} value={draft.bio} placeholder="Lo que te saca de casa. Tu puerto favorito. Tu manera de entender la bici." onChange={e => setDraft({ ...draft, bio: e.target.value })} /><span className="help">{draft.bio.length}/280 · Visible para los usuarios de la app.</span></label>
            <fieldset className="profile-modes"><legend>Mi manera de rodar</legend>{(Object.keys(RIDING_STYLES) as RidingStyle[]).map(mode => { const style = RIDING_STYLES[mode]; const Icon = style.icon; return <label key={mode} className="profile-mode"><input type="radio" name="riding-style" value={mode} checked={draft.riding_style === mode} onChange={() => setDraft({ ...draft, riding_style: mode })} /><Icon className="ic" aria-hidden="true" /><span>{style.label}</span></label>; })}</fieldset>
            <label className="field"><span className="field-label">Quién puede ver tus estadísticas</span><select className="input" value={draft.stats_visibility} onChange={e => setDraft({ ...draft, stats_visibility: e.target.value as Profile['stats_visibility'] })}><option value="everyone">Todos los usuarios de la app</option><option value="friends">Solo amigos aceptados</option></select><span className="help">Esta privacidad también protege las cifras de las salidas publicadas en tu cuaderno. Tus tracks y mapas de salidas son privados.</span></label>
            <button className="btn btn--primary btn--block" type="submit">{busy ? 'Guardando…' : 'Guardar perfil'}</button>
          </fieldset></form>
          {(profile?.avatar_version ?? 0) > 0 && <button className="btn btn--ghost" disabled={busy || photoBusy} onClick={() => void clearPhoto()}>Quitar foto de perfil</button>}
          <details className="profile-account"><summary>Tu cuenta y este dispositivo</summary><p>{account.user.email}</p><button className="btn btn--secondary btn--block btn--wrap" disabled={busy || photoBusy} onClick={() => void logout()}>Cerrar sesión en este dispositivo</button><p className="help">Los datos del historial siguen guardados en este dispositivo y separados por cuenta.</p></details>
        </div>}
      </Sheet>
    </>}
  </Page>;
}
