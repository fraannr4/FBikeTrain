import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { AppShell } from '../src/ui/shell/AppShell';
import { db } from '../src/db/db';
import { deleteWorkout, saveWorkout, setWorkoutDone } from '../src/calendar/calendarRepo';
import { clearAllData } from '../src/db/repo';
import { localDay } from '../src/metrics/calendar';
import { tabOf, screenName } from '../src/ui/shell/screens';
import { TabBar } from '../src/ui/shell/TabBar';

const DAY = 86_400_000;
const TABS = ['Inicio', 'Historial', 'Rutas', 'Plan', 'Más'];

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell>
        <h1>Página</h1>
      </AppShell>
    </MemoryRouter>,
  );
}

const tabNames = () =>
  within(screen.getByRole('navigation', { name: 'Menú principal' }))
    .getAllByRole('link')
    .map((a) => a.getAttribute('aria-label') ?? a.textContent);

describe('AppShell', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('una sola navegación, «Menú principal», con la marca y las cinco pestañas', async () => {
    renderShell();
    expect(screen.getAllByRole('navigation', { name: 'Menú principal' })).toHaveLength(1);
    expect(tabNames()).toEqual(['FBikeTrain, inicio', ...TABS]);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Plan' })).toBeInTheDocument());
  });

  it.each([
    ['/', 'Inicio'],
    ['/historial', 'Historial'],
    ['/historial/subidas', 'Historial'],
    ['/historial/demo-001', 'Historial'],
    ['/rutas/ia', 'Rutas'],
    ['/plan/objetivos', 'Plan'],
    ['/mas', 'Más'],
    ['/perfil', 'Más'],
    ['/personas/p2', 'Más'],
    ['/ajustes', 'Más'],
    ['/importar', 'Más'],
  ])('en %s la pestaña actual es %s', async (path, tab) => {
    renderShell(path);
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(tab);
    await waitFor(() => expect(nav).toBeInTheDocument());
  });

  it('las pestañas llevan a la pantalla raíz de cada una', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const hrefs = TABS.map((t) => within(nav).getByRole('link', { name: t }).getAttribute('href'));
    expect(hrefs).toEqual(['/', '/historial', '/rutas', '/plan', '/mas']);
  });

  it('Plan cuenta los entrenos sin hacer de hoy y de mañana', async () => {
    const now = Date.now();
    await db.calendar.bulkAdd([
      { id: 'a', date: localDay(now + DAY), title: 'Rodaje', done: false, manual: false, createdAt: now },
      { id: 'b', date: localDay(now), title: 'Hecho', done: true, manual: false, createdAt: now },
      { id: 'c', date: localDay(now + 5 * DAY), title: 'Lejos', done: false, manual: false, createdAt: now },
    ]);
    renderShell();
    expect(await screen.findByRole('link', { name: 'Plan, 1 pendiente' })).toHaveAttribute('href', '/plan');
  });

  it('el contador de Plan se actualiza al marcar un entreno como hecho sin cambiar de pantalla', async () => {
    const now = Date.now();
    await db.calendar.add({ id: 'h', date: localDay(now), title: 'Rodaje', done: false, manual: false, createdAt: now });
    renderShell('/plan');
    expect(await screen.findByRole('link', { name: 'Plan, 1 pendiente' })).toBeInTheDocument();
    await setWorkoutDone('h', true);
    expect(await screen.findByRole('link', { name: 'Plan' })).toBeInTheDocument();
  });

  it('el contador de Plan se actualiza al guardar y al borrar un entreno', async () => {
    const now = Date.now();
    renderShell('/plan');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Plan' })).toBeInTheDocument());
    await saveWorkout({ id: 'n', date: localDay(now + DAY), title: 'Series', done: false, manual: false, createdAt: now });
    expect(await screen.findByRole('link', { name: 'Plan, 1 pendiente' })).toBeInTheDocument();
    await deleteWorkout('n');
    expect(await screen.findByRole('link', { name: 'Plan' })).toBeInTheDocument();
  });

  it('«Saltar al contenido» lleva el foco a main', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('link', { name: 'Saltar al contenido' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenido');
  });
});

describe('screens', () => {
  it('tabOf y screenName', () => {
    expect(tabOf('/historial/repetidas')).toBe('historial');
    expect(tabOf('/ajustes')).toBe('mas');
    expect(tabOf('/')).toBe('inicio');
    expect(screenName('/rutas/ia')).toBe('Rutas con IA');
    expect(screenName('/historial/demo-004')).toBe('Salida');
    expect(screenName('/plan/')).toBe('Plan');
    expect(tabOf('/zona')).toBe('mas');
    expect(tabOf('/amigos')).toBe('mas');
    expect(screenName('/zona')).toBe('Tu zona');
    expect(screenName('/amigos')).toBe('Amigos');
    expect(tabOf('/retos')).toBe('mas');
    expect(tabOf('/retos/nuevo')).toBe('mas');
    expect(screenName('/retos')).toBe('Retos');
    expect(screenName('/retos/nuevo')).toBe('Nuevo reto');
    expect(screenName('/retos/abc-123')).toBe('Reto');
  });
});

describe('navegación social con cuenta', () => {
  it.each([
    ['/perfil', 'Tu perfil'], ['/zona', 'Tu perfil'], ['/amigos', 'Amigos'],
    ['/personas/p2', 'Amigos'], ['/retos/nuevo', 'Retos'], ['/retos/r1', 'Retos'],
  ])('el carril selecciona %s en %s', (pathname, label) => {
    render(<AccountContext.Provider value={{ client: {} as SupabaseClient, user: { id: 'u1' } as User }}>
      <MemoryRouter><TabBar pathname={pathname} planBadge={0} /></MemoryRouter>
    </AccountContext.Provider>);
    const group = screen.getByRole('group', { name: 'Comunidad' });
    const selected = within(group).getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent(label);
    expect(screen.getByRole('link', { name: 'Perfil' })).toHaveAttribute('href', '/perfil');
  });

  it('Más sigue disponible y seleccionado al abrir ajustes', () => {
    render(<AccountContext.Provider value={{ client: {} as SupabaseClient, user: { id: 'u1' } as User }}>
      <MemoryRouter><TabBar pathname="/ajustes" planBadge={0} /></MemoryRouter>
    </AccountContext.Provider>);
    expect(screen.getByRole('link', { name: 'Más' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Amigos' })).toHaveAttribute('href', '/amigos');
    expect(screen.getByRole('link', { name: 'Retos' })).toHaveAttribute('href', '/retos');
  });
});
