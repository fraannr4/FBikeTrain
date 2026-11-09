import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Importar } from '../src/ui/pages/Importar';
import { ImporterContext, type Importer } from '../src/ui/importer';
import type { ImportReport } from '../src/import/importService';
import { ToastProvider } from '../src/ui/components/Toast';
import { fullText } from './helpers/text';

// La pantalla lleva la barra superior del kit (enlace de volver): se monta con un router en memoria.
function renderWith(importer: Importer) {
  return render(
    <MemoryRouter initialEntries={['/importar']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <ImporterContext.Provider value={importer}>
          <Importar />
        </ImporterContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

// Chrome sabe elegir carpetas (`webkitdirectory`); jsdom no lo trae.
if (!('webkitdirectory' in HTMLInputElement.prototype)) {
  Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', { configurable: true, writable: true, value: false });
}

const EMPTY_REPORT: ImportReport = { added: 0, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0 };

const gpx = () => new File(['<gpx/>'], 'ride.gpx', { type: 'application/gpx+xml' });
const PICK_FILES = 'Elegir el ZIP o ficheros';
const PICK_FOLDER = 'Elegir carpeta';

/** Entradas falsas de FileSystem API, como las de un drop de carpeta en Chrome. readEntries entrega por lotes. */
function fileEntry(path: string): FileSystemFileEntry {
  const file = new File(['x'], path.split('/').pop()!);
  return { isFile: true, isDirectory: false, fullPath: `/${path}`, file: (ok: (f: File) => void) => ok(file) } as unknown as FileSystemFileEntry;
}
function dirEntry(path: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  const batches = [children.slice(0, 1), children.slice(1), []];
  return {
    isFile: false,
    isDirectory: true,
    fullPath: `/${path}`,
    createReader: () => ({ readEntries: (ok: (e: FileSystemEntry[]) => void) => ok(batches.shift() ?? []) }),
  } as unknown as FileSystemDirectoryEntry;
}

describe('Importar', () => {
  it('shows title, help and a link to the Strava steps', () => {
    renderWith(vi.fn());
    expect(screen.getByRole('heading', { level: 1, name: 'Importar salidas' })).toBeInTheDocument();
    expect(screen.getByText(/Suelta aquí el ZIP de Strava tal cual lo descargas, sin descomprimirlo/)).toBeInTheDocument();
    expect(screen.getByText(/Si ya lo has descomprimido, suelta o elige la carpeta entera/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pedir el archivo en Strava/ })).toHaveAttribute(
      'href',
      expect.stringContaining('strava.com'),
    );
  });

  it('shows progress while importing', async () => {
    const importer: Importer = (_files, onProgress) => {
      onProgress(3, 10);
      return new Promise<ImportReport>(() => {});
    };
    const user = userEvent.setup();
    renderWith(importer);
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText('3 de 10')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '3');
  });

  it('shows report', async () => {
    const report: ImportReport = {
      added: 5,
      duplicates: 2,
      notCycling: 36,
      tooShort: 3,
      skipped: [{ file: 'corrupt.fit', reason: 'fichero dañado' }],
      noGps: [],
      withCadence: 0,
    };
    const user = userEvent.setup();
    renderWith(async () => report);
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText(fullText('5 salidas nuevas'))).toBeInTheDocument();
    expect(screen.getByText(fullText('2 ya estaban'))).toBeInTheDocument();
    expect(screen.getByText(fullText('36 no son de bici, descartadas'))).toBeInTheDocument();
    expect(screen.getByText(fullText('3 demasiado cortas, descartadas'))).toBeInTheDocument();
    expect(screen.getByText(fullText('1 con error'))).toBeInTheDocument();
    expect(screen.getByText('corrupt.fit')).toBeInTheDocument();
    expect(screen.getByText(/fichero dañado/)).toBeInTheDocument();
  });

  it('formats large counts as es-ES', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({ added: 1240, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0 }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText(fullText('1240 salidas nuevas'))).toBeInTheDocument();
    expect(screen.getByText(fullText('0 ya estaban'))).toBeInTheDocument();
  });

  it('one too short ride is singular', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({ added: 0, duplicates: 0, notCycling: 0, tooShort: 1, skipped: [], noGps: [], withCadence: 0 }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText(fullText('1 demasiado corta, descartada'))).toBeInTheDocument();
  });

  it('accepts drop and file picker', async () => {
    const importer = vi.fn<Importer>(async () => ({ added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0 }));
    const user = userEvent.setup();
    renderWith(importer);

    const input = screen.getByLabelText(PICK_FILES);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.zip,.fit,.gpx,.tcx,.gz');

    const picked = gpx();
    await user.upload(input, picked);
    expect(importer).toHaveBeenLastCalledWith([picked], expect.any(Function), expect.any(AbortSignal));
    expect(await screen.findByText(fullText('1 salida nueva'))).toBeInTheDocument();

    const dropped = new File(['x'], 'export.zip', { type: 'application/zip' });
    fireEvent.drop(screen.getByRole('region', { name: 'Ficheros para importar' }), { dataTransfer: { files: [dropped] } });
    expect(importer).toHaveBeenLastCalledWith([dropped], expect.any(Function), expect.any(AbortSignal));
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('folder picker sends every file with its relative path', async () => {
    const importer = vi.fn<Importer>(async () => ({ added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0 }));
    const user = userEvent.setup();
    renderWith(importer);

    const input = screen.getByLabelText(PICK_FOLDER);
    expect(input).toHaveAttribute('webkitdirectory');
    const csv = new File(['a'], 'activities.csv');
    Object.defineProperty(csv, 'webkitRelativePath', { value: 'export_1/activities.csv' });
    await user.upload(input, csv);
    expect(importer).toHaveBeenLastCalledWith([{ path: 'export_1/activities.csv', file: csv }], expect.any(Function), expect.any(AbortSignal));
  });

  it('dropping a folder reads it recursively', async () => {
    const importer = vi.fn<Importer>(async () => ({ added: 1, duplicates: 0, notCycling: 0, tooShort: 0, skipped: [], noGps: [], withCadence: 0 }));
    renderWith(importer);

    const folder = dirEntry('export_1', [
      fileEntry('export_1/activities.csv'),
      dirEntry('export_1/activities', [fileEntry('export_1/activities/1.gpx'), fileEntry('export_1/activities/2.fit')]),
    ]);
    fireEvent.drop(screen.getByRole('region', { name: 'Ficheros para importar' }), {
      dataTransfer: { files: [new File([], 'export_1')], items: [{ kind: 'file', webkitGetAsEntry: () => folder }] },
    });

    await waitFor(() => expect(importer).toHaveBeenCalledTimes(1));
    const [sent] = importer.mock.calls[0];
    expect(sent.map((f) => ('path' in f ? f.path : f.name))).toEqual([
      'export_1/activities.csv',
      'export_1/activities/1.gpx',
      'export_1/activities/2.fit',
    ]);
  });

  it('explains when the import fails', async () => {
    const user = userEvent.setup();
    renderWith(async () => {
      throw new Error('worker crashed');
    });
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido importar: worker crashed');
    expect(screen.getByLabelText(PICK_FILES)).toBeEnabled();
  });

  it('progress shows steps with the current one', async () => {
    const importer: Importer = (_files, onProgress) => {
      onProgress(3, 10, 'activities');
      return new Promise<ImportReport>(() => {});
    };
    const user = userEvent.setup();
    renderWith(importer);
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    const steps = await screen.findByRole('list', { name: 'Fases' });
    const current = within(steps)
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Leer y guardar las actividades');
    expect(screen.getByText(fullText('30 %'))).toBeInTheDocument();
  });

  it('cancel aborts the import', async () => {
    let received: AbortSignal | undefined;
    const importer: Importer = (_files, onProgress, signal) => {
      received = signal;
      onProgress(1, 4, 'activities');
      return new Promise<ImportReport>((_ok, fail) => {
        signal?.addEventListener('abort', () => fail(new DOMException('Importación cancelada', 'AbortError')));
      });
    };
    const user = userEvent.setup();
    renderWith(importer);
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    await user.click(await screen.findByRole('button', { name: 'Parar la importación' }));
    const sheet = await screen.findByRole('dialog', { name: '¿Parar la importación?' });
    await user.click(within(sheet).getByRole('button', { name: 'Parar' }));
    expect(received?.aborted).toBe(true);
    expect(await screen.findByText('Importación parada. Las salidas ya guardadas se quedan.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(PICK_FILES)).toBeEnabled();
  });

  it('report lists rides without GPS', async () => {
    const user = userEvent.setup();
    const sept12 = Date.UTC(2026, 8, 12, 8, 0, 0);
    renderWith(async () => ({ ...EMPTY_REPORT, added: 3, noGps: [{ file: 'rodillo.fit', startTime: sept12 }] }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText('Una salida sin GPS: 12 de septiembre')).toBeInTheDocument();
  });

  it('report counts several rides without GPS', async () => {
    const user = userEvent.setup();
    const t = Date.UTC(2026, 8, 12, 8, 0, 0);
    renderWith(async () => ({
      ...EMPTY_REPORT,
      added: 3,
      noGps: [
        { file: 'a.fit', startTime: t },
        { file: 'b.fit', startTime: t + 86_400_000 },
      ],
    }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText('2 salidas sin GPS')).toBeInTheDocument();
  });

  it('report says cadence in N of M', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({ ...EMPTY_REPORT, added: 13, withCadence: 5 }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText('Cadencia en 5 de las 13 salidas nuevas')).toBeInTheDocument();
  });

  it('report says cadence of a single new ride without counting', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({ ...EMPTY_REPORT, added: 1, withCadence: 1 }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText('La salida nueva trae cadencia')).toBeInTheDocument();
  });

  it('report says cadence in all the new rides', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({ ...EMPTY_REPORT, added: 4, withCadence: 4 }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText('Cadencia en las 4 salidas nuevas')).toBeInTheDocument();
  });

  it('report with nothing new says so and offers Inicio', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({ ...EMPTY_REPORT, duplicates: 214 }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByText('Ya lo tenías todo')).toBeInTheDocument();
    // Enlace del router (en la app, «#/»): el router en memoria de la prueba lo pinta sin almohadilla.
    expect(screen.getByRole('link', { name: 'Ir a Inicio' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: /^Ver / })).not.toBeInTheDocument();
  });

  it('report links to the new rides', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({ ...EMPTY_REPORT, added: 13 }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByRole('link', { name: 'Ver las 13 salidas nuevas' })).toHaveAttribute('href', '/historial');
  });

  it('report shows the first three unread files and folds the rest', async () => {
    const user = userEvent.setup();
    const skipped = Array.from({ length: 5 }, (_, i) => ({ file: `roto-${i}.fit`, reason: 'fichero dañado' }));
    renderWith(async () => ({ ...EMPTY_REPORT, skipped }));
    await user.upload(screen.getByLabelText(PICK_FILES), gpx());
    expect(await screen.findByRole('heading', { name: '5 ficheros sin leer' })).toBeInTheDocument();
    expect(screen.getByText('Ver los 5')).toBeInTheDocument();
    expect(document.querySelectorAll('.file-name')).toHaveLength(5);
  });
});
