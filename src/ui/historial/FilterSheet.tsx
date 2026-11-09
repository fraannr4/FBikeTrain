import type { Difficulty } from '../../metrics/reference';
import { DifficultyBars, FilterChip } from '../components/Chip';
import { ListRow } from '../components/ListRow';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { formatCount } from '../format';
import { Repeat } from '../icons';
import type { DistKey, SortKey } from './model';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'fecha', label: 'Fecha' },
  { value: 'km', label: 'Distancia' },
  { value: 'm', label: 'Desnivel' },
  { value: 'kmh', label: 'Velocidad' },
];

export const DIST_LABEL: Record<Exclude<DistKey, 'all'>, string> = {
  lt50: 'Menos de 50 km',
  '50-90': 'De 50 a 90 km',
  gt90: 'Más de 90 km',
};

const DIST_OPTIONS: { value: DistKey; label: string }[] = [
  { value: 'all', label: 'Cualquiera' },
  ...(Object.entries(DIST_LABEL) as [DistKey, string][]).map(([value, label]) => ({ value, label })),
];

export const LEVELS: Difficulty[] = ['Suave', 'Media', 'Dura'];
const LEVEL_TONE: Record<Difficulty, string> = { Suave: 'easy', Media: 'mid', Dura: 'hard' };

export type SheetState = {
  sort: SortKey;
  year: number | null;
  dist: DistKey;
  dif: Difficulty[];
  rep: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  state: SheetState;
  onChange: (patch: Partial<SheetState>) => void;
  onReset: () => void;
  /** Años con salidas, del más reciente al más antiguo. Con uno solo no se ofrece el periodo. */
  years: number[];
  thisYear: number;
  /** Sin referencia de nivel no hay dificultad que filtrar. */
  hasLevels: boolean;
  /** Sin rutas repetidas, el interruptor sobra. */
  hasRepeated: boolean;
  /** Salidas que se verían con lo elegido. */
  count: number;
};

export const yearLabel = (y: number, thisYear: number) => (y === thisYear ? 'Este año' : String(y));

/** Hoja de filtros y orden. Todo se aplica en directo; el pie dice cuántas salidas quedan. */
export function FilterSheet({ open, onClose, state, onChange, onReset, years, thisYear, hasLevels, hasRepeated, count }: Props) {
  const toggleLevel = (l: Difficulty) =>
    onChange({ dif: state.dif.includes(l) ? state.dif.filter((x) => x !== l) : [...state.dif, l] });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filtrar y ordenar"
      className="hist-sheet"
      footer={
        <>
          {count === 0 ? <p className="meta">Ninguna salida coincide con estos filtros.</p> : null}
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={onReset}>
              Restablecer
            </button>
            <button type="button" className="btn btn--primary" onClick={onClose}>
              {count > 0 ? `Ver ${formatCount(count)} ${count === 1 ? 'salida' : 'salidas'}` : 'Ver resultados'}
            </button>
          </div>
        </>
      }
    >
      <div className="sheet-group">
        <p className="sheet-group-title">Ordenar por</p>
        <SegmentedControl label="Ordenar por" options={SORT_OPTIONS} value={state.sort} onChange={(sort) => onChange({ sort })} />
      </div>
      {years.length > 1 ? (
        <div className="sheet-group">
          <p className="sheet-group-title" id="hf-per">
            Periodo
          </p>
          <div className="cluster" role="group" aria-labelledby="hf-per">
            <FilterChip pressed={state.year === null} onClick={() => onChange({ year: null })}>
              Todos
            </FilterChip>
            {years.map((y) => (
              <FilterChip key={y} pressed={state.year === y} onClick={() => onChange({ year: y })}>
                {yearLabel(y, thisYear)}
              </FilterChip>
            ))}
          </div>
        </div>
      ) : null}
      <div className="sheet-group">
        <p className="sheet-group-title" id="hf-dist">
          Distancia
        </p>
        <div className="cluster" role="group" aria-labelledby="hf-dist">
          {DIST_OPTIONS.map((o) => (
            <FilterChip key={o.value} pressed={state.dist === o.value} onClick={() => onChange({ dist: o.value })}>
              {o.label}
            </FilterChip>
          ))}
        </div>
      </div>
      {hasLevels ? (
        <div className="sheet-group">
          <p className="sheet-group-title" id="hf-dif">
            Dificultad para ti
          </p>
          <p className="meta">Frente a tu nivel de las últimas semanas. Sin marcar, todas.</p>
          <div className="cluster" role="group" aria-labelledby="hf-dif">
            {LEVELS.map((l) => (
              <FilterChip key={l} pressed={state.dif.includes(l)} onClick={() => toggleLevel(l)}>
                <span className={`dif dif--${LEVEL_TONE[l]}`}>
                  <DifficultyBars level={l} />
                </span>
                {l}
              </FilterChip>
            ))}
          </div>
        </div>
      ) : null}
      {hasRepeated ? (
        <div className="sheet-group">
          <ul className="list">
            <ListRow
              icon={Repeat}
              accent="time"
              title="Solo rutas repetidas"
              titleId="hf-rep"
              meta="Las que has hecho dos veces o más"
              trail={
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={state.rep}
                  aria-labelledby="hf-rep"
                  onClick={() => onChange({ rep: !state.rep })}
                />
              }
            />
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}
