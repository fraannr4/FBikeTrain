import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchLikes, setLike, type LikeKind, type LikeState } from '../../social/likes';

const NONE: LikeState = { count: 0, liked: false };

/**
 * «Me gusta» de una lista de objetos del mismo tipo: una lectura para toda la lista y
 * escritura optimista, con vuelta atrás si el servidor la rechaza.
 */
export function useLikes(client: Pick<SupabaseClient, 'rpc' | 'from'>, userId: string, kind: LikeKind, ids: string[]) {
  const [state, setState] = useState<Record<string, LikeState>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const latest = useRef(state);
  latest.current = state;
  const inFlight = useRef(new Set<string>());
  const key = ids.join(',');

  useEffect(() => {
    if (!key) return;
    let live = true;
    // Si la lectura falla, cada botón sigue disponible a cero en lugar de bloquear la pantalla.
    fetchLikes(client, kind, key.split(',')).then(rows => { if (live) setState(previous => ({ ...previous, ...rows })); }, () => {});
    return () => { live = false; };
  }, [client, kind, key]);

  const get = useCallback((id: string): LikeState => state[id] ?? NONE, [state]);
  const isBusy = useCallback((id: string) => busy.has(id), [busy]);
  const hasFailed = useCallback((id: string) => failed.has(id), [failed]);

  const toggle = useCallback(async (id: string) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    const before = latest.current[id] ?? NONE;
    const next: LikeState = before.liked ? { count: Math.max(0, before.count - 1), liked: false } : { count: before.count + 1, liked: true };
    setState(previous => ({ ...previous, [id]: next }));
    setBusy(previous => new Set(previous).add(id));
    setFailed(previous => { const copy = new Set(previous); copy.delete(id); return copy; });
    try {
      await setLike(client, userId, kind, id, next.liked);
    } catch {
      setState(previous => ({ ...previous, [id]: before }));
      setFailed(previous => new Set(previous).add(id));
    } finally {
      inFlight.current.delete(id);
      setBusy(previous => { const copy = new Set(previous); copy.delete(id); return copy; });
    }
  }, [client, userId, kind]);

  return { get, toggle, isBusy, hasFailed };
}

export type Likes = ReturnType<typeof useLikes>;
