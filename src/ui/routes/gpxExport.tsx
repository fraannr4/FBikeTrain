import type { Coord3 } from '../../domain/types';
import { toGpx } from '../../routes/gpx';
import { Sheet } from '../components/Sheet';

/** Descarga el GPX con un enlace temporal. `false` si el navegador no deja. */
export function downloadGpx(name: string, coords: Coord3[], file: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([toGpx(name, coords)], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

/** Hoja «Llévala al iGPSPORT»: los tres pasos para pasar el GPX al BSC200S. */
export function GpxHelpSheet({
  open,
  onClose,
  gpx,
}: {
  open: boolean;
  onClose: () => void;
  gpx: { file: string; name: string } | null;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Llévala al iGPSPORT"
      sub={gpx ? `Para el BSC200S. El archivo es ${gpx.file}.` : 'Para el BSC200S.'}
      footer={
        <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>
          Entendido
        </button>
      }
    >
      <ol className="howto">
        <li>
          <span>
            Pulsa <b>Exportar GPX</b>. El archivo se guarda en Descargas.
          </span>
        </li>
        <li>
          <span>
            Abre la app <b>iGPSPORT</b>, ve a <b>Rutas</b> e importa el archivo.
          </span>
        </li>
        <li>
          <span>
            Sincroniza el BSC200S. En el ciclocomputador, abre <b>Rutas</b> y elige {gpx ? `«${gpx.name}»` : 'la ruta'}.
          </span>
        </li>
      </ol>
    </Sheet>
  );
}
