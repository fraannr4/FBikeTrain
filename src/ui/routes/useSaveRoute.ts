import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Coord3 } from '../../domain/types';
import { RouteLibraryError, saveGeneratedRoute } from '../../routes/library';
import { useToast } from '../components/Toast';

/**
 * «Guardar en la biblioteca» para una ruta generada (Rutas o Rutas con IA): así se puede empalmar
 * sin exportar e importar el GPX. `key` distingue la ruta dentro de esta pantalla para no duplicarla.
 */
export function useSaveRoute() {
  const toast = useToast();
  const navigate = useNavigate();
  const saved = useRef(new Set<string>());
  return useCallback(
    async (key: string, name: string, coords: Coord3[], file: string) => {
      const action = { label: 'Empalmar', onClick: () => navigate('/rutas/empalmar') };
      if (saved.current.has(key)) {
        toast('Ya está en la biblioteca', { tone: 'good', action });
        return;
      }
      saved.current.add(key);
      try {
        await saveGeneratedRoute(name, coords, file);
        toast('Guardada en la biblioteca', { tone: 'good', action });
      } catch (e) {
        saved.current.delete(key);
        toast(e instanceof RouteLibraryError ? e.message : 'No se ha podido guardar la ruta. Vuelve a probar.', { tone: 'error' });
      }
    },
    [navigate, toast],
  );
}
