import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../../domain/types';
import { getTrack } from '../../db/repo';
import { RouteShape } from '../charts/RouteShape';

/** Puntos que se guardan por miniatura: de sobra para 48 px y poca memoria con miles de salidas. */
const MAX_POINTS = 240;
const NO_POINTS: LatLng[] = [];
const cache = new Map<string, LatLng[]>();

function thin(points: { lat?: number; lng?: number }[]): LatLng[] {
  const geo = points.filter((p): p is LatLng => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const step = Math.max(1, Math.ceil(geo.length / MAX_POINTS));
  return geo.filter((_, i) => i % step === 0 || i === geo.length - 1).map(({ lat, lng }) => ({ lat, lng }));
}

// Un solo observador para todas las filas: con 5.000 salidas, no 5.000 observadores.
let io: IntersectionObserver | null = null;
const onVisible = new Map<Element, () => void>();
function watch(el: Element, cb: () => void): () => void {
  if (!io)
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io?.unobserve(e.target);
          onVisible.get(e.target)?.();
          onVisible.delete(e.target);
        }
      },
      { rootMargin: '300px 0px' },
    );
  onVisible.set(el, cb);
  io.observe(el);
  return () => {
    io?.unobserve(el);
    onVisible.delete(el);
  };
}

/**
 * Forma de la salida en la fila, sobre curvas de nivel. El track se lee de la base solo cuando la fila
 * va a entrar en pantalla, y se guarda aligerado para la próxima vez. Sin IntersectionObserver, quedan
 * las curvas de nivel.
 */
export function RideThumb({ id }: { id: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [points, setPoints] = useState(() => cache.get(id) ?? null);

  useEffect(() => {
    const el = ref.current;
    if (points || !el || typeof IntersectionObserver !== 'function') return;
    let alive = true;
    const stop = watch(el, () => {
      getTrack(id).then(
        (track) => {
          const p = thin(track ?? []);
          cache.set(id, p);
          if (alive) setPoints(p);
        },
        () => {},
      );
    });
    return () => {
      alive = false;
      stop();
    };
  }, [id, points]);

  return (
    <span ref={ref} className="ride-thumb">
      <RouteShape points={points ?? NO_POINTS} size="fill" />
    </span>
  );
}
