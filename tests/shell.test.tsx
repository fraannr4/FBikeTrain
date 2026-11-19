import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { AppShell } from '../src/ui/shell/AppShell';
import { db } from '../src/db/db';
import { deleteWorkout, saveWorkout, setWorkoutDone } from '../src/calendar/calendarRepo';
import { clearAllData } from '../src/db/repo';
import { localDay } from '../src/metrics/calendar';
import { tabOf, screenName } from '../src/ui/shell/screens';
import { TabBar } from '../src/ui/shell/TabBar';
import { AppBar } from '../src/ui/components/AppBar';
import { GentePendingProvider } from '../src/ui/shell/GentePendingContext';
import { GenteIndex } from '../src/ui/gente/GenteIndex';

const DAY = 86_400_000;
const TABS = ['Inicio', 'Salidas', 'Rutas', 'Plan', 'Más'];

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
    ['/historial', 'Salidas'],
    ['/historial/subidas', 'Salidas'],
    ['/historial/demo-001', 'Salidas'],
    ['/rutas/ia', 'Rutas'],
    ['/plan/objetivos', 'Plan'],
    ['/mas', 'Más'],
    ['/perfil', 'Más'],
    ['/personas/p2', 'Más'],
    ['/ajustes', 'Más'],
    ['/importar', 'Más'],
    ['/retos/anteriores', 'Más'],
  ])('sin cuenta, en %s la pestaña actual es %s', async (path, tab) => {
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
    expect(screenName('/rutas/ia')).not.toBe('Rutas con IA');
    expect(screenName('/historial')).toBe('Salidas');
    expect(screenName('/historial/demo-004')).toBe('Salida');
    expect(screenName('/plan/')).toBe('Plan');
    expect(screenName('/perfil')).toBe('Tú');
    expect(screenName('/ciclistas')).toBe('Ciclistas');
    expect(screenName('/zona')).toBe('Tu zona');
    expect(screenName('/amigos')).toBe('Amigos');
    expect(screenName('/retos')).toBe('Retos');
    expect(screenName('/retos/nuevo')).toBe('Nuevo reto');
    expect(screenName('/retos/abc-123')).toBe('Reto');
    expect(screenName('/chat')).toBe('Chat');
    expect(screenName('/chat/c1')).toBe('Conversación');
    expect(screenName('/gente')).toBe('Gente');
  });

  it.each([
    '/gente', '/chat', '/chat/c1', '/retos', '/retos/nuevo', '/retos/comunidad/r1', '/retos/anteriores',
    '/ciclistas', '/perfil/amigos', '/amigos', '/personas/p2',
  ])('%s es de «Gente»', (path) => {
    expect(tabOf(path)).toBe('gente');
  });

  it.each(['/perfil', '/perfil/nuevo', '/mas', '/importar', '/ajustes', '/compartido', '/zona'])('%s es de «Tú» (Más en modo local)', (path) => {
    expect(tabOf(path)).toBe('mas');
  });
});

const REGISTERED = { client: {} as SupabaseClient, user: { id: 'u1' } as User };
const ANONYMOUS = { client: {} as SupabaseClient, user: { id: 'u1', is_anonymous: true } as User };
const gente = (chats = 0, amigos = 0, retos = 0) => ({ chats, amigos, retos, total: chats + amigos + retos });

function renderBar(pathname: string, account: typeof REGISTERED | null = REGISTERED, pending = gente()) {
  return render(<AccountContext.Provider value={account}>
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><TabBar pathname={pathname} planBadge={0} gente={pending} /></MemoryRouter>
  </AccountContext.Provider>);
}
const dock = () => within(screen.getByRole('navigation', { name: 'Menú principal' }))
  .getAllByRole('link')
  .filter((a) => a.classList.contains('tab') && !a.classList.contains('tab--desktop') && !a.closest('[role="group"]'));
const current = () => screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');

describe('muelle y carril con cuenta registrada', () => {
  it('el muelle es Inicio · Salidas · Rutas · Plan · Gente; «Gente» abre /gente', () => {
    renderBar('/');
    expect(dock().map((a) => a.textContent)).toEqual(['Inicio', 'Salidas', 'Rutas', 'Plan', 'Gente']);
    expect(screen.getByRole('link', { name: 'Gente' })).toHaveAttribute('href', '/gente');
    expect(screen.queryByRole('link', { name: 'Más' })).not.toBeInTheDocument();
  });

  it('la insignia de «Gente» suma lo pendiente, lo dice en el nombre y pasa a «9+»', () => {
    const { unmount } = renderBar('/', REGISTERED, gente(2, 1, 1));
    const tab = screen.getByRole('link', { name: 'Gente, 4 pendientes' });
    expect(tab.querySelector('.tab-badge')).toHaveTextContent('4');
    unmount();
    renderBar('/', REGISTERED, gente(1));
    expect(screen.getByRole('link', { name: 'Gente, 1 pendiente' })).toBeInTheDocument();
    cleanup();
    renderBar('/', REGISTERED, gente(8, 3, 1));
    expect(screen.getByRole('link', { name: 'Gente, 12 pendientes' }).querySelector('.tab-badge')).toHaveTextContent('9+');
  });

  it('sin nada pendiente, «Gente» no lleva insignia', () => {
    renderBar('/');
    expect(screen.getByRole('link', { name: 'Gente' }).querySelector('.tab-badge')).toBeNull();
  });

  it.each([
    ['/chat', 'Chats'], ['/chat/c1', 'Chats'], ['/retos/comunidad/r1', 'Retos'], ['/retos', 'Retos'],
    ['/perfil/amigos', 'Amigos'], ['/amigos', 'Amigos'], ['/ciclistas', 'Ciclistas'], ['/personas/p2', 'Ciclistas'],
  ])('en %s se marcan «Gente» en el muelle y %s en el carril', (path, part) => {
    renderBar(path);
    const group = screen.getByRole('group', { name: 'Gente' });
    expect(current()).toEqual([screen.getByRole('link', { name: 'Gente' }), within(group).getByRole('link', { name: part })]);
  });

  it('el carril lleva Chats, Amigos, Retos y Ciclistas, con su contador', () => {
    renderBar('/', REGISTERED, gente(2, 1, 3));
    const group = screen.getByRole('group', { name: 'Gente' });
    const links = within(group).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/chat', '/perfil/amigos', '/retos', '/ciclistas']);
    expect(links.map((a) => a.getAttribute('aria-label') ?? a.textContent)).toEqual([
      'Chats, 2 sin leer', 'Amigos, 1 solicitud', 'Retos, 3 pendientes', 'Ciclistas',
    ]);
    expect(links.map((a) => a.querySelector('.tab-badge')?.textContent ?? null)).toEqual(['2', '1', '3', null]);
  });

  it.each(['/perfil', '/ajustes', '/importar', '/zona'])('en %s no se marca ninguna pestaña: lo marcado es «Tú»', (path) => {
    renderBar(path);
    const you = screen.getByRole('link', { name: 'Tú: perfil, importar y ajustes' });
    expect(you).toHaveAttribute('href', '/perfil');
    expect(current()).toEqual([you]);
  });
});

describe('modo local: sin cuenta o con cuenta anónima', () => {
  it.each([['sin cuenta', null], ['con cuenta anónima', ANONYMOUS]] as const)('%s, la quinta pestaña es «Más» y no hay nada de Gente', (_, account) => {
    renderBar('/', account, gente(2, 1, 1));
    expect(dock().map((a) => a.textContent)).toEqual(['Inicio', 'Salidas', 'Rutas', 'Plan', 'Más']);
    expect(screen.queryByRole('link', { name: /Gente/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Gente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Tú/ })).not.toBeInTheDocument();
  });

  it('con cuenta anónima, en ajustes se marca «Más»', () => {
    renderBar('/ajustes', ANONYMOUS);
    expect(current()).toEqual([screen.getByRole('link', { name: 'Más' })]);
  });
});

describe('#/gente abre la parte con algo pendiente', () => {
  function Where() {
    return <p>En {useLocation().pathname}</p>;
  }
  function renderGente(account: typeof REGISTERED | null, pending = gente()) {
    render(<AccountContext.Provider value={account}>
      <GentePendingProvider value={pending}>
        <MemoryRouter initialEntries={['/gente']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/gente" element={<GenteIndex />} /><Route path="*" element={<Where />} /></Routes>
        </MemoryRouter>
      </GentePendingProvider>
    </AccountContext.Provider>);
  }

  it.each([
    [gente(), '/chat'], [gente(0, 1, 2), '/retos'], [gente(0, 1), '/perfil/amigos'], [gente(3, 1, 1), '/chat'],
  ])('con %o va a %s', (pending, to) => {
    renderGente(REGISTERED, pending);
    expect(screen.getByText(`En ${to}`)).toBeInTheDocument();
  });

  it.each([['sin cuenta', null], ['con cuenta anónima', ANONYMOUS]] as const)('%s va a Más', (_, account) => {
    renderGente(account, gente(1));
    expect(screen.getByText('En /mas')).toBeInTheDocument();
  });
});

describe('«Volver» de Ajustes, Importar y Compartido al entrar por enlace directo', () => {
  function renderBack(account: typeof REGISTERED | null) {
    render(<AccountContext.Provider value={account}>
      <MemoryRouter initialEntries={['/ajustes']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppBar title="Ajustes" back="/mas" />
      </MemoryRouter>
    </AccountContext.Provider>);
  }

  it('con cuenta registrada vuelve a «Tú», que es donde están ahora', () => {
    renderBack(REGISTERED);
    expect(screen.getByRole('link', { name: 'Volver a Tú' })).toHaveAttribute('href', '/perfil');
  });

  it.each([['sin cuenta', null], ['con cuenta anónima', ANONYMOUS]] as const)('%s vuelve a «Más»', (_, account) => {
    renderBack(account);
    expect(screen.getByRole('link', { name: 'Volver a Más' })).toHaveAttribute('href', '/mas');
  });
});
