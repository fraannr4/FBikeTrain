import { useEffect, useState } from 'react';
import { WRITE_ERROR } from '../../social/likes';
import { formatCount } from '../format';
import { Heart } from '../icons';
import type { Likes } from './useLikes';
import '../styles/likes.css';

type Props = {
  count: number;
  liked: boolean;
  onToggle: () => void;
  /** Un toque ya está en vuelo: no se admite otro hasta que termine. */
  busy?: boolean;
  /** El servidor rechazó el último toque; el botón ya ha vuelto a su estado anterior. */
  failed?: boolean;
};

/** Corazón con recuento. El nombre accesible cambia con el estado y lleva el recuento. */
export function LikeButton({ count, liked, onToggle, busy = false, failed = false }: Props) {
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (!pop) return;
    const timer = window.setTimeout(() => setPop(false), 400);
    return () => window.clearTimeout(timer);
  }, [pop]);
  const verb = liked ? 'Quitar me gusta' : 'Me gusta';
  const label = count > 0 ? `${verb}, ${formatCount(count)}` : verb;
  return <span className="like">
    <button type="button" className="like-btn" aria-pressed={liked} aria-label={label} data-pop={pop || undefined}
      onClick={() => { if (busy) return; if (!liked) setPop(true); onToggle(); }}>
      <Heart className="ic like-heart" aria-hidden="true" />
      {count > 0 && <span className="like-count" aria-hidden="true">{formatCount(count)}</span>}
    </button>
    {failed && <span className="like-error" role="alert">{WRITE_ERROR}</span>}
  </span>;
}

/** El botón conectado a useLikes para un id concreto. */
export function LikeFor({ likes, id }: { likes: Likes; id: string }) {
  const { count, liked } = likes.get(id);
  return <LikeButton count={count} liked={liked} busy={likes.isBusy(id)} failed={likes.hasFailed(id)} onToggle={() => void likes.toggle(id)} />;
}
