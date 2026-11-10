import { render, screen, waitFor } from '@testing-library/react';
import { RideMap } from '../src/ui/components/RideMap';
import { mapOptions } from '../src/ui/components/mapOptions';
import type { LatLng } from '../src/domain/types';

// Leaflet solo pinta líneas si el navegador tiene SVG; jsdom no expone createSVGRect.
Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', { configurable: true, value: () => ({}) });

// Coordenadas sintéticas en el mar (lat 41,0 y lng 2,5).
const POINTS: LatLng[] = [
  { lat: 41.0, lng: 2.5 },
  { lat: 41.01, lng: 2.51 },
  { lat: 41.02, lng: 2.5 },
  { lat: 41.0, lng: 2.49 },
];

describe('RideMap', () => {
  it('draws halo, core and thread polylines and a start marker', async () => {
    const { container } = render(<RideMap points={POINTS} label="Mapa de la última salida" />);
    await waitFor(() => expect(container.querySelector('path.rmap-thread')).not.toBeNull());
    expect(container.querySelector('path.rmap-halo')).not.toBeNull();
    expect(container.querySelector('path.rmap-core')).not.toBeNull();
    expect(container.querySelector('path.rmap-start')).not.toBeNull();
    // El hilo va encima del núcleo, y este encima del halo.
    const order = [...container.querySelectorAll('path')].map((p) => p.getAttribute('class') ?? '');
    const at = (c: string) => order.findIndex((k) => k.includes(c));
    expect(at('rmap-halo')).toBeLessThan(at('rmap-core'));
    expect(at('rmap-core')).toBeLessThan(at('rmap-thread'));
  });

  it('draws road connectors over the track in their own class', async () => {
    const overlays = [{ path: POINTS.slice(0, 2), kind: 'connector' as const }, { path: POINTS.slice(2), kind: 'return' as const }];
    const { container } = render(<RideMap points={POINTS} label="Mapa del empalme" overlays={overlays} />);
    await waitFor(() => expect(container.querySelector('path.rmap-connector')).not.toBeNull());
    expect(container.querySelector('path.rmap-connector--return')).not.toBeNull();
  });

  it('zoom buttons have Spanish names', async () => {
    render(<RideMap points={POINTS} label="Mapa ampliado" />);
    expect(await screen.findByRole('button', { name: 'Acercar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alejar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zoom/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encuadrar ruta' })).toBeInTheDocument();
  });

  it('static map keeps the CyclOSM and OpenStreetMap attribution when asked', async () => {
    render(<RideMap points={POINTS} label="Mapa de la última salida" interactive={false} attribution />);
    expect(await screen.findByRole('link', { name: 'CyclOSM' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /OpenStreetMap/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acercar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encuadrar ruta' })).not.toBeInTheDocument();
  });

  it('tint pane sits between tiles and tracks', async () => {
    const { container } = render(<RideMap points={POINTS} label="Mapa de la última salida" />);
    await waitFor(() => expect(container.querySelector('.leaflet-tint-pane')).not.toBeNull());
    const pane = container.querySelector<HTMLElement>('.leaflet-tint-pane')!;
    expect(pane.style.zIndex).toBe('250');
    expect(pane.querySelector('.map-tint')).not.toBeNull();
  });
});

describe('mapOptions', () => {
  it('mapOptions disables wheel zoom', () => {
    expect(mapOptions(false, false).scrollWheelZoom).toBe(false);
    expect(mapOptions(false, false).zoomControl).toBe(false);
  });

  it('mapOptions turns animations off with reduced motion', () => {
    const o = mapOptions(true, false);
    expect(o.zoomAnimation).toBe(false);
    expect(o.fadeAnimation).toBe(false);
    expect(o.markerZoomAnimation).toBe(false);
    expect(mapOptions(false, false).zoomAnimation).not.toBe(false);
  });

  it('mapOptions disables dragging on mobile', () => {
    expect(mapOptions(false, true).dragging).toBe(false);
    expect(mapOptions(false, false).dragging).toBe(true);
  });
});
