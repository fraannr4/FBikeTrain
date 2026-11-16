import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Coord3 } from '../../domain/types';
import { RouteLibraryError, saveGeneratedRoute } from '../../routes/library';
import { useToast } from '../components/Toast';

const LIBRARY_HREF = '/rutas/biblioteca';

/**
 * «Guardar en la biblioteca» para una ruta generada en Rutas: queda a mano sin exportar e importar
 * el GPX. `key` distingue la ruta dentro de esta pantalla para no duplicarla.
 * Devuelve el `id` de la ruta en la biblioteca, o `null` si no se ha podido guardar.
 */
export function useSaveRoute() {
  const toast = useToast();
  const navigate = useNavigate();
  const saved = useRef(new Map<string, string>());
  return useCallback(
    async (key: string, name: string, coords: Coord3[], file: string): Promise<string | null> => {
      const known = saved.current.get(key);
      if (known) {
        toast('Ya está en la biblioteca', { tone: 'good', action: { label: 'Ver biblioteca', onClick: () => navigate(LIBRARY_HREF) } });
        return known;
      }
      try {
        const route = await saveGeneratedRoute(name, coords, file);
        saved.current.set(key, route.id);
        toast('Guardada en la biblioteca', { tone: 'good', action: { label: 'Ver biblioteca', onClick: () => navigate(LIBRARY_HREF) } });
        return route.id;
      } catch (e) {
        toast(e instanceof RouteLibraryError ? e.message : 'No se ha podido guardar la ruta. Vuelve a probar.', { tone: 'error' });
        return null;
      }
    },
    [navigate, toast],
  );
}
