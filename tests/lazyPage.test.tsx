import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyPage } from '../src/ui/shell/lazyPage';

function Hello() {
  return <p>Pantalla cargada</p>;
}

function mount(Page: ReturnType<typeof lazyPage>) {
  return render(
    <Suspense fallback={<p>Cargando pantalla</p>}>
      <Page />
    </Suspense>,
  );
}

describe('lazyPage', () => {
  beforeEach(() => sessionStorage.clear());

  it('muestra la carga y luego la pantalla', async () => {
    mount(lazyPage(() => Promise.resolve({ default: Hello })));
    expect(screen.getByText('Cargando pantalla')).toBeInTheDocument();
    expect(await screen.findByText('Pantalla cargada')).toBeInTheDocument();
  });

  it('recarga una vez si el fragmento ya no existe (versión antigua)', async () => {
    const reload = vi.fn();
    mount(lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')), reload));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Cargando pantalla')).toBeInTheDocument();
  });

  it('si tras recargar sigue fallando, ofrece reintentar', async () => {
    const reload = vi.fn();
    const load = vi.fn().mockRejectedValueOnce(new TypeError('x')).mockResolvedValue({ default: Hello });
    sessionStorage.setItem('fbiketrain-chunk-reload', String(Date.now()));
    // React 18 reenvía a window el error que captura el límite; aquí es el caso esperado.
    const mute = (event: ErrorEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('error', mute, true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount(lazyPage(load, reload));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido cargar esta pantalla');
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Pantalla cargada')).toBeInTheDocument();
    window.removeEventListener('error', mute, true);
    consoleError.mockRestore();
  });
});
