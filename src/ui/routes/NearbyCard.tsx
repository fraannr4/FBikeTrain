import { memo, useMemo, useState } from 'react';
import { directionName } from '../../ai/references';
import type { LatLng } from '../../domain/types';
import { routeBearing } from '../../routes/diversity';
import { gpxFileName, toGpx } from '../../routes/gpx';
import type { NearbyCard as NearbyCardData } from '../../routes/nearby';
import { DifficultyText } from '../components/Chip';
import { useToast } from '../components/Toast';
import { formatDuration, formatKm, formatMeters } from '../format';
import { Download, Folder, MapIcon, Route, Sparkles } from '../icons';
import { GpxHelpSheet } from './gpxExport';
import { ProposalCard } from './ProposalCard';
import { RouteMapSheet } from './RouteMapSheet';
import { toCardData } from './routeView';
import { sendGpx } from './sendGpx';
import { useSaveRoute } from './useSaveRoute';

type Real = Extract<NearbyCardData, { kind: 'real' }>;
type Motor = Extract<NearbyCardData, { kind: 'motor' }>;

/** El autor de la colección común llega como «Nombre en Ride with GPS». */
const RWGPS_SUFFIX = / en Ride with GPS$/;

function RealCard({ card }: { card: Real }) {
  const { route, adapted, motivo } = card.proposal;
  const author = route.author?.replace(RWGPS_SUFFIX, '').trim();
  return (
    <ProposalCard
      origin={author ? `Ride with GPS · ${author}` : 'Ride with GPS'}
      source={{ name: route.name, original: route, sourceUrl: route.sourceUrl, author: route.author }}
      adapted={adapted}
      why={motivo}
    />
  );
}

/**
 * Vuelta del motor: por qué puntos de paso va (una línea con elipsis; completa en el mapa), sus cifras,
 * hacia dónde sale y las acciones Mapa, Exportar GPX y Guardar.
 */
function MotorCard({ card, start }: { card: Motor; start: LatLng }) {
  const toast = useToast();
  const saveRoute = useSaveRoute();
  const { route, via, combo } = card;
  const [mapOpen, setMapOpen] = useState(false);
  const [help, setHelp] = useState<{ file: string; name: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { direction, name, data } = useMemo(() => {
    const shape = route.coords.map(([lng, lat]) => ({ lat, lng }));
    const direction = directionName(routeBearing(shape, start));
    const name = via.length > 0 ? `Por ${via.join(' · ')}` : `Vuelta circular hacia el ${direction}`;
    return { direction, name, data: toCardData(route, name) };
  }, [route, via, start]);
  const file = gpxFileName(route);
  const titleId = `nb-${combo}-${route.id}`;

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
    const id = await saveRoute(titleId, name, route.coords, file);
    setSaving(false);
    if (id) setSaved(true);
  };

  return (
    <article className="cat-card nb-card" aria-labelledby={titleId}>
      <p className="nb-origin">
        <span className="nb-source">
          <Route className="ic" aria-hidden="true" />
          Motor FBikeTrain
        </span>
        {combo === 'ia' ? (
          <span className="chip chip--new">
            <Sparkles className="ic" aria-hidden="true" />
            Combinada por la IA
          </span>
        ) : null}
      </p>
      <h3 className="wk-name nb-name" id={titleId} title={name} dir="auto">
        {name}
      </h3>
      <dl className="library-metrics wk-metrics">
        <div>
          <dt>Distancia</dt>
          <dd>{formatKm(route.distanceM)}</dd>
        </div>
        <div>
          <dt>Desnivel</dt>
          <dd>{formatMeters(route.elevGainM)}</dd>
        </div>
        <div>
          <dt>Rumbo</dt>
          <dd className="nb-text">Hacia el {direction}</dd>
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
      {route.warning ? <p className="wk-why">{route.warning}</p> : null}
      <div className="cat-actions nb-actions">
        <button type="button" className="btn btn--secondary" aria-haspopup="dialog" onClick={() => setMapOpen(true)}>
          <MapIcon className="ic" aria-hidden="true" />
          Mapa
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void exportGpx()}>
          <Download className="ic" aria-hidden="true" />
          Exportar GPX
        </button>
        <button type="button" className="btn btn--secondary nb-save" disabled={saving || saved} onClick={() => void save()}>
          <Folder className="ic" aria-hidden="true" />
          {saved ? 'Guardada en la biblioteca' : 'Guardar en la biblioteca'}
        </button>
      </div>
      <RouteMapSheet route={data} open={mapOpen} onClose={() => setMapOpen(false)} onExport={() => void exportGpx()} />
      <GpxHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} gpx={help} />
    </article>
  );
}

/** Una propuesta de «Rutas cerca»: las reales con su tarjeta de siempre y las del motor con la suya. */
export const NearbyCard = memo(function NearbyCard({ card, start }: { card: NearbyCardData; start: LatLng }) {
  return card.kind === 'real' ? <RealCard card={card} /> : <MotorCard card={card} start={start} />;
});
