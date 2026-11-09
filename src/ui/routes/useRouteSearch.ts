import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../../auth/AccountBoundary';
import { listActivities } from '../../db/repo';
import type { LatLng } from '../../domain/types';
import { computeReference } from '../../metrics/reference';
import type { Target } from '../../metrics/score';
import { DEFAULT_SEEDS, generateRoutes, type GenerateResult } from '../../routes/generator';
import { loadVisitedCells } from '../../routes/history';
import { fetchRoundTrip, OrsError, type OrsErrorKind } from '../../routes/ors';
import { chooseOrsAccess } from '../../routes/orsProxy';
import { loadSettings } from '../../settings/settings';

/** Peticiones a ORS hechas y previstas en la búsqueda en curso. */
export type SearchProgress = { done: number; total: number };

export type RouteSearch = {
  run: (start: LatLng, t: Target, opts?: { count?: number; seeds?: number }) => Promise<GenerateResult | null>;
  /** Deja de pedir candidatas; la búsqueda en curso devuelve `null`. */
  cancel: () => void;
  busy: boolean;
  /** Texto para el usuario si la última búsqueda falló. */
  error: string | null;
  errorKind: OrsErrorKind | null;
  progress: SearchProgress | null;
};

/** Error interno con el que se corta una búsqueda cancelada. */
class SearchCancelled extends Error {}

/**
 * Búsqueda de rutas por el servicio común (con cuenta y el modo activado) o con la clave de Ajustes,
 * con la referencia del historial y sus celdas visitadas.
 * Las celdas se leen una vez por pantalla: recorrer los tracks es lo caro. Cancelar no corta la
 * petición que ya está en vuelo, pero no se pide ninguna más.
 */
export function useRouteSearch(): RouteSearch {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; kind: OrsErrorKind | null } | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const visited = useRef<Promise<Set<string>> | null>(null);
  const current = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      current.current++; // la búsqueda en curso deja de pedir candidatas
    };
  }, []);

  const cancel = useCallback(() => {
    current.current++;
    setBusy(false);
    setProgress(null);
  }, []);

  const run = useCallback<RouteSearch['run']>(async (start, target, opts = {}) => {
    const id = ++current.current;
    const live = () => alive.current && current.current === id;
    const total = opts.seeds ?? DEFAULT_SEEDS;
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total });
    try {
      visited.current ??= loadVisitedCells();
      const [settings, acts, cells] = await Promise.all([loadSettings(), listActivities(), visited.current]);
      let done = 0;
      const result = await generateRoutes(
        { start, target, count: opts.count, seeds: opts.seeds },
        {
          apiKey: chooseOrsAccess(settings.ors.apiKey, account),
          reference: computeReference(acts, Date.now()),
          visited: cells,
          fetchRoundTrip: async (key, req) => {
            if (!live()) throw new SearchCancelled();
            try {
              return await fetchRoundTrip(key, req);
            } finally {
              done++;
              if (live()) setProgress({ done, total });
            }
          },
        },
      );
      return live() ? result : null;
    } catch (e) {
      if (!live() || e instanceof SearchCancelled) return null;
      if (e instanceof OrsError) setError({ text: e.message, kind: e.kind });
      else setError({ text: 'Ha fallado algo inesperado al preparar las rutas. Vuelve a probar en un momento.', kind: null });
      return null;
    } finally {
      if (live()) {
        setBusy(false);
        setProgress(null);
      }
    }
  }, [account]);

  return { run, cancel, busy, error: error?.text ?? null, errorKind: error?.kind ?? null, progress };
}
