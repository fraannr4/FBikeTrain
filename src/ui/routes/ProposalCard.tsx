import { useState } from 'react';
import type { AdaptedRoute } from '../../routes/adapt';
import { RouteLibraryError, routePointsToGpx, saveAdaptedRoute, type ParsedReferenceRoute } from '../../routes/library';
import { Banner } from '../components/Banner';
import { RideMap } from '../components/RideMap';
import { useToast } from '../components/Toast';
import { formatKm, formatMeters } from '../format';
import { Download, ExternalLink, Folder } from '../icons';
import { GpxHelpSheet } from './gpxExport';
import { sendGpx } from './sendGpx';

export type ProposalSource = {
  name: string;
  original: ParsedReferenceRoute;
  sourceUrl?: string;
  author?: string;
  /** La altitud de la ruta original es del modelo de terreno: el desnivel es una estimación. */
  estimated?: boolean;
};

const nearText = (m: number) => (m < 1000 ? formatMeters(m) : formatKm(m, 1));
const fileName = (r: AdaptedRoute) => `ruta-adaptada-${Math.round(r.distanceM / 1000)}km.gpx`;

function originLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host === 'www.openstreetmap.org') return 'Ver en OpenStreetMap';
    if (host === 'wikiloc.com' || host.endsWith('.wikiloc.com')) return 'Ver en Wikiloc';
  } catch { /* enlace guardado no válido: texto genérico */ }
  return 'Ver el origen';
}

/** Una ruta adaptada lista para llevarse: mapa, cifras, avisos, «Enviar al iGPSPORT» y «Guardar en la biblioteca». */
export function ProposalCard({ source, adapted, why, headingLevel = 3 }: { source: ProposalSource; adapted: AdaptedRoute; why?: string; headingLevel?: 2 | 3 }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [help, setHelp] = useState<{ file: string; name: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const usable = !adapted.rejected;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  const save = async () => {
    if (!usable || saving) return;
    setSaving(true);
    try {
      await saveAdaptedRoute(source.original, adapted.coords, {
        name: source.name, sourceUrl: source.sourceUrl, author: source.author ?? null, ...(source.estimated ? { elevation: 'dem' as const } : {}),
      });
      setSaved(true);
      toast('Guardada en la biblioteca', { tone: 'good' });
    } catch (e) {
      toast(e instanceof RouteLibraryError ? e.message : 'No se ha podido guardar la ruta. Vuelve a probar.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    if (!usable) return;
    const file = fileName(adapted);
    const outcome = await sendGpx(routePointsToGpx(source.name, adapted.coords), file, source.name);
    if (outcome === 'failed') toast('Este navegador no deja descargar el GPX.', { tone: 'error' });
    if (outcome === 'downloaded') {
      setHelp({ file, name: source.name });
      toast(`GPX descargado: ${file}`, { tone: 'good', action: { label: 'Cómo pasarlo', onClick: () => setHelpOpen(true) } });
    }
  };

  const gain = adapted.elevGainM === null ? 'Sin altitud' : `${source.estimated ? '≈ ' : ''}${formatMeters(adapted.elevGainM)}`;
  return (
    <article className="cat-card">
      <Heading className="wk-name">{source.name}</Heading>
      {source.sourceUrl ? (
        <a className="cat-origin" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="ic" aria-hidden="true" />
          {originLabel(source.sourceUrl)}
          {source.author ? <span className="cat-author">{source.author}</span> : null}
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      ) : source.author ? (
        <p className="wk-meta">{source.author}</p>
      ) : null}
      {adapted.rejected ? (
        <Banner tone="error">
          <b>No se puede usar esta adaptación.</b> {adapted.rejected}
        </Banner>
      ) : null}
      <RideMap points={adapted.coords} label={`Mapa de ${source.name}`} className="wk-map" interactive />
      <dl className="library-metrics wk-metrics">
        <div>
          <dt>Distancia</dt>
          <dd>{formatKm(adapted.distanceM)}</dd>
        </div>
        <div>
          <dt>{source.estimated ? 'Desnivel estimado' : 'Desnivel'}</dt>
          <dd>{gain}</dd>
        </div>
        <div>
          <dt>Unión con tu inicio</dt>
          <dd>{formatKm(adapted.connectorM, 1)}</dd>
        </div>
        <div>
          <dt>Pasa a</dt>
          <dd>{nearText(adapted.passesNearM)}</dd>
        </div>
      </dl>
      {why ? <p className="wk-why">{why}</p> : null}
      {adapted.warnings.length > 0 ? (
        <ul className="wk-warnings" aria-label="Avisos">
          {adapted.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {usable ? (
        <div className="cat-actions">
          <button type="button" className="btn btn--primary btn--block" onClick={() => void send()}>
            <Download className="ic" aria-hidden="true" />
            Enviar al iGPSPORT
          </button>
          <button type="button" className="btn btn--secondary btn--block" disabled={saving || saved} onClick={() => void save()}>
            <Folder className="ic" aria-hidden="true" />
            {saved ? 'Guardada en la biblioteca' : 'Guardar en la biblioteca'}
          </button>
        </div>
      ) : null}
      <GpxHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} gpx={help} />
    </article>
  );
}
