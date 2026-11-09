import { RideMap } from '../components/RideMap';
import { Sheet } from '../components/Sheet';
import { formatKm, formatMeters } from '../format';
import { Download } from '../icons';
import { ROUTE_KIND, RouteProfile, type RouteCardData } from './RouteCard';

type Props = {
  /** La ruta del mapa. Se conserva al cerrar, para que la hoja baje con su contenido. */
  route: RouteCardData | null;
  open: boolean;
  onClose: () => void;
  onExport: (route: RouteCardData) => void;
};

/**
 * Hoja del mapa (rutas.html, `#hoja-mapa`): el nombre completo de la ruta, el trazado sobre CyclOSM
 * para ver por qué carreteras y pueblos pasa, el perfil por pendiente y «Exportar GPX» en el pie.
 */
export function RouteMapSheet({ route, open, onClose, onExport }: Props) {
  const sub = route
    ? [formatKm(route.distanceM, 1), formatMeters(route.elevGainM), route.kind ? ROUTE_KIND[route.kind].label.toLowerCase() : null]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  return (
    <Sheet
      open={open && !!route}
      onClose={onClose}
      title={route?.name ?? 'Recorrido'}
      sub={sub}
      closeLabel="Cerrar el mapa"
      className="sheet--route-map"
      footer={
        route ? (
          <button type="button" className="btn btn--primary btn--block" onClick={() => onExport(route)}>
            <Download className="ic" aria-hidden="true" />
            Exportar GPX
          </button>
        ) : null
      }
    >
      {route ? (
        <div className="rmap-sheet">
          <RideMap points={route.shape} label={`Mapa de ${route.name}`} className="rmap-sheet-map" />
          <RouteProfile route={route} legend />
        </div>
      ) : null}
    </Sheet>
  );
}
