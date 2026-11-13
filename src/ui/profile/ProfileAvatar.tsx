import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { avatarBlob } from '../../social/avatar';

export function ProfileAvatar({ client, userId, name, version = 0, size = 'small', className = '' }: {
  client: SupabaseClient;
  userId: string;
  name: string;
  version?: number;
  size?: 'small' | 'large';
  className?: string;
}) {
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState('');
  const key = `${userId}:${version}`;
  useEffect(() => {
    let live = true;
    let url: string | undefined;
    setPhoto(null);
    setFailed('');
    avatarBlob(client, userId, version).then(blob => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setPhoto({ key, url });
    }).catch(() => { /* Una foto caída nunca bloquea la identidad ni el cuaderno. */ });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [client, userId, version, key]);
  const visible = photo?.key === key && failed !== key ? photo : null;
  return <span className={`profile-avatar profile-avatar--${size} ${className}`}>
    {visible ? <img src={visible.url} alt={`Foto de ${name}`} onError={() => setFailed(key)} />
      : <span aria-hidden="true">{Array.from(name.trim())[0]?.toLocaleUpperCase('es') || '?'}</span>}
  </span>;
}
