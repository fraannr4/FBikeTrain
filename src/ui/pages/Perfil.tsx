import { useEffect, useState, type FormEvent } from 'react';
import { useAccount } from '../../auth/AccountBoundary';
import { authMessage } from '../../auth/AuthScreen';
import { loadSettings, saveSettings } from '../../settings/settings';
import { Field } from '../components/Field';
import { Page } from '../components/Page';

type Profile = { username: string; display_name: string; stats_visibility: 'everyone' | 'friends' };

export function Perfil() {
  const account = useAccount();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!account) return;
    let live = true;
    setError('');
    account.client.from('profiles').select('username,display_name,stats_visibility').eq('id', account.user.id).single()
      .then(({ data, error: err }) => {
        if (!live) return;
        if (err) setError('No se pudo cargar tu perfil. Inténtalo de nuevo.');
        else setProfile(data as Profile);
      });
    return () => { live = false; };
  }, [account?.user.id, attempt]); // La identidad cambia con una recarga completa.

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!account || !profile || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = { ...profile, display_name: profile.display_name.trim() };
      if (!next.display_name) { setError('Escribe un nombre para tu perfil.'); return; }
      const { data, error: err } = await account.client.from('profiles').update(next).eq('id', account.user.id).select('id').single();
      if (err || !data) {
        setError(err?.code === '23505' ? 'Ese nombre de usuario ya está ocupado. Elige otro.' : 'No se pudo guardar el perfil. Inténtalo de nuevo.');
        return;
      }
      setProfile(next);
      setNotice('Perfil guardado.');
      // Solo el nombre de la cuenta se refleja en el saludo local; las claves nunca se envían.
      try { const settings = await loadSettings(); await saveSettings({ ...settings, displayName: next.display_name }); }
      catch { setNotice('Perfil guardado. El saludo local se actualizará cuando el almacenamiento vuelva a estar disponible.'); }
    } catch { setError('No se pudo guardar el perfil. Comprueba la conexión.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (!account) return;
    setBusy(true); setError('');
    try { const { error: err } = await account.client.auth.signOut({ scope: 'local' }); if (err) throw err; }
    catch (err) { setError(authMessage(err)); }
    finally { setBusy(false); }
  }

  return <Page title="Tu perfil" back="/mas" variant="narrow" lead="Tu identidad en la comunidad.">
    {!account ? <p>Inicia sesión para ver tu perfil.</p> : <>
      {profile ? <form className="card account-profile" onSubmit={save} aria-label="Editar perfil"><fieldset disabled={busy}>
        <Field label="Nombre visible" required maxLength={60} autoComplete="nickname" value={profile.display_name} onChange={e => setProfile({ ...profile, display_name: e.target.value })} />
        <Field label="Nombre de usuario" required minLength={3} maxLength={32} pattern="[a-z0-9_]{3,32}" help="Entre 3 y 32 letras minúsculas, números o guiones bajos." autoCapitalize="none" spellCheck={false} value={profile.username} onChange={e => setProfile({ ...profile, username: e.target.value })} />
        <label className="field"><span className="field-label">Quién puede ver tus estadísticas</span><select className="input" value={profile.stats_visibility} onChange={e => setProfile({ ...profile, stats_visibility: e.target.value as Profile['stats_visibility'] })}><option value="everyone">Todos los usuarios de la app</option><option value="friends">Solo amigos aceptados</option></select></label>
        <p className="help">Tus tracks y mapas de salidas seguirán siendo privados.</p>
        <button className="btn btn--primary" type="submit">{busy ? 'Guardando…' : 'Guardar perfil'}</button>
      </fieldset></form> : !error && <p role="status">Cargando tu perfil…</p>}
      {error && <div role="alert"><p className="account-error">{error}</p>{!profile && <button className="btn btn--outline" onClick={() => setAttempt(attempt + 1)}>Reintentar</button>}</div>}
      {notice && <p role="status">{notice}</p>}
      <section className="card account-profile"><h2>Tu cuenta</h2><p className="help">{account.user.email}</p><button className="btn btn--outline" disabled={busy} onClick={logout}>Cerrar sesión en este dispositivo</button><p className="help">Los datos locales se conservan separados por cuenta. Si usabas la app antes del registro, tus datos anteriores siguen guardados: su incorporación a la cuenta estará disponible con la sincronización.</p></section>
    </>}
  </Page>;
}
