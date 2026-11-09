import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FolderFile, ImportPhase, ImportReport } from '../../import/importService';
import { useImporter } from '../importer';
import { daysAgoLabel, formatCount, formatNumber } from '../format';
import { useMeta } from '../hooks/useMeta';
import { CircleAlert, ExternalLink, File, Info, Mail } from '../icons';
import { Banner } from '../components/Banner';
import { Disclosure } from '../components/Disclosure';
import { Dropzone } from '../components/Dropzone';
import { ImportProgress } from '../components/ImportProgress';
import { ImportReportView } from '../components/ImportReportView';
import { Page } from '../components/Page';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';

const STRAVA_EXPORT_HELP = 'https://support.strava.com/hc/es-es/articles/216918437-Exportar-tus-datos-y-descarga-masiva';
const DAY = 86_400_000;

type State =
  | { kind: 'idle' }
  | { kind: 'importing'; label: string; size: string; done: number; total: number; phase: ImportPhase }
  | { kind: 'done'; report: ImportReport }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

const fileOf = (f: File | FolderFile): File => ('path' in f ? f.file : f);

/** «export_123.zip», la carpeta «export_123» o «12 ficheros». */
function describe(files: (File | FolderFile)[]): string {
  const first = files[0];
  if ('path' in first) return first.path.split('/')[0] || first.file.name;
  return files.length === 1 ? first.name : `${formatCount(files.length)} ficheros`;
}

function size(bytes: number): string {
  if (bytes >= 1e6) return `${formatNumber(bytes / 1e6, bytes < 1e7 ? 1 : 0)} MB`;
  return `${formatCount(Math.max(1, bytes / 1e3))} kB`;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function Importar() {
  const importer = useImporter();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [askStop, setAskStop] = useState(false);
  const meta = useMeta(state.kind === 'done' ? state : undefined);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const reportTitle = useRef<HTMLHeadingElement>(null);
  const errorTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  // Al terminar o fallar, el resultado sube arriba y su título recibe el foco.
  useEffect(() => {
    const target = state.kind === 'done' ? reportTitle.current : state.kind === 'error' ? errorTitle.current : null;
    if (!target) return;
    window.scrollTo?.(0, 0);
    target.focus({ preventScroll: true });
  }, [state.kind]);

  async function start(files: (File | FolderFile)[]) {
    const ctrl = new AbortController();
    controller.current = ctrl;
    const label = describe(files);
    const bytes = files.reduce((sum, f) => sum + fileOf(f).size, 0);
    setState({ kind: 'importing', label, size: size(bytes), done: 0, total: files.length, phase: 'open' });
    try {
      const report = await importer(
        files,
        (done, total, phase) => {
          if (alive.current && !ctrl.signal.aborted)
            setState({ kind: 'importing', label, size: size(bytes), done, total, phase: phase ?? 'activities' });
        },
        ctrl.signal,
      );
      if (!alive.current) return;
      setState({ kind: 'done', report });
      const { added, duplicates } = report;
      if (added > 0) toast(added === 1 ? '1 salida importada' : `${formatCount(added)} salidas importadas`, { tone: 'good' });
      else if (duplicates > 0)
        toast(duplicates === 1 ? 'Nada nuevo: la salida ya estaba' : `Nada nuevo: las ${formatCount(duplicates)} salidas ya estaban`);
    } catch (e) {
      if (!alive.current) return;
      if (isAbort(e) || ctrl.signal.aborted) setState({ kind: 'cancelled' });
      else setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }

  function stop() {
    setAskStop(false);
    controller.current?.abort();
  }

  const importing = state.kind === 'importing';
  const quiet = importing || state.kind === 'done';
  const firstTime = meta !== null && meta.lastImportAt === undefined;
  const lastImport =
    meta?.lastImportAt !== undefined ? daysAgoLabel(Math.floor((Date.now() - meta.lastImportAt) / DAY)) : undefined;

  const pick = (
    <section className="section" aria-label="Elegir">
      <Dropzone onFiles={start} firstTime={firstTime} lastImport={lastImport} />
    </section>
  );

  return (
    <Page
      title="Importar salidas"
      back="/mas"
      variant="narrow"
      className="page--importar"
      lead={
        quiet ? undefined : firstTime ? (
          <>
            Empieza por <b>tu historial completo</b> de Strava. Se lee aquí, en el navegador: nada sale de tu teléfono.
          </>
        ) : (
          <>
            Se leen aquí, en el navegador. <b>Nada sale de tu teléfono</b> y lo que ya tienes no se duplica.
          </>
        )
      }
    >
      {state.kind === 'importing' ? (
        <section className="section" aria-label="Importando">
          <ImportProgress
            fileLabel={state.label}
            fileMeta={state.size}
            done={state.done}
            total={state.total}
            phase={state.phase}
            onCancel={() => setAskStop(true)}
          />
          <Banner>Deja esta pestaña abierta. Si cambias de app, el teléfono puede pausar la importación.</Banner>
        </section>
      ) : null}

      {state.kind === 'done' ? <ImportReportView ref={reportTitle} report={state.report} /> : null}

      {state.kind === 'error' ? (
        <section className="section" aria-label="Error">
          <div className="card err-card" role="alert">
            <div className="state state--error">
              <span className="state-ic" aria-hidden="true">
                <CircleAlert className="ic" />
              </span>
              <h2 className="state-title" ref={errorTitle} tabIndex={-1}>
                La importación ha fallado
              </h2>
              <p className="state-text">
                No se ha podido importar: {state.message}. Vuelve a intentarlo con los mismos ficheros.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div role="status" className="import-status">
        {state.kind === 'cancelled' ? (
          <Banner icon={Info}>Importación parada. Las salidas ya guardadas se quedan.</Banner>
        ) : null}
      </div>

      {importing ? null : pick}

      {importing ? null : (
        <section className="section" aria-labelledby="ayuda-t">
          <div className="section-h">
            <h2 className="section-title" id="ayuda-t">
              Cómo conseguir los ficheros
            </h2>
          </div>
          <div className="help-list">
            {firstTime ? null : (
              <Disclosure name="ayuda" icon={File} accent="time" title="Una salida suelta" meta="Desde la web de Strava, en un minuto">
                <ol className="steps">
                  <Step n={1} title="Abre la salida en strava.com">
                    Desde el navegador del teléfono; la app de Strava no exporta.
                  </Step>
                  <Step n={2} title="Exporta el fichero">
                    En el menú de la salida, <b>Exportar original</b> (o Exportar GPX). Se guarda en Descargas.
                  </Step>
                  <Step n={3} title="Vuelve aquí y elígelo">
                    Puedes elegir varios a la vez.
                  </Step>
                </ol>
              </Disclosure>
            )}
            <Disclosure
              name="ayuda"
              icon={Mail}
              accent="elev"
              title="Todo tu historial"
              meta="El .zip de Strava; llega por correo en unas horas"
              defaultOpen={firstTime}
              key={firstTime ? 'zip-abierto' : 'zip'}
            >
              <ol className="steps">
                <Step n={1} title="Pide el archivo">
                  En strava.com: Ajustes, Mi cuenta, <b>Descargar o eliminar tu cuenta</b> y Solicitar tu archivo.
                </Step>
                <Step n={2} title="Espera el correo">
                  Strava lo prepara y te lo envía. Suele tardar <b>unas horas</b>.
                </Step>
                <Step n={3} title="Descárgalo y elígelo aquí">
                  Toca el enlace del correo: el .zip se guarda en Descargas. No lo descomprimas.
                </Step>
              </ol>
              <a className="btn btn--secondary btn--block" href={STRAVA_EXPORT_HELP} target="_blank" rel="noreferrer">
                <ExternalLink className="ic" aria-hidden="true" />
                Pasos para pedir el archivo en Strava
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </Disclosure>
          </div>
        </section>
      )}

      <Sheet
        open={askStop}
        onClose={() => setAskStop(false)}
        title="¿Parar la importación?"
        sub="Lo ya guardado se queda."
        footer={
          <>
            <button type="button" className="btn btn--danger btn--block" onClick={stop}>
              Parar
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setAskStop(false)}>
              Seguir importando
            </button>
          </>
        }
      >
        <p className="run-sub">Para traer el resto, vuelve a elegir el mismo archivo: lo que ya está no se duplica.</p>
      </Sheet>
    </Page>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li>
      <span className="hito-n" aria-hidden="true">
        {n}
      </span>
      <span className="step-main">
        <span className="step-title">{title}</span>
        <span className="step-text">{children}</span>
      </span>
    </li>
  );
}
