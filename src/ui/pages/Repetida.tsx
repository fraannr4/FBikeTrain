import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTrack } from '../../db/repo';
import type { LatLng } from '../../domain/types';
import { PassesChart } from '../charts/PassesChart';
import { RouteShape } from '../charts/RouteShape';
import { fullDay, longDay } from '../climbView';
import { formatCount, formatDuration, formatKm, formatMeters, formatNumber, NO_FIGURE } from '../format';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight } from '../icons';
import { TREND_FLAT, type Lap, type RouteItem } from '../repeatView';

/** Vueltas que se ven al abrir la hoja; «Ver las N vueltas» enseña hasta 200. */
const LIMIT = 5;
const ALL_LIMIT = 200;
const NO_POINTS: LatLng[] = [];

const hm = (s: number) => formatDuration(s, 'short');

/** «1 h 22» con la h como unidad pequeña, como la cifra de la gráfica: «1h22». */
export function Hm({ s }: { s: number }) {
  const text = hm(s);
  const m = /^(.+) h (\d+)$/.exec(text);
  if (m)
    return (
      <>
        {m[1]}
        <span className="u">h</span>
        {m[2]}
      </>
    );
  const min = /^(.+) min$/.exec(text);
  return min ? (
    <>
      {min[1]}
      <span className="u">min</span>
    </>
  ) : (
    <>{text}</>
  );
}

const kmh = (v: number | null) => (v === null ? NO_FIGURE : `${formatNumber(v, 1)} km/h`);

/** «40,8 km, 310 m, a 23,3 km/h». */
export function lapLine(l: Pick<Lap, 'distM' | 'elevM' | 'kmh'>): string {
  return `${formatKm(l.distM, 1)}, ${formatMeters(l.elevM)}, a ${kmh(l.kmh)}`;
}

/** Con menos de 3 vueltas no hay tendencia: se dice cuánto falta. */
export function missing(n: number): string {
  const f = Math.max(1, 3 - n);
  return `Falta ${f} ${f === 1 ? 'vuelta' : 'vueltas'}`;
}

function trendWords(r: RouteItem): string {
  const d = r.delta;
  if (d === null) return `${missing(r.laps.length).toLowerCase()} para ver la tendencia`;
  if (Math.abs(d) < TREND_FLAT) return 'velocidad estable';
  return `vas ${formatNumber(Math.abs(d), 1)} km/h más ${d > 0 ? 'rápido' : 'lento'} en tus 3 últimas`;
}

/** La tendencia con flecha y signo; «Estable» o «Falta N vueltas» sin flecha. */
export function Trend({ r, as: Tag = 'span', className }: { r: RouteItem; as?: 'span' | 'dd'; className: string }) {
  const d = r.delta;
  if (d === null) return <Tag className={`${className} flat`}>{missing(r.laps.length)}</Tag>;
  if (Math.abs(d) < TREND_FLAT) return <Tag className={`${className} flat`}>Estable</Tag>;
  const up = d > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <Tag className={`${className} delta ${up ? 'delta--up' : 'delta--down'}`}>
      <Icon className="ic" aria-hidden="true" />
      {up ? '+' : '−'}
      {formatNumber(Math.abs(d), 1)}&nbsp;km/h
    </Tag>
  );
}

/** Forma del representante, leída de su track al abrir la hoja. */
function useShape(activityId: string): LatLng[] {
  const [loaded, setLoaded] = useState<{ id: string; points: LatLng[] } | null>(null);
  useEffect(() => {
    let alive = true;
    getTrack(activityId).then(
      (track) =>
        alive &&
        setLoaded({
          id: activityId,
          points: (track ?? []).filter((p): p is typeof p & LatLng => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
        }),
      () => alive && setLoaded({ id: activityId, points: NO_POINTS }),
    );
    return () => {
      alive = false;
    };
  }, [activityId]);
  return loaded && loaded.id === activityId ? loaded.points : NO_POINTS;
}

function LapRow({ r, l, now }: { r: RouteItem; l: Lap; now: number }) {
  return (
    <li>
      <Link className="row row--plain" to={`/historial/${encodeURIComponent(l.activityId)}`}>
        <span className="row-main">
          <span className="row-title">{longDay(l.t, now)}</span>
          <span className="row-meta">{lapLine(l)}</span>
          {l === r.best ? (
            <span className="row-meta">
              <span className="chip chip--done">
                <Check className="ic" aria-hidden="true" />
                Tu mejor
              </span>
            </span>
          ) : null}
        </span>
        <span className="row-trail">
          <span className="row-val">
            <Hm s={l.s} />
          </span>
          <ChevronRight className="chev" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

/** Cuerpo de la hoja de una ruta repetida: forma con el tiempo a batir, cifras, tus tiempos y las vueltas. */
export function RepetidaDetail({ r, now }: { r: RouteItem; now: number }) {
  const [all, setAll] = useState(false);
  const points = useShape(r.id);
  const n = r.laps.length;
  const newestFirst = r.laps.slice().reverse();
  const shown = newestFirst.slice(0, all ? ALL_LIMIT : LIMIT);
  const passes = useMemo(
    () => r.laps.map((l) => ({ t: l.t, s: l.s, when: fullDay(l.t), sub: `${formatKm(l.distM, 1)} a ${kmh(l.kmh)}` })),
    [r],
  );

  return (
    <div data-m="time">
      <div className="sheet-cols">
        <div className="sheet-col">
          <div className="rs-map">
            <RouteShape points={points} size="fill" label={`Forma de ${r.name}`} />
            <p className="rs-beat">
              <span>Tiempo a batir</span>
              <b>
                <Hm s={r.best.s} />
              </b>
            </p>
          </div>
          <dl className="stat3">
            <div>
              <dt>Veces</dt>
              <dd>{formatCount(n)}</dd>
            </div>
            <div>
              <dt>Última</dt>
              <dd>
                <Hm s={r.last.s} />
              </dd>
            </div>
            <div>
              <dt>Tendencia</dt>
              <Trend r={r} as="dd" className="stat-v" />
            </div>
          </dl>
        </div>
        <div className="sheet-col">
          <section className="sheet-sec" aria-labelledby="hr-evo-t">
            <div className="sheet-sec-h">
              <h3 id="hr-evo-t">Tus tiempos</h3>
              <p>Desliza el dedo por la gráfica</p>
            </div>
            <PassesChart
              items={passes}
              format={hm}
              noun="vuelta"
              label={`Tus ${formatCount(n)} tiempos en ${r.name}. Tu mejor: ${hm(r.best.s)}, el ${longDay(
                r.best.t,
                now,
              ).toLowerCase()}. La última: ${hm(r.last.s)}; ${trendWords(r)}. Con las flechas recorres las vueltas; la lista de vueltas tiene todos los datos.`}
            />
            <p className="sheet-note">
              Cada vuelta puede variar unos kilómetros. Por eso la tendencia compara tu velocidad media, no el tiempo.
            </p>
          </section>
        </div>
      </div>

      <section className="sheet-sec" aria-labelledby="hr-lista-t">
        <div className="sheet-sec-h">
          <h3 id="hr-lista-t">Vueltas</h3>
          <p>De la más reciente a la primera</p>
        </div>
        <ul className="list" id="hr-lista">
          {shown.map((l) => (
            <LapRow key={l.activityId} r={r} l={l} now={now} />
          ))}
        </ul>
        {n > LIMIT ? (
          <button
            type="button"
            className="btn btn--ghost more-btn"
            aria-expanded={all}
            aria-controls="hr-lista"
            onClick={() => setAll((v) => !v)}
          >
            <ChevronDown className="ic" aria-hidden="true" />
            {all
              ? `Ver solo las ${LIMIT} últimas`
              : n > ALL_LIMIT
                ? `Ver las ${ALL_LIMIT} últimas, de ${formatCount(n)}`
                : `Ver las ${formatCount(n)} vueltas`}
          </button>
        ) : null}
      </section>
    </div>
  );
}
