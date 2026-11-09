import { createClient } from '@supabase/supabase-js';
import { consumeAuthCallback } from './callback';
import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from './config';
import { armFreshSignIn } from './useFreshSignIn';

export const accountClient = createClient(ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
});

// Singleton para no canjear dos veces un código de un solo uso con StrictMode.
let startup: Promise<void> | undefined;
export function initializeAccount(): Promise<void> {
  return startup ??= consumeAuthCallback(
    window.location.href,
    // Un enlace de confirmación puede abrirse en otra pestaña, sin la marca de sessionStorage.
    async (code) => {
      const r = await accountClient.auth.exchangeCodeForSession(code);
      if (!r.error && new URLSearchParams(window.location.search).get('auth') !== 'recovery') armFreshSignIn();
      return r;
    },
    (path) => window.history.replaceState(null, '', path),
  );
}
