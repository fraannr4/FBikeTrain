import { useState, type ChangeEvent, type DragEvent } from 'react';
import type { FolderFile } from '../../import/importService';
import { Clock, File, Folder, Upload } from '../icons';

export const ACCEPTED_EXTENSIONS = '.zip,.fit,.gpx,.tcx,.gz';

type Props = {
  onFiles: (files: (File | FolderFile)[]) => void;
  /** Sin importaciones previas: el título y el texto hablan del .zip completo. */
  firstTime?: boolean;
  /** «ayer», «hace 12 días»: cuándo fue la última importación. */
  lastImport?: string;
};

/** Todas las entradas de una carpeta. `readEntries` entrega por lotes: se llama hasta que devuelve vacío. */
async function readFolder(dir: FileSystemDirectoryEntry): Promise<FileSystemFileEntry[]> {
  const reader = dir.createReader();
  const found: FileSystemFileEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return found;
    for (const entry of batch) {
      if (entry.isDirectory) found.push(...(await readFolder(entry as FileSystemDirectoryEntry)));
      else found.push(entry as FileSystemFileEntry);
    }
  }
}

/** Ficheros de lo soltado, con su ruta relativa (`export_1/activities/1.gpx`) los que vienen de una carpeta. */
async function droppedFiles(entries: FileSystemEntry[]): Promise<(File | FolderFile)[]> {
  const out: (File | FolderFile)[] = [];
  for (const entry of entries) {
    const inFolder = entry.isDirectory;
    const files = inFolder ? await readFolder(entry as FileSystemDirectoryEntry) : [entry as FileSystemFileEntry];
    for (const f of files) {
      const file = await new Promise<File>((ok, fail) => f.file(ok, fail));
      out.push(inFolder ? { path: f.fullPath.replace(/^\//, ''), file } : file);
    }
  }
  return out;
}

/** Safari de iOS no sabe elegir carpetas: allí no se ofrece. */
const canPickFolder = () => 'webkitdirectory' in document.createElement('input');

/**
 * Tarjeta para elegir lo que se importa: ficheros o el .zip (un toque, WCAG 2.5.7), una carpeta
 * y, con ratón, soltar encima. Las curvas de nivel de fondo son un mapa en el que aún no hay nada.
 */
export function Dropzone({ onFiles, firstTime = false, lastImport }: Props) {
  const [over, setOver] = useState(false);

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    setOver(true);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    // Las entradas solo se pueden pedir durante el evento; después el navegador vacía `items`.
    const entries = Array.from(e.dataTransfer.items ?? []).flatMap((i) => i.webkitGetAsEntry?.() ?? []);
    if (entries.some((entry) => entry.isDirectory)) {
      void droppedFiles(entries).then((files) => {
        if (files.length > 0) onFiles(files);
      });
      return;
    }
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Vaciar el valor para poder elegir otra vez el mismo fichero.
    e.target.value = '';
    if (files.length > 0) onFiles(files);
  }

  function onFolderChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).map((file) => ({ path: file.webkitRelativePath || file.name, file }));
    e.target.value = '';
    if (files.length > 0) onFiles(files);
  }

  return (
    <section
      aria-label="Ficheros para importar"
      className="card pick"
      data-m="dist"
      data-over={over || undefined}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="card-h">
        <span className="card-ic" aria-hidden="true">
          <Upload className="ic" />
        </span>
        <h2 className="card-title">{firstTime ? 'Tu archivo de Strava' : 'Añadir salidas nuevas'}</h2>
      </div>
      {/* En el móvil no se arrastra: allí se explica qué elegir; con ratón, que se puede soltar. */}
      <p className="pick-text pick-text--touch">
        {firstTime ? (
          <>
            El <b>.zip</b> que Strava te envía por correo, tal cual: sin descomprimirlo ni cambiarle el nombre.
          </>
        ) : (
          <>
            Ficheros sueltos <b>.fit, .gpx o .tcx</b> (también en .gz) o el <b>.zip</b> completo de Strava.
          </>
        )}
      </p>
      <div className="pick-text pick-text--drop">
        <p>
          <b>Suelta aquí el ZIP de Strava tal cual lo descargas, sin descomprimirlo.</b> Se importan todas tus salidas
          de una vez; las carreras y caminatas se descartan solas.
        </p>
        <p>Si ya lo has descomprimido, suelta o elige la carpeta entera. También valen ficheros FIT, GPX o TCX sueltos.</p>
      </div>
      <div className="pick-actions">
        <label className="btn btn--primary btn--lg btn--block">
          <input
            id="import-files"
            className="sr-only"
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            onChange={onChange}
          />
          <File className="ic" aria-hidden="true" />
          <span>Elegir el ZIP o ficheros</span>
        </label>
        {canPickFolder() ? (
          <label className="btn btn--secondary btn--block">
            {/* webkitdirectory no está en los tipos de React; con '' el atributo sale sin valor. */}
            <input
              id="import-folder"
              className="sr-only"
              type="file"
              {...{ webkitdirectory: '' }}
              onChange={onFolderChange}
            />
            <Folder className="ic" aria-hidden="true" />
            <span>Elegir carpeta</span>
          </label>
        ) : null}
      </div>
      {lastImport ? (
        <p className="card-foot">
          <Clock className="ic" aria-hidden="true" />
          Última importación: {lastImport}
        </p>
      ) : null}
    </section>
  );
}
