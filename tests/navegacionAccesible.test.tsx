import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { usePageTitle } from '../src/ui/hooks/usePageTitle';
import { NoEncontrada } from '../src/ui/pages/NoEncontrada';

function Titled({ title }: { title: string }) {
  usePageTitle(title);
  return null;
}

describe('título de la pestaña', () => {
  it('nombra la pantalla y vuelve al de la app al salir', () => {
    const { rerender, unmount } = render(<Titled title="Historial" />);
    expect(document.title).toBe('Historial · FBikeTrain');
    rerender(<Titled title="Rutas" />);
    expect(document.title).toBe('Rutas · FBikeTrain');
    unmount();
    expect(document.title).toBe('FBikeTrain');
  });
});

describe('dirección desconocida', () => {
  it('explica que no existe y ofrece volver a Inicio', () => {
    function Probe() { useNavigate(); return null; }
    render(<MemoryRouter initialEntries={['/no-existe']}><Probe /><Routes><Route path="*" element={<NoEncontrada />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Pantalla no encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Inicio' })).toHaveAttribute('href', '/');
    expect(document.title).toBe('Pantalla no encontrada · FBikeTrain');
  });
});
