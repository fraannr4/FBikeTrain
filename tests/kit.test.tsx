import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Sheet } from '../src/ui/components/Sheet';
import { SegmentedControl, SegmentedNav } from '../src/ui/components/SegmentedControl';
import { Stepper } from '../src/ui/components/Stepper';
import { DifficultyChip } from '../src/ui/components/Chip';
import { Meter } from '../src/ui/components/Meter';
import { Field } from '../src/ui/components/Field';
import { StateView } from '../src/ui/components/StateView';
import { ProfileSvg } from '../src/ui/charts/ProfileSvg';
import { RouteShape } from '../src/ui/charts/RouteShape';
import { Mountain } from '../src/ui/icons';
import { PLAN_VIEWS } from '../src/ui/shell/screens';

describe('Sheet', () => {
  function Harness({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
        <Sheet
          open={open}
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
          title="Filtrar salidas"
          sub="Elige qué ver"
          footer={<button type="button">Aplicar</button>}
        >
          <p>Contenido de la hoja</p>
        </Sheet>
      </>
    );
  }

  it('se abre como diálogo con nombre, pinta el contenido solo abierta y cierra con su botón', async () => {
    render(<Harness />);
    expect(screen.queryByText('Contenido de la hoja')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Filtrar salidas' });
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getByText('Contenido de la hoja')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Aplicar' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Filtrar salidas' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    expect(screen.queryByText('Contenido de la hoja')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Escape pide cerrar', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open'));
  });

  it('Tab en el último control vuelve al primero (foco atrapado)', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Cerrar' });
    const apply = within(dialog).getByRole('button', { name: 'Aplicar' });
    apply.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
  });
});

describe('SegmentedControl', () => {
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return (
      <SegmentedControl
        label="Periodo"
        options={[
          { value: 'a', label: 'Semana' },
          { value: 'b', label: 'Mes' },
          { value: 'c', label: 'Año' },
        ]}
        value={v}
        onChange={(next) => {
          onChange(next);
          setV(next);
        }}
      />
    );
  }

  it('expone aria-pressed, cambia al pulsar y con las flechas', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Periodo' });
    const [semana, mes, anio] = within(group).getAllByRole('button');
    expect(semana).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(mes);
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(mes).toHaveAttribute('aria-pressed', 'true');
    expect(semana).toHaveAttribute('aria-pressed', 'false');
    mes.focus();
    fireEvent.keyDown(mes, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(anio).toHaveFocus();
    expect(group.querySelector('.seg-ind')).toHaveStyle({ transform: 'translateX(200%)' });
  });
});

describe('SegmentedNav', () => {
  const ITEMS = [
    { to: '/historial', label: 'Salidas' },
    { to: '/historial/subidas', label: 'Subidas' },
  ];
  function Where() {
    return <p data-testid="where">{useLocation().pathname}</p>;
  }
  function View() {
    const { pathname } = useLocation();
    return <SegmentedNav label="Vistas del historial" items={ITEMS} current={pathname} />;
  }

  it('son enlaces con aria-current y cambian de vista', async () => {
    render(
      <MemoryRouter initialEntries={['/historial']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="*" element={<View />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Vistas del historial' });
    expect(within(nav).getByRole('link', { name: 'Salidas' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav).getByRole('link', { name: 'Subidas' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/historial/subidas');
    expect(within(nav).getByRole('link', { name: 'Subidas' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Salidas' })).not.toHaveAttribute('aria-current');
  });

  it('las vistas de Plan llevan un icono decorativo junto al texto', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SegmentedNav label="Vistas del plan" items={PLAN_VIEWS} current="/plan" />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Vistas del plan' });
    for (const name of ['Calendario', 'Objetivos']) {
      const link = within(nav).getByRole('link', { name });
      const icon = link.querySelector('svg.ic');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('Stepper', () => {
  function Harness() {
    const [v, setV] = useState(80);
    return <Stepper label="Distancia" unit="km" value={v} onChange={setV} min={20} max={90} step={5} />;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('un toque suma un paso; mantener repite hasta el máximo y anuncia al soltar', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Distancia' });
    const mas = within(group).getByRole('button', { name: 'Más distancia' });
    const menos = within(group).getByRole('button', { name: 'Menos distancia' });
    expect(group).toHaveTextContent('80km');

    fireEvent.pointerDown(menos, { button: 0 });
    fireEvent.pointerUp(menos);
    expect(group).toHaveTextContent('75km');

    fireEvent.pointerDown(mas, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.pointerUp(mas);
    expect(group).toHaveTextContent('90km');
    expect(mas).toHaveAttribute('aria-disabled', 'true');
    expect(within(group).getByText('90 km')).toBeInTheDocument(); // anuncio para el lector
  });

  it('con teclado (click sin puntero) da un paso por pulsación', () => {
    render(<Harness />);
    const menos = screen.getByRole('button', { name: 'Menos distancia' });
    fireEvent.click(menos, { detail: 0 });
    expect(screen.getByRole('group', { name: 'Distancia' })).toHaveTextContent('75km');
  });
});

describe('Piezas pequeñas del kit', () => {
  it('DifficultyChip dice la dificultad con texto, no solo color', () => {
    render(<DifficultyChip level="Dura" />);
    expect(screen.getByText('Dura para ti')).toHaveClass('chip--hard');
  });

  it('Meter acota el valor y pone la muesca solo con ritmo', () => {
    const { container } = render(<Meter value={1.4} pace={0.5} label="140 % del objetivo" />);
    const m = screen.getByRole('img', { name: '140 % del objetivo' });
    expect(m.style.getPropertyValue('--p')).toBe('1');
    expect(container.querySelector('.meter > b')).not.toBeNull();
  });

  it('Field enlaza el error con el campo', () => {
    render(<Field label="Clave de rutas" error="La clave no es válida." defaultValue="x" />);
    const input = screen.getByLabelText('Clave de rutas');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('La clave no es válida.');
  });

  it('StateView de error se anuncia', () => {
    render(<StateView icon={Mountain} tone="error" title="No se pudo leer" text="Reintenta." />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo leer');
  });

  it('ProfileSvg pinta tramos por pendiente y la leyenda de los presentes', () => {
    const profile = Array.from({ length: 101 }, (_, i) => ({ dM: i * 100, ele: i < 50 ? 500 : 500 + (i - 50) * 8 }));
    const { container } = render(<ProfileSvg profile={profile} label="Perfil" legend axis />);
    expect(screen.getByRole('img', { name: 'Perfil' })).toBeInTheDocument();
    expect(container.querySelectorAll('polygon').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Llano o bajada')).toBeInTheDocument();
    expect(screen.getByText('7–10 %')).toBeInTheDocument();
    expect(screen.getByText('10,0 km')).toBeInTheDocument();
  });

  it('ProfileSvg sin datos no rompe', () => {
    render(<ProfileSvg profile={[]} label="Perfil" />);
    expect(screen.getByRole('img', { name: 'Perfil' })).toHaveTextContent('Sin perfil de altura');
  });

  it('RouteShape es decorativa sin nombre y no da NaN', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({
      lat: 41.9 + Math.sin((i / 50) * 2 * Math.PI) * 0.05,
      lng: 2 + Math.cos((i / 50) * 2 * Math.PI) * 0.07,
    }));
    const { container } = render(<RouteShape points={pts} size={64} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.innerHTML).not.toMatch(/NaN|undefined|Infinity/);
  });
});
