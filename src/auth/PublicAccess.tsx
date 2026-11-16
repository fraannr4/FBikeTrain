import { useSyncExternalStore, type ReactNode } from 'react';
import { Privacidad } from '../ui/pages/Privacidad';

function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

/** La política es pública: no monta Auth, la navegación privada ni consultas de actividades. */
export function PublicAccess({ children }: { children: ReactNode }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return hash.split('?')[0] === '#/privacidad' ? <Privacidad /> : children;
}
