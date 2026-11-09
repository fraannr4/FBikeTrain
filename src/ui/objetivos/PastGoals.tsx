import { useState } from 'react';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { ChevronRight, CircleCheck, Target } from '../icons';
import { NNBSP, pctText, type PastRow } from './model';

/** Filas de «Anteriores» que caben en la página; el resto, en la hoja. */
const SHOWN = 4;

type Filter = 'all' | PastRow['kind'];
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'week', label: 'Semanas' },
  { value: 'month', label: 'Meses' },
  { value: 'event', label: 'Eventos' },
];

function Row({ r }: { r: PastRow }) {
  const Icon = r.ok ? CircleCheck : Target;
  return (
    <li>
      <div className="row" data-ok={r.ok || undefined}>
        <span className="row-lead" aria-hidden="true">
          <Icon className="ic" />
        </span>
        <span className="row-main">
          <span className="row-title">{r.title}</span>
          {r.meta ? <span className="row-meta">{r.meta}</span> : null}
        </span>
        <span className="row-trail">
          <span className={r.ok ? 'row-val is-good' : 'row-val'}>
            {pctText(r.pct)}
            <span className="u">{NNBSP}%</span>
          </span>
        </span>
      </div>
    </li>
  );
}

/** «Anteriores» (objetivos.html): los últimos cuatro y, en una hoja, todos con su filtro. */
export function PastGoals({ rows }: { rows: PastRow[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  if (rows.length === 0) return null;
  const kinds = new Set(rows.map((r) => r.kind));
  const options = FILTERS.filter((f) => f.value === 'all' || kinds.has(f.value));
  const shown = rows.filter((r) => filter === 'all' || r.kind === filter);
  const won = shown.filter((r) => r.ok).length;

  return (
    <section className="section prev" aria-labelledby="prev-t">
      <div className="section-h">
        <h2 className="section-title" id="prev-t">
          Anteriores
        </h2>
        {rows.length > SHOWN ? (
          <button className="card-link" type="button" onClick={() => setOpen(true)}>
            Ver los {rows.length}
            <ChevronRight className="ic" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ul className="list list--inset">
        {rows.slice(0, SHOWN).map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
      <Sheet open={open} onClose={() => setOpen(false)} title="Objetivos anteriores" sub={`Conseguidos ${won} de ${shown.length}.`}>
        {options.length > 2 ? (
          <SegmentedControl className="prev-seg" label="Mostrar" quiet value={filter} options={options} onChange={setFilter} />
        ) : null}
        <ul className="list list--inset prev">
          {shown.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </ul>
      </Sheet>
    </section>
  );
}
