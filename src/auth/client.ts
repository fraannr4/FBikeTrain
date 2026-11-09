import { createClient } from '@supabase/supabase-js';
import { consumeAuthCallback } from './callback';
import { ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY } from './config';

export const accountClient = createClient(ACCOUNT_PROJECT_URL, ACCOUNT_PUBLIC_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
});

// Singleton para no canjear dos veces un código de un solo uso con StrictMode.
let startup: Promise<void> | undefined;
export function initializeAccount(): Promise<void> {
  return startup ??= consumeAuthCallback(
    window.location.href,
    (code) => accountClient.auth.exchangeCodeForSession(code),
    (path) => window.history.replaceState(null, '', path),
  );
}
