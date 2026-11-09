import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Field } from '../ui/components/Field';
import { Eye, EyeOff, Lock } from '../ui/icons';
import { BrandMark } from '../ui/shell/BrandMark';
import { ThemeToggle } from '../ui/shell/ThemeToggle';
import { callbackUrl } from './callback';
import { armFreshSignIn, disarmFreshSignIn } from './useFreshSignIn';

type Mode = 'login' | 'signup' | 'reset' | 'password';

/** Decorado del acceso: curvas sintéticas, sin coordenadas ni datos del usuario. */
function AccountContours() {
  return <svg className="account-contours" viewBox="0 0 600 680" preserveAspectRatio="none" fill="none" aria-hidden="true" focusable="false">
    <g className="account-contour-lines">
      {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${-170 + i * 22} 740C${90 + i * 12} 520 ${-30 + i * 16} 480 ${150 + i * 12} 400S${245 + i * 11} 190 ${410 + i * 12} 150S${500 + i * 12} 30 ${720 + i * 10} -40`} />)}
      <path d="M210 650C260 520 420 565 420 430S300 335 385 265S530 275 565 170M250 680C285 555 465 595 463 438S351 340 419 292S568 312 600 195" />
    </g>
    <path className="account-route-under" d="M65 690C180 580 110 535 245 475S290 340 370 320S490 375 505 320L565 285" />
    <path className="account-route-line" pathLength="1" d="M65 690C180 580 110 535 245 475S290 340 370 320S490 375 505 320L565 285" />
    <circle className="account-route-point" cx="565" cy="285" r="8" />
  </svg>;
}

export function AccountFrame({ children }: { children: ReactNode }) {
  return <main className="account-page">
    <header className="account-brand"><span><BrandMark /> FBikeTrain</span><ThemeToggle /></header>
    <div className="account-layout">
      <section className="account-landscape" aria-label="Tu ciclismo, a tu ritmo">
        <AccountContours />
        <div className="account-promise"><p>Tu próxima cima<br />empieza aquí.</p><span>Salidas, progresión y rutas.<br />Tu ciclismo, a tu ritmo.</span></div>
      </section>
      <section className="account-card">{children}</section>
    </div>
  </main>;
}

export function authMessage(error: unknown): string {
  const e = error as { code?: string; status?: number };
  if (e?.code === 'invalid_credentials') return 'El correo o la contraseña no son correctos.';
  if (e?.code === 'email_not_confirmed') return 'Confirma tu correo antes de entrar. Revisa también la carpeta de spam.';
  if (e?.code === 'user_already_exists') return 'No se pudo crear la cuenta. Prueba a entrar o recuperar la contraseña.';
  if (e?.status === 429) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
  if (e?.code === 'weak_password') return 'Elige una contraseña más larga y difícil de adivinar.';
  return 'No se pudo completar la operación. Comprueba la conexión e inténtalo de nuevo.';
}

export function AuthScreen({ client, recovery = false, initialError = '', onRecovered }: {
  client: SupabaseClient; recovery?: boolean; initialError?: string; onRecovered?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(recovery ? 'password' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (recovery) { setMode('password'); setError(''); setNotice(''); } }, [recovery]);
  const change = (next: Mode) => { setMode(next); setError(''); setNotice(''); setPassword(''); setVisible(false); };
  const title = { login: 'Vuelve a tu ritmo', signup: 'Empieza tu camino', reset: 'Recupera tu acceso', password: 'Tu nueva contraseña' }[mode];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'reset') {
        const r = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: callbackUrl(window.location.href, true) });
        if (r.error) throw r.error;
        setNotice('Si existe una cuenta con ese correo, recibirás un enlace para recuperar el acceso.');
      } else if (mode === 'password') {
        const r = await client.auth.updateUser({ password });
        if (r.error) throw r.error;
        setPassword(''); onRecovered?.();
      } else if (mode === 'signup') {
        armFreshSignIn();
        const r = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callbackUrl(window.location.href) } });
        if (r.error) throw r.error;
        // Con confirmación por correo no hay sesión: la marca se arma al canjear el enlace.
        if (!r.data.session) disarmFreshSignIn();
        setPassword('');
        setNotice('Revisa tu correo para confirmar la cuenta. Si ya estabas registrado, prueba a entrar o recuperar el acceso.');
      } else {
        armFreshSignIn();
        const r = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (r.error) throw r.error;
        setPassword('');
      }
    } catch (err) { disarmFreshSignIn(); setError(authMessage(err)); }
    finally { setBusy(false); }
  }

  async function google() {
    setBusy(true); setError('');
    try {
      armFreshSignIn();
      const r = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(window.location.href) } });
      if (r.error) throw r.error;
    } catch (err) { disarmFreshSignIn(); setError(authMessage(err)); setBusy(false); }
  }

  return <AccountFrame>
    <h1>{title}</h1>
    <p className="account-intro">{mode === 'reset' ? 'Te enviaremos un enlace para cambiar tu contraseña.' : mode === 'password' ? 'Elige una contraseña de al menos 10 caracteres.' : 'Entra en tu cuenta para seguir con tus salidas y tu progresión.'}</p>
    {(mode === 'login' || mode === 'signup') && <><button type="button" className="btn btn--outline btn--block" disabled={busy} onClick={google}>Continuar con Google</button><div className="account-divider"><span>o con tu correo</span></div></>}
    <form onSubmit={submit} className="account-form" aria-label={mode === 'signup' ? 'Crear cuenta' : mode === 'reset' ? 'Recuperar acceso' : mode === 'password' ? 'Cambiar contraseña' : 'Entrar'}>
      <fieldset disabled={busy}>
        {mode !== 'password' && <Field label="Correo electrónico" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />}
        {mode !== 'reset' && <Field label={mode === 'password' ? 'Nueva contraseña' : 'Contraseña'} type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 10} value={password} onChange={e => setPassword(e.target.value)} inlineAction={<button type="button" className="icon-btn" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="ic" /> : <Eye className="ic" />}</button>} />}
        {mode === 'login' && <button className="btn btn--ghost account-forgot" type="button" onClick={() => change('reset')}>¿Has olvidado tu contraseña?</button>}
        <button className="btn btn--primary btn--block" type="submit">{busy ? 'Un momento…' : mode === 'signup' ? 'Crear cuenta' : mode === 'reset' ? 'Enviar enlace' : mode === 'password' ? 'Guardar contraseña' : 'Entrar'}</button>
      </fieldset>
    </form>
    {error && <p className="account-error" role="alert">{error}</p>}
    {notice && <p className="account-notice" role="status">{notice}</p>}
    {mode !== 'password' && <p className="account-switch">{mode === 'login' ? '¿Aún no tienes cuenta?' : '¿Ya tienes cuenta?'} <button type="button" disabled={busy} className="btn btn--ghost" onClick={() => change(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Crear cuenta' : 'Entrar'}</button></p>}
    <p className="account-privacy"><Lock className="ic" aria-hidden="true" />Tus tracks son privados. Podrás elegir quién ve tus estadísticas.</p>
  </AccountFrame>;
}
