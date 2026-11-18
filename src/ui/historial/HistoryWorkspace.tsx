import { useParams } from 'react-router-dom';
import { useDesktopLayout, WIDE_QUERY } from '../hooks/useDesktopLayout';
import { Historial } from '../pages/Historial';
import { Salida } from '../pages/Salida';

/** La URL conserva la selección y el historial de navegación en ambos tamaños. */
export function HistoryWorkspace() {
  const desktop = useDesktopLayout(WIDE_QUERY);
  const { id } = useParams();
  if (!desktop) return id ? <Salida /> : <Historial />;
  return (
    <div className="history-workspace">
      <div className="history-list"><Historial /></div>
      {id ? <Salida /> : <div className="card history-prompt"><p>Selecciona una salida para ver su mapa, perfil y cifras.</p></div>}
    </div>
  );
}
