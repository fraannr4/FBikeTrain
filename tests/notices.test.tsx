import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Notices } from '../src/ui/inicio/Notices';
import type { Notice } from '../src/ui/inicio/inicioNotices';

const IMPORT: Notice = { id: 'import', text: 'Última importación hace 9 días.', action: 'Importar salidas nuevas', href: '#/importar' };
const BACKUP: Notice = { id: 'backup', text: 'Aún no has hecho ninguna copia de seguridad.', action: 'Hacer copia', href: '#/ajustes' };

describe('Notices', () => {
  it('bell announces 2 avisos', () => {
    const { unmount } = render(<Notices notices={[IMPORT, BACKUP]} />);
    expect(screen.getByRole('button', { name: 'Avisos, 2 avisos' })).toHaveAttribute('aria-expanded', 'false');
    unmount();
    render(<Notices notices={[BACKUP]} />);
    expect(screen.getByRole('button', { name: 'Avisos, 1 aviso' })).toBeInTheDocument();
  });

  it('panel renders only when open', async () => {
    const user = userEvent.setup();
    render(<Notices notices={[IMPORT, BACKUP]} />);
    expect(screen.queryByRole('link', { name: 'Hacer copia' })).not.toBeInTheDocument();

    const bell = screen.getByRole('button', { name: /Avisos/ });
    await user.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Hacer copia' })).toHaveAttribute('href', '#/ajustes');
    expect(screen.getByRole('link', { name: 'Importar salidas nuevas' })).toHaveAttribute('href', '#/importar');
    expect(screen.getByText('Aún no has hecho ninguna copia de seguridad.')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Hacer copia' })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it('clicking outside closes the panel', async () => {
    const user = userEvent.setup();
    render(
      <>
        <p>Fuera</p>
        <Notices notices={[BACKUP]} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /Avisos/ }));
    expect(screen.getByRole('link', { name: 'Hacer copia' })).toBeInTheDocument();
    await user.click(screen.getByText('Fuera'));
    expect(screen.queryByRole('link', { name: 'Hacer copia' })).not.toBeInTheDocument();
  });

  it('no bell without notices', () => {
    const { container } = render(<Notices notices={[]} />);
    expect(screen.queryByRole('button', { name: /Avisos/ })).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
