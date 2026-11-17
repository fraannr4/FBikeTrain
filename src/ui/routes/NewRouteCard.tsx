import { memo, useMemo, useState } from 'react';
import type { LatLng } from '../../domain/types';
import { gpxFileName, toGpx } from '../../routes/gpx';
import type { GeneratorCard } from '../../routes/library/generate';
import { DifficultyText } from '../components/Chip';
import { RideMap } from '../components/RideMap';
import { useToast } from '../components/Toast';
import { formatDuration, formatKm, formatMeters } from '../format';
import { Download, Folder, Route } from '../icons';
import { GpxHelpSheet } from './gpxExport';
import { routeName } from './routeView';
import { sendGpx } from './sendGpx';
import { useSaveRoute } from './useSaveRoute';
import { WindLine } from './WeatherRow';
import type { HourForecast } from '../../weather/forecast';

type Props = { card: Extract<GeneratorCard, { kind: 'nueva' }>; start: LatLng; weather?: HourForecast | null };

/**
 * Vuelta nueva del generador: etiqueta «Nueva», nombre por el lado hacia el que va (una línea con
 * elipsis; completo en el mapa), mapa en línea, cifras y las acciones Exportar GPX y Guardar.
 */
export const NewRouteCard = memo(function NewRouteCard({ card, start, weather }: Props) {
  const toast = useToast();
  const saveRoute = useSaveRoute();
  const { route, id } = card;
  const [help, setHelp] = useState<{ file: string; name: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { name, shape } = useMemo(
    () => ({ name: routeName(route.coords, start), shape: route.coords.map(([lng, lat]) => ({ lat, lng })) }),
    [route, start],
  );
  const file = gpxFileName(route);
  const titleId = `tarjeta-${id}`;

  const exportGpx = async () => {
    const outcome = await sendGpx(toGpx(name, route.coords), file, name);
    if (outcome === 'failed') toast('Este navegador no deja descargar el GPX.', { tone: 'error' });
    else if (outcome === 'downloaded') {
      setHelp({ file, name });
      toast(`GPX descargado: ${file}`, { tone: 'good', action: { label: 'Cómo pasarlo', onClick: () => setHelpOpen(true) } });
    }
  };

  const save = async () => {
    if (saving || saved) return;
    setSaving(true);
    const savedId = await saveRoute(id, name, route.coords, file);
    setSaving(false);
    if (savedId) setSaved(true);
  };

  return (
    <article className="cat-card nb-card" aria-labelledby={titleId}>
      <p className="nb-origin">
        <span className="chip chip--new">
          <Route className="ic" aria-hidden="true" />
          Nueva
        </span>
      </p>
      <h3 className="wk-name nb-name" id={titleId} title={name} dir="auto">
        {name}
      </h3>
      <RideMap points={shape} label={`Mapa de ${name}`} className="wk-map" interactive />
      <dl className="library-metrics wk-metrics">
        <div>
          <dt>Distancia</dt>
          <dd>{formatKm(route.distanceM)}</dd>
        </div>
        <div>
          <dt>Desnivel</dt>
          <dd>{formatMeters(route.elevGainM)}</dd>
        </div>
        {route.difficulty ? (
          <div>
            <dt>Dificultad</dt>
            <dd className="nb-text">
              <DifficultyText level={route.difficulty} short />
            </dd>
          </div>
        ) : null}
        {route.estTimeS !== null && Number.isFinite(route.estTimeS) ? (
          <div>
            <dt>Tiempo a tu ritmo</dt>
            <dd>{formatDuration(route.estTimeS)}</dd>
          </div>
        ) : null}
      </dl>
      <WindLine points={shape} weather={weather} />
      <div className="cat-actions nb-actions">
        <button type="button" className="btn btn--primary" onClick={() => void exportGpx()}>
          <Download className="ic" aria-hidden="true" />
          Exportar GPX
        </button>
        <button type="button" className="btn btn--secondary" disabled={saving || saved} onClick={() => void save()}>
          <Folder className="ic" aria-hidden="true" />
          {saved ? 'Guardada en la biblioteca' : 'Guardar en la biblioteca'}
        </button>
      </div>
      <GpxHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} gpx={help} />
    </article>
  );
});
