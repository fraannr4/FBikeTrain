import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LatLng } from '../../domain/types';
import type { SteepSegment } from '../../routes/analyze';
import { GRADE_LABELS, hardestGrade } from '../charts/grade';
import { ProfileSvg } from '../charts/ProfileSvg';
import { RouteShape } from '../charts/RouteShape';
import { DifficultyChip, DifficultyText, type DifficultyLevel } from '../components/Chip';
import { ListRow } from '../components/ListRow';
import { Skeleton } from '../components/Skeleton';
import { ValueText } from '../components/ValueText';
import { formatCount, formatDuration, formatKm, formatMeters, formatNumber } from '../format';
import { ArrowLeftRight, CircleCheck, Download, MapIcon, Repeat, Route, Sparkles, type LucideIcon } from '../icons';
import type { ProfilePoint } from '../profile';

export type { DifficultyLevel };

/** Circular (sales y vuelves por otro sitio) o ida y vuelta por el mismo camino. */
export type RouteKind = 'circular' | 'ida-y-vuelta';

/** Lo que pinta la tarjeta. F4 lo construye a partir de `GeneratedRoute`. */
export type RouteCardData = {
  id: string;
  name: string;
  distanceM: number;
  elevGainM: number;
  /** Tiempo a tu ritmo; `null` sin salidas con que medirlo. */
  estTimeS: number | null;
  difficulty: DifficultyLevel | null;
  /** Porcentaje de carretera que no has rodado nunca; `null` si no se sabe. */
  newPct: number | null;
  shape: LatLng[];
  profile: ProfilePoint[];
  /** Tramos de pendiente de ORS. El dibujo y el «tramo más duro» salen del perfil, como la leyenda. */
  steep: SteepSegment[];
  /** Explicación de la IA: «Por qué esta». */
  why?: string;
  /** Líneas cortas bajo las etiquetas (IA): «+8 % frente a tu referencia en distancia». */
  notes?: { icon: LucideIcon; text: string }[];
  /** Ruta conocida en la que se basa la propuesta de la IA, con su enlace original. */
  basedOn?: { label: string; url?: string };
  kind?: RouteKind;
};

export type RouteCardVariant = 'best' | 'normal' | 'compact' | 'feature';

type Props = {
  route: RouteCardData;
  /** `best`: la primera del carrusel; `normal`: el resto; `compact`: fila de lista; `feature`: Inicio. */
  variant: RouteCardVariant;
  /** Exportar o descargar el GPX. Sin él, no hay botón. */
  onDownload?: (route: RouteCardData) => void;
  /** Destino de «Mapa» (y de «Ver ruta» en `feature`, o de la fila `compact`). */
  mapHref?: string;
  /** Alternativa a `mapHref`: abrir la hoja del mapa. */
  onMap?: (route: RouteCardData) => void;
  /** «Empalmar con…»: guardar la ruta y abrir Empalmar con ella de primer tramo. Sin él, no hay botón. */
  onSplice?: (route: RouteCardData) => void;
  /** Posición en el carrusel: «1» en la esquina y «Ruta 1 de 5» para el lector de pantalla. */
  rank?: { n: number; of: number };
  /** `rcard--docked`: el botón de la tarjeta se oculta en el teléfono porque el dock lo repite. */
  className?: string;
};

export const ROUTE_KIND: Record<RouteKind, { label: string; icon: typeof Repeat }> = {
  circular: { label: 'Circular', icon: Repeat },
  'ida-y-vuelta': { label: 'Ida y vuelta', icon: ArrowLeftRight },
};

/** «Perfil: 42,0 km y 640 m de desnivel. Tramo más duro: 7–10 %». */
export function profileLabel(route: Pick<RouteCardData, 'distanceM' | 'elevGainM' | 'profile'>): string {
  const base = `Perfil: ${formatKm(route.distanceM, 1)} y ${formatMeters(route.elevGainM)} de desnivel`;
  const hardest = hardestGrade(route.profile);
  if (hardest === null) return base;
  if (hardest === 0) return `${base}. Sin tramos de más del 1 %`;
  return `${base}. Tramo más duro: ${GRADE_LABELS[hardest]}`;
}

/** Recorrido del perfil: la cima y la distancia total, o `null` si no hay perfil que dibujar. */
function profileSpan(profile: ProfilePoint[]): { top: number; totalM: number } | null {
  if (profile.length < 2) return null;
  let top = -Infinity;
  for (const p of profile) if (Number.isFinite(p.ele) && p.ele > top) top = p.ele;
  const totalM = Math.abs(profile[profile.length - 1].dM - profile[0].dM);
  return Number.isFinite(top) && totalM > 0 ? { top, totalM } : null;
}

/** Porcentaje de carretera nueva redondeado; `null` si no se sabe. */
function newShare(pct: number | null): number | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

function NewRoadChip({ pct }: { pct: number | null }) {
  const share = newShare(pct);
  if (share === null) return null;
  if (share === 0) return <span className="chip">Todo ya rodado</span>;
  return (
    <span className="chip chip--new">
      <Sparkles className="ic" aria-hidden="true" />
      {formatCount(share)} % carretera nueva
    </span>
  );
}

/** «Por qué esta»: tres líneas y «Leer más» solo si el texto no cabe. */
function WhyNote({ text, id }: { text: string; id: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  return (
    <div className={open ? 'rcard-why is-open' : 'rcard-why'}>
      <Sparkles className="ic" aria-hidden="true" />
      <div className="rcard-why-main">
        <p className="rcard-why-t" id={id} ref={ref}>
          <b>Por qué esta. </b>
          {text}
        </p>
        {clipped || open ? (
          <button
            type="button"
            className="btn btn--ghost rcard-more"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Leer menos' : 'Leer más'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MapButton({ route, mapHref, onMap }: Pick<Props, 'route' | 'mapHref' | 'onMap'>) {
  const label = `Ver ${route.name} en el mapa`;
  const body = (
    <>
      <MapIcon className="ic" aria-hidden="true" />
      <span aria-hidden="true">Mapa</span>
    </>
  );
  if (mapHref) {
    return (
      <Link className="rcard-mapbtn" to={mapHref} aria-label={label}>
        {body}
      </Link>
    );
  }
  if (onMap) {
    return (
      <button type="button" className="rcard-mapbtn" aria-haspopup="dialog" aria-label={label} onClick={() => onMap(route)}>
        {body}
      </button>
    );
  }
  return null;
}

/** Cifras de la ruta: distancia (cifra titular, en cursiva), desnivel y, si se sabe, tiempo a tu ritmo. */
function Figures({ route }: { route: RouteCardData }) {
  return (
    <dl className="rcard-figs">
      <div>
        <dt>Distancia</dt>
        <dd>
          <span className="fig fig-i">{formatNumber(route.distanceM / 1000, 1)}</span>
          <span className="unit"> km</span>
        </dd>
      </div>
      <div>
        <dt>Desnivel</dt>
        <dd>
          <ValueText value={formatMeters(route.elevGainM)} />
        </dd>
      </div>
      {route.estTimeS !== null && Number.isFinite(route.estTimeS) ? (
        <div>
          <dt>A tu ritmo</dt>
          <dd>
            <ValueText value={formatDuration(route.estTimeS)} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Perfil por pendiente con la cima, el eje en km y la leyenda de las pendientes presentes (tarjeta y hoja del mapa). */
export function RouteProfile({ route, legend }: { route: RouteCardData; legend: boolean }) {
  const span = profileSpan(route.profile);
  const label = profileLabel(route);
  if (!span) return <ProfileSvg profile={route.profile} label={label} height={60} />;
  const km = span.totalM / 1000;
  return (
    <div className="rcard-prof">
      {legend ? (
        <p className="rcard-prof-h">
          <span>Perfil por pendiente</span>
          <span>
            cima <ValueText value={formatMeters(span.top)} />
          </span>
        </p>
      ) : null}
      <ProfileSvg profile={route.profile} label={label} legend={legend} height={legend ? 60 : 52} />
      {legend ? (
        <div className="profile-axis" aria-hidden="true">
          <span>0</span>
          <span>{formatCount(km / 2)}</span>
          <span>{formatCount(km)} km</span>
        </div>
      ) : null}
    </div>
  );
}

function CompactRow({ route, mapHref, onMap }: Pick<Props, 'route' | 'mapHref' | 'onMap'>) {
  return (
    <ListRow
      lead={<RouteShape points={route.shape} size={36} />}
      title={route.name}
      meta={
        <span className="rcard-row-meta">
          <span>
            <ValueText value={formatKm(route.distanceM, 1)} />
          </span>
          <span>
            <ValueText value={formatMeters(route.elevGainM)} />
          </span>
          {route.difficulty ? <DifficultyText level={route.difficulty} /> : null}
        </span>
      }
      to={mapHref}
      onClick={!mapHref && onMap ? () => onMap(route) : undefined}
    />
  );
}

function FeatureCard({ route, onDownload, mapHref, onMap, className }: Omit<Props, 'variant' | 'rank'>) {
  const titleId = `rcard-${route.id}-t`;
  return (
    <article className={['rcard', 'rcard--feature', className ?? ''].filter(Boolean).join(' ')} aria-labelledby={titleId}>
      <div className="rcard-band">
        <RouteShape points={route.shape} size="fill" className="rcard-band-shape" />
        <div className="rcard-veil">
          {route.difficulty ? <DifficultyChip level={route.difficulty} /> : null}
          <h3 className="rcard-name" id={titleId} title={route.name} dir="auto">
            {route.name}
          </h3>
          <p className="rcard-line">
            <span>
              <ValueText value={formatKm(route.distanceM, 1)} />
            </span>
            <span>
              <ValueText value={formatMeters(route.elevGainM)} />
            </span>
            {route.estTimeS !== null && Number.isFinite(route.estTimeS) ? (
              <span>
                unas <ValueText value={formatDuration(route.estTimeS, 'short')} />
              </span>
            ) : null}
          </p>
          {route.why ? <p className="rcard-feature-why">{route.why}</p> : null}
        </div>
        {onDownload ? (
          <button
            type="button"
            className="icon-btn icon-btn--glass rcard-gpx"
            aria-label={`Descargar GPX de ${route.name}`}
            onClick={() => onDownload(route)}
          >
            <Download className="ic" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="rcard-body">
        <RouteProfile route={route} legend={false} />
        {mapHref ? (
          <Link className="btn btn--primary btn--block" to={mapHref}>
            Ver ruta
          </Link>
        ) : onMap ? (
          <button type="button" className="btn btn--primary btn--block" onClick={() => onMap(route)}>
            Ver ruta
          </button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Tarjeta de ruta sin fotos: la forma luminosa sobre curvas de nivel, el nombre, la dificultad para
 * ti, la carretera nueva, las cifras y el perfil coloreado por pendiente (rutas.html, `.rcard`).
 * En `compact` es una fila de lista (`li`): va dentro de `List`.
 */
export const RouteCard = memo(function RouteCard({ route, variant, onDownload, mapHref, onMap, onSplice, rank, className }: Props) {
  if (variant === 'compact') return <CompactRow route={route} mapHref={mapHref} onMap={onMap} />;
  if (variant === 'feature') {
    return <FeatureCard route={route} onDownload={onDownload} mapHref={mapHref} onMap={onMap} className={className} />;
  }

  const best = variant === 'best';
  const titleId = `rcard-${route.id}-t`;
  const kind = route.kind ? ROUTE_KIND[route.kind] : null;
  return (
    <article
      className={['rcard', className ?? ''].filter(Boolean).join(' ')}
      data-best={best ? '' : undefined}
      aria-labelledby={titleId}
    >
      <div className="rcard-map">
        <RouteShape points={route.shape} size="fill" />
        {rank ? (
          <span className="rcard-rank" aria-hidden="true">
            {rank.n}
          </span>
        ) : null}
        <MapButton route={route} mapHref={mapHref} onMap={onMap} />
        {kind ? (
          <span className="chip rcard-kind">
            <kind.icon className="ic" aria-hidden="true" />
            {kind.label}
          </span>
        ) : null}
      </div>
      <div className="rcard-body">
        <div className="rcard-head">
          {best ? (
            <p className="rcard-best">
              <CircleCheck className="ic" aria-hidden="true" />
              La que mejor encaja
            </p>
          ) : null}
          <h3 className="rcard-name" id={titleId} title={route.name} dir="auto">
            {rank ? <span className="sr-only">{`Ruta ${rank.n} de ${rank.of}: `}</span> : null}
            {route.name}
          </h3>
        </div>
        {route.difficulty || newShare(route.newPct) !== null ? (
          <div className="cluster rcard-chips">
            {route.difficulty ? <DifficultyChip level={route.difficulty} /> : null}
            <NewRoadChip pct={route.newPct} />
          </div>
        ) : null}
        {route.notes?.length ? (
          <ul className="rcard-notes">
            {route.notes.map((n) => (
              <li key={n.text}>
                <n.icon className="ic" aria-hidden="true" />
                {n.text}
              </li>
            ))}
          </ul>
        ) : null}
        {route.basedOn ? (
          <p className="rcard-based">
            {route.basedOn.url ? <a href={route.basedOn.url} target="_blank" rel="noopener noreferrer">
              {route.basedOn.label}
            </a> : <span>{route.basedOn.label}</span>}
          </p>
        ) : null}
        <Figures route={route} />
        {/* La explicación de la IA va antes del perfil, en el primer pantallazo (ia.html). */}
        {route.why ? <WhyNote text={route.why} id={`rcard-${route.id}-why`} /> : null}
        <RouteProfile route={route} legend />
        {onDownload ? (
          <div className="rcard-actions">
            <button type="button" className="btn btn--primary btn--block" onClick={() => onDownload(route)}>
              <Download className="ic" aria-hidden="true" />
              Exportar GPX
            </button>
          </div>
        ) : null}
        {/* Fuera de `.rcard-actions`: el dock del teléfono no lo repite, así que la tarjeta sí lo lleva. */}
        {onSplice ? (
          <div className="rcard-splice">
            <button
              type="button"
              className="btn btn--secondary btn--block"
              aria-label={`Empalmar «${route.name}» con otra ruta`}
              onClick={() => onSplice(route)}
            >
              <Route className="ic" aria-hidden="true" />
              Empalmar con…
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});

/** Tarjeta en carga con la misma forma: nada salta cuando llegan las rutas. */
export function RouteCardSkeleton() {
  return (
    <div className="rcard rcard--sk" aria-hidden="true">
      <div className="rcard-map">
        <Skeleton variant="circle" className="sk-shape" />
      </div>
      <div className="rcard-body">
        <Skeleton variant="title" />
        <Skeleton width="62%" />
        <div className="sk-figs">
          <Skeleton variant="fig" />
          <Skeleton variant="fig" />
          <Skeleton variant="fig" />
        </div>
        <Skeleton variant="box" height={68} />
      </div>
    </div>
  );
}
