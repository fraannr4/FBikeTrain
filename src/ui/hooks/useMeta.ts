import { useEffect, useState } from 'react';
import { getMeta } from '../../db/repo';

export type Meta = { lastImportAt?: number; lastBackupAt?: number };

/**
 * Fechas de la última importación y de la última copia. `null` mientras carga.
 * `reloadKey` vuelve a leerlas cuando cambia (el armazón pasa la ruta, para que la
 * tarjeta de importación se actualice al salir de Importar). No usa el router.
 */
export function useMeta(reloadKey?: unknown): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    let alive = true;
    getMeta().then(
      (m) => {
        if (alive) setMeta(m);
      },
      () => {
        // Almacenamiento bloqueado: sin fechas. Inicio ya explica el problema.
        if (alive) setMeta({});
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return meta;
}
