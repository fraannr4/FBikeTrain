import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { db, useDatabase } from '../db/db';
import { accountDatabaseName } from '../db/accountDatabase';
import { AccountFrame, AuthScreen } from './AuthScreen';
import { CyclingLoader } from '../ui/components/CyclingLoader';

type Account = { client: SupabaseClient; user: User };
export const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext);
const reloadPage = () => window.location.reload();

function Workspace({ account, children }: { account: Account; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    useDatabase(accountDatabaseName(account.user.id));
    db.open().then(() => { if (live) setReady(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [account.user.id]);
  if (failed) return <AccountFrame><h1>No se pueden abrir tus datos</h1><p>Comprueba el espacio disponible y que el navegador permita guardar datos.</p><button className="btn btn--primary" onClick={() => window.location.reload()}>Reintentar</button></AccountFrame>;
  if (!ready) return <AccountFrame><CyclingLoader label="Abriendo tus datos…" /></AccountFrame>;
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

/** Guardia de producción: nunca monta páginas, hooks de datos ni navegación antes de Auth. */
export function AccountBoundary({ client, initialize, children, reload = reloadPage }: {
  client: SupabaseClient; initialize: () => Promise<void>; children: ReactNode; reload?: () => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
      if (initialized) { setUser(session?.user ?? null); setError(''); }
    });
    initialize().then(async () => {
      initialized = true;
      const current = revision;
      const { data, error: err } = await client.auth.getSession();
      if (!live) return;
      if (err) throw err;
      if (revision === current) setUser(data.session?.user ?? null);
    }).catch(() => {
      initialized = true;
      if (live) { setUser(null); setError('No se pudo recuperar el acceso. Vuelve a entrar para continuar.'); }
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
  return <Workspace key={user.id} account={{ client, user }}>{children}</Workspace>;
}
