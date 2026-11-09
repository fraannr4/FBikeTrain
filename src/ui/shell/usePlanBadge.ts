import { useEffect, useState } from 'react';
import { CALENDAR_CHANGED_EVENT, listWorkouts } from '../../calendar/calendarRepo';
import { localDay } from '../../metrics/calendar';

const DAY_MS = 86_400_000;

/** Entrenos sin hacer de hoy y de mañana: lo que «toca ya». */
export async function pendingSoon(now: number): Promise<number> {
  const today = localDay(now);
  const tomorrow = localDay(now + DAY_MS);
  const ws = await listWorkouts({ from: today, to: tomorrow });
  return ws.filter((w) => !w.done).length;
}

/**
 * Contador de la pestaña Plan. Se vuelve a leer al cambiar de pantalla (`reloadKey`) y cada vez que
 * se escribe en el calendario (`CALENDAR_CHANGED_EVENT`): al planificar, marcar, borrar o deshacer un
 * entreno sin salir de Plan, la barra ya lo refleja. Si la base falla, no hay contador.
 */
export function usePlanBadge(reloadKey?: unknown): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const read = () => {
      const mine = ++seq;
      pendingSoon(Date.now()).then(
        (v) => {
          if (alive && mine === seq) setN(v);
        },
        () => {
          if (alive && mine === seq) setN(0);
        },
      );
    };
    read();
    window.addEventListener(CALENDAR_CHANGED_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(CALENDAR_CHANGED_EVENT, read);
    };
  }, [reloadKey]);
  return n;
}
