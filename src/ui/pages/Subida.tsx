import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTrack } from '../../db/repo';
import type { ClimbEffort } from '../../domain/types';
import { ClimbChart } from '../charts/ClimbChart';
import { PassesChart } from '../charts/PassesChart';
import { climbTime, fullDay, kmProfile, longDay, vamOk, type ClimbItem, type KmProfile } from '../climbView';
import { Skeleton } from '../components/Skeleton';
import { formatCount, formatGrade, formatNumber, formatSpeed, formatVam, NO_FIGURE } from '../format';
import { Check, ChevronDown, ChevronRight } from '../icons';

/** Pasadas que se ven al abrir la hoja; «Ver las N pasadas» enseña hasta 200. */
const LIMIT = 5;
const ALL_LIMIT = 200;

type Loaded = { id: string; profile: KmProfile | null };

/** Perfil por km del tramo de la representante, leído de su track al abrir la hoja. */
function useKmProfile(rep: ClimbEffort): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let alive = true;
    getTrack(rep.activityId).then(
      (track) => alive && setLoaded({ id: rep.id, profile: track ? kmProfile(track, rep) : null }),
      () => alive && setLoaded({ id: rep.id, profile: null }),
    );
    return () => {
      alive = false;
    };
  }, [rep]);
  return loaded && loaded.id === rep.id ? loaded : null;
}

/**
 * Marca la hoja con `data-scrolled` mientras su cuerpo está desplazado: la cabecera fija recorta
 * entonces un título larguísimo y deja sitio a las pasadas.
 */
function useScrolledSheet() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = ref.current?.closest<HTMLElement>('.sheet-body');
    const sheet = body?.closest('dialog');
    if (!body || !sheet) return;
    const onScroll = () => sheet.toggleAttribute('data-scrolled', body.scrollTop > 4);
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      body.removeEventListener('scroll', onScroll);
      sheet.removeAttribute('data-scrolled');
    };
  }, []);
  return ref;
}

function profileLabel(item: ClimbItem, p: KmProfile): string {
  const max = Math.max(...p.grades);
  const k = p.grades.indexOf(max) + 1;
  return `Perfil de ${item.name}: ${formatNumber(p.lengthKm, 1)} km de ${formatCount(p.eles[0])} a ${formatCount(
    Math.max(...p.eles),
  )} m. El kilómetro más duro es el ${k}, al ${formatGrade(max)}.`;
}

function Vam({ mh }: { mh: number }) {
  return (
    <>
      VAM <span className="nw">{formatVam(mh)}</span>
    </>
  );
}

function PassRow({ item, p, now }: { item: ClimbItem; p: ClimbEffort; now: number }) {
  const isBest = item.passes.length > 1 && p === item.best;
  return (
    <li>
      <Link className="row row--plain" to={`/historial/${encodeURIComponent(p.activityId)}`}>
        <span className="row-main">
          <span className="row-title">{longDay(p.activityStart, now)}</span>
          <span className="row-meta">
            {vamOk(item) ? (
              <>
                <Vam mh={p.vamMh} />,{' '}
              </>
            ) : null}
            {formatSpeed(p.avgSpeedMs)}
          </span>
          {isBest ? (
            <span className="row-meta">
              <span className="chip chip--done">
                <Check className="ic" aria-hidden="true" />
                Tu mejor
              </span>
            </span>
          ) : null}
        </span>
        <span className="row-trail">
          <span className="row-val">{climbTime(p.timeS)}</span>
          <ChevronRight className="chev" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

/** Cuerpo de la hoja de una subida: perfil por km, cifras, tus tiempos y la lista de pasadas. */
export function SubidaDetail({ item, now }: { item: ClimbItem; now: number }) {
  const [all, setAll] = useState(false);
  const loaded = useKmProfile(item.passes[0]);
  const n = item.passes.length;
  const many = n > 1;
  const newestFirst = item.passes.slice().reverse();
  const shown = newestFirst.slice(0, all ? ALL_LIMIT : LIMIT);
  const ref = useScrolledSheet();

  return (
    <div data-m="elev" ref={ref}>
      <div className="sheet-cols">
        <div className="sheet-col">
          <p className="climb-h">
            <span>Pendiente de cada kilómetro, en&#8239;%</span>
            {loaded?.profile ? (
              <span>
                cima <span className="fig">{formatCount(Math.max(...loaded.profile.eles))}</span>&#8239;m
              </span>
            ) : null}
          </p>
          {!loaded ? (
            <Skeleton variant="box" height={140} />
          ) : loaded.profile ? (
            <ClimbChart profile={loaded.profile} label={profileLabel(item, loaded.profile)} />
          ) : (
            <div className="profile--empty">Sin perfil de altura: la salida no guarda la altitud</div>
          )}
          <dl className="stat3">
            <div>
              <dt>Pasadas</dt>
              <dd>{formatCount(n)}</dd>
            </div>
            <div>
              <dt>{many ? 'Tu mejor' : 'Tu tiempo'}</dt>
              <dd className="fig-i">{climbTime(item.best.timeS)}</dd>
            </div>
            <div>
              <dt>{many ? 'Mejor VAM' : 'VAM'}</dt>
              <dd>
                {vamOk(item) ? (
                  <>
                    {formatCount(item.best.vamMh)}
                    <span className="u">m/h</span>
                  </>
                ) : (
                  NO_FIGURE
                )}
              </dd>
            </div>
          </dl>
        </div>
        <div className="sheet-col">
          {many ? (
            <section className="sheet-sec" aria-labelledby="hs-evo-t">
              <div className="sheet-sec-h">
                <h3 id="hs-evo-t">Tus tiempos</h3>
                <p>
                  <span className="hint-touch">Desliza el dedo por la gráfica</span>
                  <span className="hint-fine">Pasa el ratón o usa las flechas</span>
                </p>
              </div>
              <PassesChart
                items={item.passes.map((p) => ({
                  t: p.activityStart,
                  s: p.timeS,
                  when: fullDay(p.activityStart),
                  sub: vamOk(item) ? <Vam mh={p.vamMh} /> : formatSpeed(p.avgSpeedMs),
                }))}
                label={`Tus ${formatCount(n)} tiempos en ${item.name}, de ${longDay(item.passes[0].activityStart, now).toLowerCase()} a ${longDay(
                  item.last.activityStart,
                  now,
                ).toLowerCase()}. Tu mejor: ${climbTime(item.best.timeS)}, el ${longDay(item.best.activityStart, now).toLowerCase()}. La última: ${climbTime(
                  item.last.timeS,
                )}. Con las flechas recorres las pasadas; la lista de pasadas tiene todos los datos.`}
              />
            </section>
          ) : (
            <p className="solo-note">
              Solo la has subido una vez. Con la segunda pasada verás aquí cómo cambian tus tiempos.
            </p>
          )}
        </div>
      </div>

      <section className="sheet-sec" aria-labelledby="hs-lista-t">
        <div className="sheet-sec-h">
          <h3 id="hs-lista-t">Pasadas</h3>
          <p>De la más reciente a la primera</p>
        </div>
        <ul className="list" id="hs-lista">
          {shown.map((p) => (
            <PassRow key={p.id} item={item} p={p} now={now} />
          ))}
        </ul>
        {all && n > ALL_LIMIT ? (
          <p className="passes-left">
            Faltan las {formatCount(n - ALL_LIMIT)} pasadas más antiguas: la gráfica «Todas, por meses» las resume.
          </p>
        ) : null}
        {n > LIMIT ? (
          <button
            type="button"
            className="btn btn--ghost more-btn"
            aria-expanded={all}
            aria-controls="hs-lista"
            onClick={() => setAll((v) => !v)}
          >
            <ChevronDown className="ic" aria-hidden="true" />
            {all
              ? `Ver solo las ${LIMIT} últimas`
              : n > ALL_LIMIT
                ? `Ver las ${ALL_LIMIT} últimas, de ${formatCount(n)}`
                : `Ver las ${n} pasadas`}
          </button>
        ) : null}
      </section>
    </div>
  );
}
