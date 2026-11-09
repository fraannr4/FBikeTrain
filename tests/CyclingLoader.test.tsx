import { act, render, screen } from '@testing-library/react';
import { CyclingLoader } from '../src/ui/components/CyclingLoader';

describe('CyclingLoader', () => {
  it('anuncia la espera sin inventar un porcentaje', () => {
    render(<CyclingLoader label="Abriendo tus datos…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Abriendo tus datos…');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('puede ser decorativo junto a un progreso existente', () => {
    const { container } = render(<CyclingLoader compact />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
  it('pausa el movimiento cuando se oculta la pestaña', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { container, unmount } = render(<CyclingLoader />);
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(container.firstChild).toHaveAttribute('data-paused', 'true');
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(container.firstChild).toHaveAttribute('data-paused', 'false');
    unmount();
    hidden.mockRestore();
  });
});
