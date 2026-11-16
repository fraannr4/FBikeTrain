import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { db, useDatabase } from '../db/db';
import { accountDatabaseName } from '../db/accountDatabase';
import { AccountFrame, AuthScreen } from './AuthScreen';
import { CyclingLoader } from '../ui/components/CyclingLoader';
import { WelcomeScene, welcomeName } from './WelcomeScene';
import { takeFreshSignIn } from './useFreshSignIn';
import { restoreSharedLocation } from '../pwa/sharedFiles';
import { zonaSkippedRecently } from '../social/profileArea';
import { needsProfileSetup } from '../social/profileIdentity';

export type Account = { client: SupabaseClient; user: User };
export const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext);
const reloadPage = () => window.location.reload();

/** El perfil solo cambia el saludo si llega antes de que aparezca; nunca retrasa la escena. */
const PROFILE_NAME_DEADLINE_MS = 800;
type Phase = 'welcome' | 'leaving' | 'app';

function Workspace({ account, welcome, children }: { account: Account; welcome: boolean; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>(welcome ? 'welcome' : 'app');
  const [name, setName] = useState(() => welcomeName(account.user));
  useEffect(() => {
    let live = true;
    // Antes de montar HashRouter, restaura el destino si OAuth sustituyó el hash.
    restoreSharedLocation();
    useDatabase(accountDatabaseName(account.user.id));
    db.open().then(() => { if (live) setReady(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [account.user.id]);
  const { client, user } = account;
  useEffect(() => {
    if (!welcome) return;
    let live = true;
    const deadline = setTimeout(() => { live = false; }, PROFILE_NAME_DEADLINE_MS);
    Promise.resolve()
      .then(() => client.from('profiles').select('display_name').eq('id', user.id).single())
      .then(({ data }) => { if (live) setName(welcomeName(user, (data as { display_name?: string } | null)?.display_name)); })
      .catch(() => { /* sin perfil: se queda el nombre de los metadatos o del correo */ });
    return () => { live = false; clearTimeout(deadline); };
    // Una sola consulta por escena: Workspace se monta de nuevo con cada usuario (key).
  }, [welcome, client]);
  // Tras la bienvenida, y solo si se entra por Inicio, se piden una vez los pasos que faltan: primero
  // el perfil público (la comunidad lista a todos los registrados), después el pueblo. Un enlace a otra
  // pantalla (un fichero compartido) no se interrumpe. Sin red, no se pregunta.
  const [onboarding, setOnboarding] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const profile = user.is_anonymous ? Promise.resolve(false) : Promise.resolve()
      // Sin reintentos: un fallo de red no debe retrasar varios segundos el paso de la zona.
      .then(() => client.from('profiles').select('username,display_name').eq('id', user.id).retry(false).single())
      .then(({ data, error }) => !error && needsProfileSetup(user.id, data))
      .catch(() => false);
    const zona = zonaSkippedRecently(Date.now()) ? Promise.resolve(false) : Promise.resolve()
      .then(() => client.rpc('my_area'))
      .then(({ data, error }) => {
        const row = (Array.isArray(data) ? data[0] : data) as { locality?: string | null } | null;
        return !error && Boolean(row) && !row?.locality;
      })
      .catch(() => false);
    void Promise.all([profile, zona]).then(([needsProfile, needsZona]) => {
      if (!live) return;
      if (needsProfile) setOnboarding(needsZona ? '#/perfil/nuevo?siguiente=zona' : '#/perfil/nuevo');
      else if (needsZona) setOnboarding('#/zona');
    });
    return () => { live = false; };
    // Una sola comprobación por cuenta: Workspace se monta de nuevo con cada usuario (key).
  }, [client]);
  useEffect(() => {
    if (!onboarding || !ready || phase !== 'app') return;
    setOnboarding(null);
    const path = window.location.hash.replace(/^#/, '').split('?')[0];
    if (path === '' || path === '/') window.location.hash = onboarding;
  }, [onboarding, ready, phase]);
  if (failed) return <AccountFrame><h1>No se pueden abrir tus datos</h1><p>Comprueba el espacio disponible y que el navegador permita guardar datos.</p><button className="btn btn--primary" onClick={() => window.location.reload()}>Reintentar</button></AccountFrame>;
  // La escena corre en paralelo con la apertura de la base; si al salir no está lista, queda el loader.
  const scene = phase !== 'app' && <WelcomeScene name={name} onLeave={() => setPhase('leaving')} onDone={() => setPhase('app')} />;
  if (phase === 'welcome') return <>{null}{scene}</>;
  const body = ready
    ? <AccountContext.Provider value={account}>{children}</AccountContext.Provider>
    : <AccountFrame><CyclingLoader label="Abriendo tus datos…" /></AccountFrame>;
  return <>{body}{scene}</>;
}

/** Guardia de producción: nunca monta páginas, hooks de datos ni navegación antes de Auth. */
export function AccountBoundary({ client, initialize, children, reload = reloadPage }: {
  client: SupabaseClient; initialize: () => Promise<void>; children: ReactNode; reload?: () => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [welcome, setWelcome] = useState(false);
  const [recovery, setRecovery] = useState(new URLSearchParams(window.location.search).get('auth') === 'recovery');
  const bound = useRef<string>();
  const switching = Boolean(user && bound.current && bound.current !== user.id);

  useEffect(() => { if (switching) reload(); }, [switching, reload]);
  useEffect(() => {
    let live = true;
    let initialized = false;
    let revision = 0;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      revision++;
      if (!live) return;
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (!initialized) return;
      // Solo un SIGNED_IN precedido por una acción real; nunca INITIAL_SESSION ni el de volver a la pestaña.
      if (!session) setWelcome(false);
      else if (event === 'SIGNED_IN' && takeFreshSignIn()) setWelcome(true);
      setUser(session?.user ?? null); setError('');
    });
    initialize().then(async () => {
      initialized = true;
      const current = revision;
      const { data, error: err } = await client.auth.getSession();
      if (!live) return;
      if (err) throw err;
      if (revision !== current) return;
      // Vuelta del enlace de correo: la marca se armó antes de salir o al canjear el código.
      if (data.session && takeFreshSignIn()) setWelcome(true);
      setUser(data.session?.user ?? null);
    }).catch(async () => {
      initialized = true;
      // Un enlace caducado o abierto en otro navegador no debe cerrar una sesión que sigue válida.
      const { data } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
      if (!live) return;
      if (data.session) { setUser(data.session.user); return; }
      setUser(null);
      setError('No se pudo completar el acceso con este enlace. Ábrelo en el mismo navegador donde lo pediste o vuelve a solicitarlo.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; subscription.unsubscribe(); };
  }, [client, initialize]);

  if (loading || switching) return <AccountFrame><CyclingLoader label="Preparando tu cuenta…" /></AccountFrame>;
  if (!user || recovery) return <AuthScreen key={recovery ? 'recovery' : error} client={client} recovery={Boolean(user && recovery)} initialError={error} onRecovered={() => {
    const url = new URL(window.location.href); url.searchParams.delete('auth');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setRecovery(false);
  }} />;
  bound.current ??= user.id;
  return <Workspace key={user.id} account={{ client, user }} welcome={welcome}>{children}</Workspace>;
}
