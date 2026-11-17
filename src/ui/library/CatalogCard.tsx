import { memo, useMemo } from 'react';
import type { CatalogRoute } from '../../routes/library/catalog';
import { terrainFeel } from '../../routes/library/catalogView';
import { RouteShape } from '../charts/RouteShape';
import { Chip } from '../components/Chip';
import { ValueText } from '../components/ValueText';
import { formatKm, formatMeters } from '../format';
import { Check, ExternalLink } from '../icons';
import { sourceName } from './CatalogFilters';

/** Atribución obligatoria: fuente y autor, con enlace a la ruta original. */
export function OriginLink({ route, className }: { route: Pick<CatalogRoute, 'source' | 'author' | 'url'>; className?: string }) {
  return (
    <a className={className ?? 'lib-origin'} href={route.url} target="_blank" rel="noopener noreferrer">
      <ExternalLink className="ic" aria-hidden="true" />
      <span className="lib-origin-text">{sourceName(route.source)}{route.author ? ` · ${route.author}` : ''}</span>
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}

type Props = { route: CatalogRoute; awayM: number; saved: boolean; onOpen: () => void };

/**
 * Tarjeta de una ruta de la biblioteca común: forma sobre curvas de nivel, nombre, cifras y origen.
 * Toda la tarjeta abre el detalle con el botón del título; el enlace de origen queda por encima.
 */
export const CatalogCard = memo(function CatalogCard({ route, awayM, saved, onOpen }: Props) {
  const points = useMemo(() => route.thumb.map(([lat, lng]) => ({ lat, lng })), [route.thumb]);
  const terrain = terrainFeel(route);
  return (
    <article className="rcard lib-card">
      <div className="rcard-map">
        <RouteShape points={points} size="fill" />
        <Chip className="rcard-kind">{route.loop ? 'Circular' : 'Lineal'}</Chip>
      </div>
      <div className="rcard-body">
        <h3 className="rcard-name" title={route.name} dir="auto">
          <button type="button" className="lib-open" aria-haspopup="dialog" onClick={onOpen}>{route.name || 'Ruta sin nombre'}</button>
        </h3>
        <dl className="rcard-figs">
          <div><dt>Distancia</dt><dd><ValueText value={formatKm(route.distanceM, route.distanceM < 100_000 ? 1 : 0)} /></dd></div>
          <div><dt>Desnivel</dt><dd>{route.elevGainM === null ? <span className="unit">Sin altitud</span> : <ValueText value={formatMeters(route.elevGainM)} />}</dd></div>
          <div><dt>Inicio a</dt><dd><ValueText value={formatKm(awayM, awayM < 10_000 ? 1 : 0)} /></dd></div>
        </dl>
        {terrain || saved ? (
          <div className="cluster rcard-chips">
            {terrain ? <Chip>{terrain}</Chip> : null}
            {saved ? <Chip tone="done" icon={Check}>En Mis rutas</Chip> : null}
          </div>
        ) : null}
        <OriginLink route={route} />
      </div>
    </article>
  );
});
