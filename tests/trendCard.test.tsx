import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { StoredActivity } from '../src/domain/types';
import type { Accent } from '../src/ui/accent';
import { TrendCard } from '../src/ui/inicio/TrendCard';
import { weeklyTrend } from '../src/ui/inicio/trend';

// jsdom no trae PointerEvent: sin él, el evento llega sin coordenadas.
if (typeof window.PointerEvent !== 'function') {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'touch';
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
}

// Viernes 6 de noviembre de 2026, 13:00 en Madrid.
const NOW = Date.parse('2026-11-06T12:00:00Z');
const WEEK = 7 * 86_400_000;
const TUE_17_AUG = Date.parse('2026-08-18T08:00:00Z');

function ride(startTime: number, km: number, timeS = km * 150): StoredActivity {
  return {
    id: `r-${startTime}`,
    startTime,
    sport: 'cycling',
    totals: { distanceM: km * 1000, movingTimeS: timeS, elapsedTimeS: timeS, elevGainM: km * 10, avgSpeedMs: 0, maxSpeedMs: 0 },
    hasTrack: false,
    source: 'fit',
    importedAt: NOW,
  };
}

// 100 km cada martes de las 11 semanas completas, salvo la del 7 de septiembre (sin salidas),
// y 50 km esta semana.
const acts = [
  ...Array.from({ length: 11 }, (_, k) => k)
    .filter((k) => k !== 3)
    .map((k) => ride(TUE_17_AUG + k * WEEK, 100)),
  ride(Date.parse('2026-11-03T08:00:00Z'), 50),
];

function Harness({ data = acts }: { data?: StoredActivity[] }) {
  const [metric, setMetric] = useState<Accent>('dist');
  return <TrendCard trend={weeklyTrend(data, NOW)} metric={metric} onMetricChange={setMetric} />;
}

const card = () => screen.getByRole('region', { name: 'Tus últimas 12 semanas' });
const readout = () => card().querySelector('.trend-read')?.textContent;

describe('TrendCard', () => {
  it('reads the current week by default', () => {
    render(<Harness />);
    // Media de 1000 km en 11 semanas: 91 km, y todo cae antes del viernes.
    expect(readout()).toBe('Esta semana, en curso: 50 km. A estas alturas sueles llevar 91 km; la semana completa, 91 km.');
    expect(within(card()).getByRole('img', { name: /^Distancia por semana en las últimas 12 semanas/ })).toBeInTheDocument();
  });

  it('draws one bar per week with rides and highlights the selected one', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('.trend-chart .bar')).toHaveLength(11);
    expect(container.querySelectorAll('.trend-chart .bar.is-on')).toHaveLength(1);
    expect(card().querySelector('.trend-chart .val')?.textContent).toBe('50');
    expect(within(card()).getByText('En curso')).toBeInTheDocument();
  });

  it('arrows move between weeks and stop at the ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const prev = within(card()).getByRole('button', { name: 'Semana anterior' });
    const next = within(card()).getByRole('button', { name: 'Semana siguiente' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    await user.click(prev);
    expect(readout()).toBe('Semana del 26 oct: 100 km, un 10 % más que tu media.');
    for (let i = 0; i < 11; i++) await user.click(prev);
    expect(readout()).toBe('Semana del 17 ago: 100 km, un 10 % más que tu media.');
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveAttribute('aria-disabled', 'false');
    // En el extremo la flecha sigue enfocable (el foco no cae al body) y pulsarla no hace nada.
    prev.focus();
    await user.keyboard('{Enter}');
    expect(prev).toHaveFocus();
    expect(readout()).toBe('Semana del 17 ago: 100 km, un 10 % más que tu media.');
  });

  it('tapping the chart picks the nearest week', () => {
    const { container } = render(<Harness />);
    const svg = container.querySelector('.trend-chart') as SVGSVGElement;
    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    expect(readout()).toBe('Semana del 17 ago: 100 km, un 10 % más que tu media.');
  });

  it('a week without rides says so and has no figure', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const prev = within(card()).getByRole('button', { name: 'Semana anterior' });
    for (let i = 0; i < 8; i++) await user.click(prev);
    expect(readout()).toBe('Semana del 7 sep: sin salidas.');
    expect(card().querySelector('.trend-chart .val')).toBeNull();
  });

  it('metric control switches to speed as a line', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const group = within(card()).getByRole('group', { name: 'Métrica de la gráfica' });
    await user.click(within(group).getByRole('button', { name: 'Velocidad' }));
    expect(within(group).getByRole('button', { name: 'Velocidad' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.trend-chart .bar')).toHaveLength(0);
    expect(container.querySelectorAll('.trend-chart .line').length).toBeGreaterThan(0);
    expect(readout()).toBe('Esta semana, en curso: 24,0 km/h, igual que tu media de 24,0 km/h.');
  });

  it('table view lists the weeks newest first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = within(card()).getByRole('button', { name: 'Ver tabla' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(card()).queryByRole('table')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Ocultar tabla');
    const table = within(card()).getByRole('table');
    const weeks = within(table).getAllByRole('rowheader').map((th) => th.textContent);
    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toBe('2 nov (en curso)');
    expect(weeks[11]).toBe('17 ago');
    expect(within(table).getByRole('columnheader', { name: 'Distancia' })).toBeInTheDocument();
  });

  it('without 3 weeks of rides there is no mean line', () => {
    const { container } = render(<Harness data={[ride(Date.parse('2026-11-03T08:00:00Z'), 50)]} />);
    expect(readout()).toBe('Esta semana, en curso: 50 km. Aún no hay media: necesitas 3 semanas con salidas.');
    expect(container.querySelector('.trend-chart .mean')).toBeNull();
    expect(screen.queryByText('tu media')).not.toBeInTheDocument();
  });

  it('the mean is labelled on the axis', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('.trend-chart .mean')).not.toBeNull();
    expect(container.querySelector('.trend-chart .mean-t')?.textContent).toBe('91');
  });
});
