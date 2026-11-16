import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAccount } from '../../auth/AccountBoundary';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { User } from '../icons';
import '../styles/profile.css';

type Identity = { display_name: string; avatar_version: number };
/** Una lectura por cuenta y sesión: la cabecera se repinta en cada pantalla. */
const cache = new Map<string, Promise<Identity | null>>();

/** Tras editar el nombre o la foto, la cabecera vuelve a leer el perfil. */
export function forgetOwnProfile() {
  cache.clear();
}

function ownIdentity(client: SupabaseClient, userId: string): Promise<Identity | null> {
  let pending = cache.get(userId);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => client.from('profiles').select('display_name,avatar_version').eq('id', userId).single())
      .then(({ data, error }) => (error || !data ? null : { display_name: data.display_name ?? '', avatar_version: data.avatar_version ?? 0 }))
      .catch(() => null);
    pending.then((v) => { if (!v) cache.delete(userId); });
    cache.set(userId, pending);
  }
  return pending;
}

/** Tu foto arriba a la derecha de las pantallas raíz del móvil: abre el perfil. En PC lo lleva el carril. */
export function OwnProfileButton({ className = 'icon-btn appbar-profile' }: { className?: string }) {
  const account = useAccount();
  const [me, setMe] = useState<Identity | null>(null);
  const client = account?.client;
  const userId = account?.user.id;
  useEffect(() => {
    if (!client || !userId) return;
    let live = true;
    void ownIdentity(client, userId).then((v) => { if (live) setMe(v); });
    return () => { live = false; };
  }, [client, userId]);
  if (!account) return null;
  return (
    <Link className={className} to="/perfil" aria-label="Tu perfil">
      {me ? (
        <ProfileAvatar client={account.client} userId={account.user.id} name={me.display_name} version={me.avatar_version} />
      ) : (
        <User className="ic" aria-hidden="true" />
      )}
    </Link>
  );
}
