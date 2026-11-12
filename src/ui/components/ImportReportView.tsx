import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import type { ImportReport } from '../../import/importService';
import { TZ } from '../../metrics/aggregate';
import { formatCount } from '../format';
import { Activity, ChevronDown, CircleAlert, CircleCheck, Info, Route, Timer, TriangleAlert, type LucideIcon } from '../icons';
import { Banner } from './Banner';

const dayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: TZ });
/** Nombres de fichero sin leer que se ven sin desplegar. */
const SHOWN_SKIPPED = 3;

/** «5 salidas nuevas», «1 salida nueva». */
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${formatCount(n)} ${many}`);

/** «Cadencia en 5 de las 13 salidas nuevas»; sin «1 de las 1» ni «4 de las 4». */
function cadenceText(withCadence: number, added: number): string {
  if (added === 1) return 'La salida nueva trae cadencia';
  if (withCadence === added) return `Cadencia en las ${formatCount(added)} salidas nuevas`;
  return `Cadencia en ${formatCount(withCadence)} de las ${formatCount(added)} salidas nuevas`;
}

function Line({ icon: Icon, tone, figure, text, meta }: { icon: LucideIcon; tone: 'quiet' | 'bad'; figure: number; text: string; meta: string }) {
  return (
    <li>
      <div className="row">
        <span className={`row-lead row-lead--${tone}`} aria-hidden="true">
          <Icon className="ic" />
        </span>
        <span className="row-main">
          <span className="row-title">
            <span className="row-fig">{formatCount(figure)}</span> {text}
          </span>
          <span className="row-meta">{meta}</span>
        </span>
      </div>
    </li>
  );
}

/**
 * Informe de la importación: la cifra de salidas nuevas en grande con la acción siguiente, qué traía
 * el archivo, las incidencias (sin GPS, cadencia) y los ficheros que no se han podido leer, cada uno
 * con su causa. El título recibe el foco al aparecer.
 */
export const ImportReportView = forwardRef<HTMLHeadingElement, { report: ImportReport }>(function ImportReportView(
  { report },
  titleRef,
) {
  const { added, duplicates, notCycling, tooShort, skipped, noGps, withCadence, routesAdded } = report;
  const nothing = added === 0;
  const title = nothing && routesAdded === 0 ? (skipped.length > 0 ? 'Nada nuevo' : 'Ya lo tenías todo') : 'Importación terminada';
  const StatusIcon = nothing ? Info : CircleCheck;

  return (
    <>
      <section className="section" aria-labelledby="import-report-title">
        <div className="card done-card" data-nada={nothing || undefined}>
          <h2 className="status-line done-title" data-tone={nothing ? 'info' : 'good'}>
            <StatusIcon className="ic" aria-hidden="true" />
            <span id="import-report-title" ref={titleRef} tabIndex={-1}>
              {title}
            </span>
          </h2>
          <p className="glance-v">
            <span className="fig-i">{formatCount(added)}</span>
            <span className="u">{added === 1 ? ' salida nueva' : ' salidas nuevas'}</span>
          </p>
          {nothing && skipped.length > 0 ? (
            <p className="done-sub">
              {skipped.length === 1 ? '1 fichero sin leer: míralo abajo.' : `${formatCount(skipped.length)} ficheros sin leer: míralos abajo.`}
            </p>
          ) : null}
          <div className="done-actions">
            {nothing ? null : (
              <Link className="btn btn--primary btn--lg btn--block" to="/historial">
                {added === 1 ? 'Ver la salida nueva' : `Ver las ${formatCount(added)} salidas nuevas`}
              </Link>
            )}
            <Link className={nothing ? 'btn btn--primary btn--lg btn--block' : 'btn btn--secondary btn--block'} to="/">
              Ir a Inicio
            </Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="import-breakdown-title">
        <div className="section-h">
          <h2 className="section-title" id="import-breakdown-title">
            Qué traía el archivo
          </h2>
        </div>
        <ul className="list list--inset report-list">
          <Line icon={CircleCheck} tone="quiet" figure={duplicates} text={duplicates === 1 ? 'ya estaba' : 'ya estaban'} meta="No se duplican" />
          <Line
            icon={Timer}
            tone="quiet"
            figure={tooShort}
            text={tooShort === 1 ? 'demasiado corta, descartada' : 'demasiado cortas, descartadas'}
            meta="Menos de 200 m o de 1 min en movimiento"
          />
          <Line
            icon={Activity}
            tone="quiet"
            figure={notCycling}
            text={notCycling === 1 ? 'no es de bici, descartada' : 'no son de bici, descartadas'}
            meta="Carrera, caminatas y otros deportes"
          />
          {routesAdded > 0 ? (
            <Line
              icon={Route}
              tone="quiet"
              figure={routesAdded}
              text={routesAdded === 1 ? 'ruta de Strava añadida a tu biblioteca' : 'rutas de Strava añadidas a tu biblioteca'}
              meta="Están en Rutas › Biblioteca"
            />
          ) : null}
          <Line
            icon={CircleAlert}
            tone={skipped.length > 0 ? 'bad' : 'quiet'}
            figure={skipped.length}
            text="con error"
            meta={skipped.length > 0 ? 'El detalle, justo debajo' : 'Todos se han podido leer'}
          />
        </ul>
        {noGps.length > 0 ? (
          <Banner tone="warn" icon={TriangleAlert}>
            <b>{noGps.length === 1 ? `Una salida sin GPS: ${dayMonth.format(noGps[0].startTime)}` : plural(noGps.length, 'salida sin GPS', 'salidas sin GPS')}</b>
            {noGps.length === 1 ? '. Cuenta en tus totales, pero no tiene mapa.' : '. Cuentan en tus totales, pero no tienen mapa.'}
          </Banner>
        ) : null}
        {withCadence > 0 ? <Banner>{cadenceText(withCadence, added)}</Banner> : null}
      </section>

      {skipped.length > 0 ? (
        <section className="section" aria-labelledby="import-skipped-title">
          <div className="section-h">
            <h2 className="section-title" id="import-skipped-title">
              {skipped.length === 1 ? 'Un fichero sin leer' : `${formatCount(skipped.length)} ficheros sin leer`}
            </h2>
          </div>
          <div className="banner banner--error skipped">
            <CircleAlert className="ic" aria-hidden="true" />
            <p>Si son salidas que quieres, descárgalas otra vez de Strava y elígelas aquí.</p>
            <ul className="skip-list">
              {skipped.slice(0, SHOWN_SKIPPED).map((s, i) => (
                <SkippedItem key={`${i}-${s.file}`} file={s.file} reason={s.reason} />
              ))}
            </ul>
            {skipped.length > SHOWN_SKIPPED ? (
              <details className="skip-more">
                <summary>
                  {`Ver los ${formatCount(skipped.length)}`}
                  <ChevronDown className="ic" aria-hidden="true" />
                </summary>
                <ul className="skip-list">
                  {skipped.slice(SHOWN_SKIPPED).map((s, i) => (
                    <SkippedItem key={`${i}-${s.file}`} file={s.file} reason={s.reason} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
});

function SkippedItem({ file, reason }: { file: string; reason: string }) {
  return (
    <li>
      <span className="file-name">{file}</span>: {reason}
    </li>
  );
}
