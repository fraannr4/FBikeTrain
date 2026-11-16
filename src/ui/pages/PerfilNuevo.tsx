import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { loadSettings, saveSettings } from '../../settings/settings';
import { uploadAvatar } from '../../social/avatar';
import type { RidingStyle } from '../../social/journal';
import {
  DEFAULT_DISPLAY_NAME, USERNAME_FORMAT, USERNAME_HELP, USERNAME_RE, USERNAME_TAKEN, isDefaultUsername, updateOwnProfile,
} from '../../social/profileIdentity';
import { Camera } from '../icons';
import { Banner } from '../components/Banner';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { RIDING_STYLES, ridingStyle } from '../profile/profileStyle';
import '../styles/social.css';
import '../styles/profile.css';

type Loaded = { display_name: string; username: string; bio: string; riding_style: RidingStyle; avatar_version: number };
const LOAD_FAILED = 'No se pudo cargar tu perfil. Comprueba la conexión e inténtalo de nuevo.';
const PHOTO_FAILED = 'No se pudo subir la foto. Puedes añadirla más tarde desde tu perfil.';

/**
 * Paso de alta del perfil público: nombre visible y usuario obligatorios, y después foto y
 * descripción opcionales. Se pide tras el login si el usuario sigue siendo el provisional.
 */
export function PerfilNuevo() {
  const account = useAccount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const done = params.get('siguiente') === 'zona' ? '/zona' : '/';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<'identidad' | 'extras'>('identidad');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [style, setStyle] = useState<RidingStyle>('explorar');
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [nameError, setNameError] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!account) return;
    let live = true;
    setLoadError('');
    Promise.resolve()
      .then(() => account.client.from('profiles').select('username,display_name,bio,riding_style,avatar_version').eq('id', account.user.id).single())
      .then(({ data, error }) => {
        if (!live) return;
        if (error || !data) { setLoadError(LOAD_FAILED); return; }
        const row = data as { username: string; display_name: string; bio?: string | null; riding_style?: string; avatar_version?: number | null };
        const next: Loaded = {
          display_name: row.display_name === DEFAULT_DISPLAY_NAME ? '' : row.display_name ?? '',
          username: isDefaultUsername(account.user.id, row.username) ? '' : row.username,
          bio: row.bio ?? '',
          riding_style: ridingStyle(row.riding_style),
          avatar_version: row.avatar_version ?? 0,
        };
        setLoaded(next);
        setName(next.display_name);
        setUsername(next.username);
        setBio(next.bio);
        setStyle(next.riding_style);
        setAvatarVersion(next.avatar_version);
      })
      .catch(() => { if (live) setLoadError(LOAD_FAILED); });
    return () => { live = false; };
  }, [account, attempt]);

  useEffect(() => { if (stage === 'extras') heading.current?.focus(); }, [stage]);

  async function saveIdentity(e: FormEvent) {
    e.preventDefault();
    if (!account || busy) return;
    const display = name.trim();
    const handle = username.trim();
    const badName = display ? '' : 'Escribe el nombre que verán los demás ciclistas.';
    const badHandle = USERNAME_RE.test(handle) ? '' : USERNAME_FORMAT;
    setNameError(badName);
    setUsernameError(badHandle);
    setSaveError('');
    if (badName || badHandle) return;
    setBusy(true);
    try {
      const failed = await updateOwnProfile(account.client, account.user.id, { display_name: display, username: handle });
      if (failed === USERNAME_TAKEN) { setUsernameError(failed); return; }
      if (failed) { setSaveError(failed); return; }
      setName(display);
      setUsername(handle);
      setStage('extras');
      // El saludo local es una comodidad: si el almacenamiento falla, el perfil ya está guardado.
      loadSettings().then((s) => saveSettings({ ...s, displayName: display })).catch(() => {});
    } catch {
      setSaveError('No se pudo guardar el perfil. Comprueba la conexión.');
    } finally {
      setBusy(false);
    }
  }

  async function photo(file: File | undefined) {
    if (!account || !file || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      setAvatarVersion(await uploadAvatar(account.client, account.user.id, file));
    } catch (err) {
      setPhotoError(err instanceof Error && err.message ? err.message : PHOTO_FAILED);
    } finally {
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }

  async function saveExtras(e: FormEvent) {
    e.preventDefault();
    if (!account || !loaded || busy || photoBusy) return;
    const text = bio.trim();
    if (text === loaded.bio.trim() && style === loaded.riding_style) { navigate(done, { replace: true }); return; }
    setBusy(true);
    setSaveError('');
    try {
      const failed = await updateOwnProfile(account.client, account.user.id, { bio: text, riding_style: style });
      if (failed) { setSaveError(failed); return; }
      navigate(done, { replace: true });
    } catch {
      setSaveError('No se pudo guardar el perfil. Comprueba la conexión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Tu perfil ciclista"
      variant="narrow"
      className="page--perfil-nuevo"
      kicker={stage === 'identidad' ? 'Paso 1 de 2' : 'Paso 2 de 2'}
      lead="Así te verán los demás en Ciclistas y en los retos."
    >
      {!account ? (
        <p>Inicia sesión para configurar tu perfil.</p>
      ) : loadError ? (
        <Banner tone="error" action={<button className="btn btn--ghost" onClick={() => setAttempt((n) => n + 1)}>Reintentar</button>}>{loadError}</Banner>
      ) : !loaded ? (
        <p role="status">Cargando tu perfil…</p>
      ) : stage === 'identidad' ? (
        <form className="card zona-card" onSubmit={saveIdentity} noValidate aria-label="Tu nombre en la comunidad">
          <h2 className="profile-setup-h">Tu nombre en la comunidad</h2>
          <fieldset className="profile-setup-fields" disabled={busy}>
            <Field label="Nombre visible" required maxLength={60} autoComplete="nickname" autoCapitalize="words" value={name} error={nameError || undefined}
              help="Tu nombre o como te conocen en la grupeta." onChange={(e) => setName(e.target.value)} />
            <Field label="Nombre de usuario" required minLength={3} maxLength={32} autoComplete="username" autoCapitalize="none" spellCheck={false}
              value={username} error={usernameError || undefined} help={USERNAME_HELP}
              onChange={(e) => setUsername(e.target.value.toLowerCase())} />
          </fieldset>
          {saveError ? <Banner tone="error">{saveError}</Banner> : null}
          <div className="zona-actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Guardando…' : 'Continuar'}</button>
          </div>
        </form>
      ) : (
        <form className="card zona-card" onSubmit={saveExtras} aria-label="Foto y descripción">
          <h2 className="profile-setup-h" ref={heading} tabIndex={-1}>Ponle cara a tu perfil</h2>
          <p className="help">Opcional. Puedes hacerlo ahora o más tarde desde tu perfil.</p>
          <div className="profile-setup-photo">
            <ProfileAvatar client={account.client} userId={account.user.id} name={name} version={avatarVersion} size="large" />
            <input ref={photoInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Archivo de foto de perfil" tabIndex={-1}
              onChange={(e) => void photo(e.target.files?.[0])} />
            <button type="button" className="btn btn--secondary" disabled={photoBusy || busy} onClick={() => photoInput.current?.click()}>
              <Camera className="ic" aria-hidden="true" />{avatarVersion > 0 ? 'Cambiar foto' : 'Elegir foto'}
            </button>
          </div>
          {photoBusy ? <p className="help" role="status">Preparando tu foto…</p> : null}
          {photoError ? <Banner tone="error">{photoError}</Banner> : null}
          <fieldset className="profile-setup-fields" disabled={busy}>
            <label className="field"><span className="field-label">Sobre ti</span>
              <textarea className="input" rows={3} maxLength={280} value={bio} placeholder="Lo que te saca de casa. Tu puerto favorito. Tu manera de entender la bici." onChange={(e) => setBio(e.target.value)} />
              <span className="help">{bio.length}/280 · Visible para los usuarios de la app.</span>
            </label>
            <fieldset className="profile-modes"><legend>Mi manera de rodar</legend>
              {(Object.keys(RIDING_STYLES) as RidingStyle[]).map((mode) => {
                const item = RIDING_STYLES[mode];
                const Icon = item.icon;
                return <label key={mode} className="profile-mode"><input type="radio" name="riding-style" value={mode} checked={style === mode} onChange={() => setStyle(mode)} /><Icon className="ic" aria-hidden="true" /><span>{item.label}</span></label>;
              })}
            </fieldset>
          </fieldset>
          {saveError ? <Banner tone="error">{saveError}</Banner> : null}
          <div className="zona-actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || photoBusy}>{busy ? 'Guardando…' : 'Guardar y empezar'}</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => navigate(done, { replace: true })}>Más tarde</button>
          </div>
        </form>
      )}
    </Page>
  );
}
