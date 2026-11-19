import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContentReveal } from '../src/ui/hooks/useContentReveal';

function Content({ busy = false, view = 'a' }: { busy?: boolean; view?: string }) {
  const ref = useContentReveal<HTMLDivElement>(busy, view);
  return <div ref={ref} aria-busy={busy}><input aria-label="Borrador" />{busy ? 'Cargando' : 'Contenido listo'}</div>;
}

describe('entrada del contenido', () => {
  let reduced: boolean;
  let change: () => void;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));

  beforeEach(() => {
    reduced = false;
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      get matches() { return reduced; },
      addEventListener: (_: string, listener: () => void) => { change = listener; },
      removeEventListener: () => {},
    }) as unknown as MediaQueryList);
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    animate.mockClear(); cancel.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });

  it('revela los datos sin esperar, conserva el borrador y el foco y no repite al renderizar', async () => {
    const { rerender, unmount } = render(<Content busy />);
    expect(animate).not.toHaveBeenCalled();
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'Mi ruta');
    rerender(<Content />);
    expect(screen.getByText('Contenido listo')).toBeVisible();
    expect(input).toHaveValue('Mi ruta');
    expect(input).toHaveFocus();
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Content />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Content view="b" />);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(2);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('cancela inmediatamente al activar movimiento reducido y muestra los datos sin animación', () => {
    const { rerender } = render(<Content />);
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => { reduced = true; change(); });
    expect(cancel).toHaveBeenCalledTimes(1);
    rerender(<Content busy />);
    rerender(<Content view="b" />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Contenido listo')).toBeVisible();
  });

  it('funciona en un navegador sin Web Animations', () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    render(<Content />);
    expect(screen.getByText('Contenido listo')).toBeVisible();
  });
});
