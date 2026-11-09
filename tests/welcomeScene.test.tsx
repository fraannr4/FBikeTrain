import { act, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { WelcomeScene, welcomeName } from '../src/auth/WelcomeScene';
import { armFreshSignIn, disarmFreshSignIn, takeFreshSignIn } from '../src/auth/useFreshSignIn';

const reducedMotion = (matches: boolean) => vi.fn((query: string) => ({
  matches: matches && query === '(prefers-reduced-motion: reduce)', media: query, onchange: null,
  addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
})) as unknown as typeof window.matchMedia;

describe('escena de bienvenida', () => {
  const original = window.matchMedia;
  beforeEach(() => { vi.useFakeTimers(); window.matchMedia = reducedMotion(false); });
  afterEach(() => { vi.useRealTimers(); window.matchMedia = original; });

  it('saluda, se anuncia sin interrumpir y termina sola', () => {
    const onLeave = vi.fn(); const onDone = vi.fn();
    render(<WelcomeScene name="Ana" onLeave={onLeave} onDone={onDone} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('heading', { name: 'Hola, Ana.' })).toBeInTheDocument();
    expect(screen.getByText('Tu próxima cima empieza aquí.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1499));
    expect(onLeave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onLeave).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(300));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('se salta con un toque', () => {
    const onLeave = vi.fn(); const onDone = vi.fn();
    render(<WelcomeScene name="Ana" onLeave={onLeave} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onLeave).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(300));
    expect(onDone).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(3000));
    expect(onLeave).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('se salta con Escape', () => {
    const onLeave = vi.fn(); const onDone = vi.fn();
    render(<WelcomeScene name="Ana" onLeave={onLeave} onDone={onDone} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(300));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('con movimiento reducido no muestra ciclista y dura 900 ms como máximo', () => {
    window.matchMedia = reducedMotion(true);
    const onDone = vi.fn();
    const { container } = render(<WelcomeScene name="Ana" onLeave={() => {}} onDone={onDone} />);
    expect(container.querySelector('.welcome-rider')).toBeNull();
    act(() => vi.advanceTimersByTime(900));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('no recorta en el DOM un nombre largo o con emoji: lo limita la hoja de estilos a 2 líneas', () => {
    const long = 'Maximiliano Alejandro de la Santísima Trinidad Fernández 🚴‍♀️';
    render(<WelcomeScene name={long} onLeave={() => {}} onDone={() => {}} />);
    const heading = screen.getByRole('heading');
    expect(heading).toHaveTextContent(`Hola, ${long}.`);
    expect(heading).toHaveClass('welcome-greeting');
  });

  it('sin nombre saluda sin coma', () => {
    render(<WelcomeScene name="" onLeave={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Hola.' })).toBeInTheDocument();
  });
});

describe('nombre del saludo', () => {
  const user = (meta: Record<string, unknown>, email?: string) => ({ id: 'u', user_metadata: meta, email } as unknown as User);
  it('prefiere el nombre del perfil si no es el genérico', () => {
    expect(welcomeName(user({ full_name: 'Ana Google' }, 'ana@x.es'), 'Ana Perfil')).toBe('Ana Perfil');
    expect(welcomeName(user({ full_name: 'Ana Google' }, 'ana@x.es'), 'Ciclista')).toBe('Ana Google');
  });
  it('usa los metadatos y si no la parte local del correo', () => {
    expect(welcomeName(user({ display_name: '  Pep  ' }, 'p@x.es'))).toBe('Pep');
    expect(welcomeName(user({ name: 'Joan' }, 'j@x.es'))).toBe('Joan');
    expect(welcomeName(user({}, 'marta.rider@x.es'))).toBe('marta.rider');
    expect(welcomeName(user({}))).toBe('');
  });
});

describe('marca de acceso reciente', () => {
  afterEach(() => { vi.useRealTimers(); disarmFreshSignIn(); vi.restoreAllMocks(); });
  it('solo vale una vez', () => {
    armFreshSignIn();
    expect(takeFreshSignIn()).toBe(true);
    expect(takeFreshSignIn()).toBe(false);
  });
  it('caduca a los 10 minutos', () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T10:00:00Z') });
    armFreshSignIn();
    vi.setSystemTime(new Date('2026-11-09T10:10:01Z'));
    expect(takeFreshSignIn()).toBe(false);
  });
  it('se puede desarmar tras un error', () => {
    armFreshSignIn(); disarmFreshSignIn();
    expect(takeFreshSignIn()).toBe(false);
  });
  it('funciona aunque el navegador bloquee sessionStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    armFreshSignIn();
    expect(takeFreshSignIn()).toBe(true);
  });
});
