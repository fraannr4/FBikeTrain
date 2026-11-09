import type { LevelSummary } from '../../ai/levelSummary';
import type { AiRoute } from '../../ai/routePlanner';
import type { Coord3 } from '../../domain/types';
import { gpxFileName } from '../../routes/gpx';
import { formatDeltaPct, formatKm, formatMeters, formatNumber, formatVam } from '../format';
import { Check, Clock, TrendingDown, TrendingUp, X } from '../icons';
import { RouteCard, type RouteCardData } from '../routes/RouteCard';
import { toCardData } from '../routes/routeView';
import { Carousel } from './Carousel';

/** Una ruta lista para pintar y exportar. */
export type ShownRoute = { card: RouteCardData; coords: Coord3[]; file: string };

/** Tarjeta de cada propuesta: el título de la IA, su explicación y cuánto cambia frente a tu referencia (sube o baja). */
export function aiShown(routes: AiRoute[]): ShownRoute[] {
  return routes.map((r) => {
    const notes = [{ icon: r.upliftPct >= 0 ? TrendingUp : TrendingDown, text: `${formatDeltaPct(r.upliftPct)} frente a tu referencia en ${r.dimension}` }];
    if (r.limitadoPorTiempo) notes.push({ icon: Clock, text: 'Limitada por tu tiempo disponible' });
    return { card: { ...toCardData(r, r.titulo), why: r.explicacion, notes }, coords: r.coords, file: gpxFileName(r) };
  });
}

/** Carrusel de propuestas; en el teléfono, «Exportar GPX» va en el dock. */
export function AiRoutesCarousel({
  shown,
  resetKey,
  onIndexChange,
  onExport,
  onMap,
}: {
  shown: ShownRoute[];
  resetKey: unknown;
  onIndexChange: (i: number) => void;
  onExport: (card: RouteCardData) => void;
  onMap: (card: RouteCardData) => void;
}) {
  return (
    <Carousel
      label="Propuestas de la IA"
      items={shown}
      getKey={(s) => s.card.id}
      resetKey={resetKey}
      onIndexChange={onIndexChange}
      renderItem={(s, i) => (
        <RouteCard
          route={s.card}
          variant={i === 0 ? 'best' : 'normal'}
          rank={{ n: i + 1, of: shown.length }}
          className="rcard--docked"
          onDownload={onExport}
          onMap={onMap}
        />
      )}
    />
  );
}

/** Lo que recibe la IA: el resumen del nivel, las respuestas y las cifras de las rutas. */
export function AiSeesList({ summary }: { summary: LevelSummary | null }) {
  return (
    <ul className="sees sees--yes">
      {summary ? (
        <>
          <li>
            <Check className="ic" aria-hidden="true" />
            <span>
              Tu salida media: <b>{formatKm(summary.distanciaMediaKm * 1000)}</b> y <b>{formatMeters(summary.desnivelMedioM)}</b>
            </span>
          </li>
          <li>
            <Check className="ic" aria-hidden="true" />
            <span>
              Tu velocidad media: <b>{formatNumber(summary.velocidadMediaKmh, 1)}&nbsp;km/h</b>
            </span>
          </li>
          {summary.vamMediaMh !== null ? (
            <li>
              <Check className="ic" aria-hidden="true" />
              <span>
                Tu VAM en subidas: <b>{formatVam(summary.vamMediaMh)}</b>
              </span>
            </li>
          ) : null}
        </>
      ) : (
        <li>
          <Check className="ic" aria-hidden="true" />
          <span>Tu salida media, tu velocidad media y tu VAM en subidas</span>
        </li>
      )}
      <li>
        <Check className="ic" aria-hidden="true" />
        <span>Tus respuestas y la nota, si la escribes</span>
      </li>
      <li>
        <Check className="ic" aria-hidden="true" />
        <span>
          Las cifras de las rutas candidatas: km, desnivel, pendiente y % de carretera nueva, <b>sin coordenadas</b>
        </span>
      </li>
    </ul>
  );
}

export const AI_NEVER = 'Nunca verá tus tracks GPS, dónde está Casa, el punto de salida ni los nombres de tus salidas.';

export function AiNeverList() {
  const items = ['Tus tracks GPS ni tus mapas', 'Dónde está Casa ni el punto de salida', 'Los nombres y las fechas de tus salidas'];
  return (
    <ul className="sees sees--no">
      {items.map((t) => (
        <li key={t}>
          <X className="ic" aria-hidden="true" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
