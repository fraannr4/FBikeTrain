import { useEffect, useId, useState, type ReactNode } from 'react';
import { SOURCE_NAMES } from '../../routes/library/generate';
import { parseBound, type CatalogFilter, type CatalogSort } from '../../routes/library/catalogView';
import type { ReferenceSource } from '../../routes/library/rows';
import { FilterChip } from '../components/Chip';
import { Field } from '../components/Field';
import { Sheet } from '../components/Sheet';
import { formatCount } from '../format';

export const sourceName = (s: ReferenceSource) => SOURCE_NAMES[s] ?? 'Otra fuente';

const SORT_LABELS: Record<CatalogSort, string> = {
  near: 'Más cerca de tu inicio', long: 'Más larga primero', short: 'Más corta primero', climb: 'Más desnivel primero', flat: 'Menos desnivel primero', name: 'Nombre',
};
export const RADII_KM = [25, 50, 100, 150];

/** Campo de un límite numérico: conserva lo que se escribe («4,») y entrega el número o `null`. */
function BoundField({ label, suffix, value, onChange }: { label: string; suffix: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  // Un «Quitar filtros» desde fuera vacía el campo.
  useEffect(() => { setText(t => parseBound(t) === value ? t : value === null ? '' : String(value)); }, [value]);
  return <Field label={label} suffix={suffix} type="text" inputMode="decimal" autoComplete="off" maxLength={6} placeholder="Sin límite" value={text} onChange={e => { setText(e.target.value); onChange(parseBound(e.target.value)); }} />;
}

type ControlsProps = {
  filter: CatalogFilter;
  onChange: (patch: Partial<CatalogFilter>) => void;
  sources: ReferenceSource[];
  radiusKm: number;
  onRadius: (km: number) => void;
};

/** Distancia, desnivel, fuente, circulares, orden y radio. Se pinta en la hoja (móvil) o en línea (escritorio). */
export function FilterControls({ filter, onChange, sources, radiusKm, onRadius }: ControlsProps) {
  const id = useId();
  return (
    <div className="lib-controls">
      <fieldset className="lib-range">
        <legend className="sheet-group-title">Distancia</legend>
        <BoundField label="Desde" suffix="km" value={filter.minKm} onChange={minKm => onChange({ minKm })} />
        <BoundField label="Hasta" suffix="km" value={filter.maxKm} onChange={maxKm => onChange({ maxKm })} />
      </fieldset>
      <fieldset className="lib-range">
        <legend className="sheet-group-title">Desnivel</legend>
        <BoundField label="Desde" suffix="m" value={filter.minGain} onChange={minGain => onChange({ minGain })} />
        <BoundField label="Hasta" suffix="m" value={filter.maxGain} onChange={maxGain => onChange({ maxGain })} />
        {filter.minGain !== null || filter.maxGain !== null ? <p className="meta lib-range-note">Las rutas sin altitud no entran.</p> : null}
      </fieldset>
      <div className="lib-field">
        <p className="sheet-group-title" id={`${id}-trazado`}>Trazado</p>
        <div className="cluster" role="group" aria-labelledby={`${id}-trazado`}>
          <FilterChip pressed={filter.loopOnly} onClick={() => onChange({ loopOnly: !filter.loopOnly })}>Solo circulares</FilterChip>
        </div>
      </div>
      {sources.length > 1 ? (
        <div className="lib-field">
          <p className="sheet-group-title" id={`${id}-fuente`}>Fuente</p>
          <div className="cluster" role="group" aria-labelledby={`${id}-fuente`}>
            <FilterChip pressed={filter.source === 'all'} onClick={() => onChange({ source: 'all' })}>Todas</FilterChip>
            {sources.map(s => <FilterChip key={s} pressed={filter.source === s} onClick={() => onChange({ source: s })}>{sourceName(s)}</FilterChip>)}
          </div>
        </div>
      ) : null}
      <div className="lib-field">
        <label className="field-label" htmlFor={`${id}-orden`}>Ordenar por</label>
        <select id={`${id}-orden`} className="input" value={filter.sort} onChange={e => onChange({ sort: e.target.value as CatalogSort })}>
          {(Object.keys(SORT_LABELS) as CatalogSort[]).map(k => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="lib-field">
        <p className="sheet-group-title" id={`${id}-radio`}>Salen a menos de</p>
        <div className="cluster" role="group" aria-labelledby={`${id}-radio`}>
          {RADII_KM.map(km => <FilterChip key={km} pressed={radiusKm === km} onClick={() => onRadius(km)}>{km} km</FilterChip>)}
        </div>
      </div>
    </div>
  );
}

/** Hoja de filtros del móvil. Todo se aplica en directo; el pie dice cuántas rutas quedan. */
export function FilterSheet({ open, onClose, count, onReset, children }: { open: boolean; onClose: () => void; count: number; onReset: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title="Filtrar y ordenar" className="hist-sheet lib-sheet"
      footer={<div className="btn-row">
        <button type="button" className="btn btn--secondary" onClick={onReset}>Quitar filtros</button>
        <button type="button" className="btn btn--primary" onClick={onClose}>{count > 0 ? `Ver ${formatCount(count)} ${count === 1 ? 'ruta' : 'rutas'}` : 'Ver resultados'}</button>
      </div>}>
      {children}
    </Sheet>
  );
}
