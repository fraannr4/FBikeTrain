import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';

describe('App', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('pinta la barra de cinco pestañas e Inicio', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const tabs = within(nav)
      .getAllByRole('link')
      .filter((a) => a.classList.contains('tab'))
      .map((a) => a.textContent);
    expect(tabs).toEqual(['Inicio', 'Historial', 'Rutas', 'Plan', 'Más']);
    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
  });

  it('#/ajustes muestra Ajustes', async () => {
    window.location.hash = '#/ajustes';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument();
  });

  it.each([
    ['#/historial', 'Historial'],
    ['#/historial/subidas', 'Historial'],
    ['#/historial/repetidas', 'Historial'],
    ['#/historial/demo-001', 'Salida'],
    ['#/rutas', 'Rutas'],
    ['#/rutas/ia', 'Rutas con IA'],
    ['#/plan', 'Plan'],
    ['#/plan/objetivos', 'Plan'],
    ['#/mas', 'Más'],
  ])('%s tiene su pantalla con h1 «%s»', async (hash, h1) => {
    window.location.hash = hash;
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: h1 })).toBeInTheDocument();
  });

  it('Subidas marca su vista en el segmentado y una salida vuelve al historial', async () => {
    window.location.hash = '#/historial/subidas';
    const { unmount } = render(<App />);
    const views = await screen.findByRole('navigation', { name: 'Vistas del historial' });
    expect(within(views).getByRole('link', { name: 'Subidas' })).toHaveAttribute('aria-current', 'page');
    unmount();

    window.location.hash = '#/historial/demo-001';
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Volver al historial' })).toHaveAttribute('href', '#/historial');
  });

  it('Rutas lleva a Rutas con IA desde la barra, y «Volver a Rutas» regresa', async () => {
    window.location.hash = '#/rutas';
    render(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Pregunta a la IA' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas con IA' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Volver a Rutas' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rutas' })).toBeInTheDocument();
  });

  it('Rutas tiene también la fila «Pregunta a la IA» hacia Rutas con IA', async () => {
    window.location.hash = '#/rutas';
    render(<App />);
    const section = await screen.findByRole('region', { name: 'Rutas con IA' });
    expect(within(section).getByRole('link', { name: /Pregunta a la IA/ })).toHaveAttribute('href', '#/rutas/ia');
  });

  it('Más lleva a Ajustes e Importar', async () => {
    window.location.hash = '#/mas';
    render(<App />);
    await userEvent.click(await screen.findByRole('link', { name: /Ajustes/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajustes' })).toBeInTheDocument();
  });

  it('Ajustes cambia el tema con «Claro» y «Oscuro»', async () => {
    window.location.hash = '#/ajustes';
    render(<App />);
    const tema = await screen.findByRole('group', { name: 'Tema' });
    const claro = within(tema).getByRole('button', { name: 'Claro' });
    const oscuro = within(tema).getByRole('button', { name: 'Oscuro' });

    await userEvent.click(claro);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(claro).toHaveAttribute('aria-pressed', 'true');
    expect(oscuro).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(oscuro);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(oscuro).toHaveAttribute('aria-pressed', 'true');
    expect(claro).toHaveAttribute('aria-pressed', 'false');
  });
});
