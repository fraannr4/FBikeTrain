import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { List } from '../src/ui/components/ListRow';
import { RouteCard, profileLabel, type RouteCardData } from '../src/ui/routes/RouteCard';
import { bareRoute, bestRoute, coastRoute, eightRoute } from './fixtures/routes';
import { fullText } from './helpers/text';

function renderCard(ui: React.ReactElement) {
  return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>);
}

// 10 km: 4 km llanos, 3 km al 5 % y 3 km al 8 %. El tramo más duro es el del 7-10 %.
const ramp = Array.from({ length: 201 }, (_, i) => {
  const d = i * 50;
  return { dM: d, ele: 300 + Math.max(0, Math.min(d, 7000) - 4000) * 0.05 + Math.max(0, d - 7000) * 0.08 };
});

describe('RouteCard', () => {
  it('best variant shows La que mejor encaja', () => {
    const { container } = renderCard(<RouteCard route={bestRoute} variant="best" />);
    expect(screen.getByText('La que mejor encaja')).toBeInTheDocument();
    expect(container.querySelector('.rcard')).toHaveAttribute('data-best');
    // La cifra titular (la distancia) va en cursiva de dorsal.
    expect(container.querySelector('.rcard-figs .fig-i')).toHaveTextContent('92,4');
  });

  it('normal variant has no best line', () => {
    const { container } = renderCard(<RouteCard route={coastRoute} variant="normal" />);
    expect(screen.queryByText('La que mejor encaja')).not.toBeInTheDocument();
    expect(container.querySelector('.rcard')).not.toHaveAttribute('data-best');
  });

  it('names the route as a heading and shows its figures', () => {
    renderCard(<RouteCard route={bestRoute} variant="best" />);
    expect(screen.getByRole('heading', { name: 'Lazo del faro por la cala' })).toBeInTheDocument();
    expect(screen.getByText(fullText('92,4 km'))).toBeInTheDocument();
    expect(screen.getByText(fullText('1540 m'))).toBeInTheDocument();
    expect(screen.getByText(fullText('3 h 23 min'))).toBeInTheDocument();
    expect(screen.getByText('A tu ritmo')).toBeInTheDocument();
  });

  it('difficulty chip has text and bars', () => {
    const { container } = renderCard(<RouteCard route={bestRoute} variant="best" />);
    const chip = screen.getByText('Media para ti').closest('.chip')!;
    expect(chip).toHaveClass('chip--mid');
    const bars = chip.querySelectorAll('svg.bars rect');
    expect(bars).toHaveLength(3);
    // Media: dos barras llenas y la tercera apagada.
    expect([...bars].map((b) => b.getAttribute('opacity') ?? '1')).toEqual(['1', '1', '0.3']);
    expect(container.querySelector('.chip--hard')).toBeNull();
  });

  it('new road chip says 74 % carretera nueva', () => {
    renderCard(<RouteCard route={bestRoute} variant="best" />);
    expect(screen.getByText('74 % carretera nueva').closest('.chip')).toHaveClass('chip--new');
  });

  it('a route already ridden says so, and an unknown share says nothing', () => {
    const { unmount } = renderCard(<RouteCard route={coastRoute} variant="normal" />);
    expect(screen.getByText('Todo ya rodado')).toBeInTheDocument();
    unmount();
    renderCard(<RouteCard route={bareRoute} variant="normal" />);
    expect(screen.queryByText(/carretera nueva|ya rodado/)).not.toBeInTheDocument();
  });

  it('why note only when provided', () => {
    const { container, unmount } = renderCard(<RouteCard route={eightRoute} variant="normal" />);
    const why = container.querySelector('.rcard-why')!;
    expect(why).toHaveTextContent(/^Por qué esta\. Sube dos veces en 42 km/);
    // Lo que distingue a la IA va justo después de las cifras, antes del perfil (ia.html).
    const profile = screen.getByRole('img', { name: /^Perfil:/ });
    expect(why.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    const other = renderCard(<RouteCard route={bestRoute} variant="best" />);
    expect(other.container.querySelector('.rcard-why')).toBeNull();
  });

  it('actions only when handlers are given', () => {
    const { container, unmount } = renderCard(<RouteCard route={bestRoute} variant="best" />);
    expect(container.querySelector('.rcard-actions')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    unmount();

    const onDownload = vi.fn();
    renderCard(<RouteCard route={bestRoute} variant="best" onDownload={onDownload} mapHref="/rutas/r-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Exportar GPX' }));
    expect(onDownload).toHaveBeenCalledWith(bestRoute);
    expect(screen.getByRole('link', { name: 'Ver Lazo del faro por la cala en el mapa' })).toHaveAttribute(
      'href',
      '/rutas/r-1',
    );
  });

  it('the map button can open a sheet instead of a link', () => {
    const onMap = vi.fn();
    renderCard(<RouteCard route={coastRoute} variant="normal" onMap={onMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver Costa larga hasta la boya en el mapa' }));
    expect(onMap).toHaveBeenCalledWith(coastRoute);
  });

  it('feature variant has one primary action and a GPX icon button', () => {
    const onDownload = vi.fn();
    const { container } = renderCard(
      <RouteCard route={bestRoute} variant="feature" onDownload={onDownload} mapHref="/rutas/r-1" />,
    );
    const primary = container.querySelectorAll('.btn--primary');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Ver ruta');
    expect(primary[0]).toHaveAttribute('href', '/rutas/r-1');
    const gpx = screen.getByRole('button', { name: 'Descargar GPX de Lazo del faro por la cala' });
    expect(gpx).toHaveClass('icon-btn');
    fireEvent.click(gpx);
    expect(onDownload).toHaveBeenCalledWith(bestRoute);
    // Sin chip de carretera nueva ni párrafo largo.
    expect(screen.queryByText('74 % carretera nueva')).not.toBeInTheDocument();
  });

  it('compact rows have no chip', () => {
    const { container } = renderCard(
      <List label="Otras rutas">
        <RouteCard route={bestRoute} variant="compact" mapHref="/rutas/r-1" />
        <RouteCard route={eightRoute} variant="compact" mapHref="/rutas/r-3" />
      </List>,
    );
    const rows = container.querySelectorAll('.row');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelector('.chip')).toBeNull();
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText('Media para ti').closest('.dif')).toHaveClass('dif--mid');
    expect(first.getByText(fullText('92,4 km'))).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('href', '/rutas/r-1');
    expect(rows[0].querySelector('svg.shape')).not.toBeNull();
  });

  it('no raster images', () => {
    for (const variant of ['best', 'normal', 'compact', 'feature'] as const) {
      const { container, unmount } = renderCard(
        variant === 'compact' ? (
          <List>
            <RouteCard route={bestRoute} variant={variant} mapHref="/x" />
          </List>
        ) : (
          <RouteCard route={bestRoute} variant={variant} mapHref="/x" onDownload={() => {}} />
        ),
      );
      expect(container.querySelector('img, picture, image')).toBeNull();
      expect(container.querySelector('svg.shape path.core')).not.toBeNull();
      unmount();
    }
  });

  it('profile label names the hardest grade', () => {
    const route: RouteCardData = { ...eightRoute, distanceM: 42_000, elevGainM: 640, profile: ramp };
    expect(profileLabel(route)).toBe('Perfil: 42,0 km y 640 m de desnivel. Tramo más duro: 7–10 %');
    renderCard(<RouteCard route={route} variant="normal" />);
    expect(
      screen.getByRole('img', { name: 'Perfil: 42,0 km y 640 m de desnivel. Tramo más duro: 7–10 %' }),
    ).toBeInTheDocument();
  });

  it('a flat route says it has no climbs', () => {
    const flat: RouteCardData = { ...coastRoute, profile: [{ dM: 0, ele: 10 }, { dM: 68_000, ele: 10 }] };
    expect(profileLabel(flat)).toBe('Perfil: 68,0 km y 410 m de desnivel. Sin tramos de más del 1 %');
  });

  it('a route without profile or shape shows no NaN', () => {
    const { container } = renderCard(<RouteCard route={bareRoute} variant="normal" />);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
    expect(screen.getByText('Sin perfil de altura')).toBeInTheDocument();
    expect(profileLabel(bareRoute)).toBe('Perfil: 30,0 km y 0 m de desnivel');
  });

  it('shows the rank and the route kind', () => {
    renderCard(<RouteCard route={bestRoute} variant="best" rank={{ n: 1, of: 5 }} />);
    expect(screen.getByRole('heading', { name: 'Ruta 1 de 5: Lazo del faro por la cala' })).toBeInTheDocument();
    expect(screen.getByText('Circular')).toBeInTheDocument();
  });
});
