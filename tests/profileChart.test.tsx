import { render, screen } from '@testing-library/react';
import { ProfileSvg } from '../src/ui/charts/ProfileSvg';
import { gradeClass } from '../src/ui/charts/grade';
import type { ProfilePoint } from '../src/ui/profile';

/** 87,6 km: llano hasta el km 40 y luego una subida al 8 % durante 2 km. */
const RIDE: ProfilePoint[] = Array.from({ length: 877 }, (_, i) => {
  const dM = Math.min(i * 100, 87_600);
  const climb = dM > 40_000 && dM <= 42_000 ? (dM - 40_000) * 0.08 : dM > 42_000 ? 160 : 0;
  return { dM, ele: 300 + climb };
});

describe('ProfileSvg (perfil de la última salida)', () => {
  it('aria label is kept', () => {
    render(<ProfileSvg profile={RIDE} label="Perfil de altitud: mínima 300 m, máxima 460 m" />);
    expect(screen.getByRole('img', { name: 'Perfil de altitud: mínima 300 m, máxima 460 m' })).toBeInTheDocument();
  });

  it('legend lists only present classes', () => {
    const { container } = render(<ProfileSvg profile={RIDE} label="Perfil" legend />);
    expect(screen.getByText('Llano o bajada')).toBeInTheDocument();
    expect(screen.getByText('7–10 %')).toBeInTheDocument();
    expect(screen.queryByText('16 % o más')).not.toBeInTheDocument();
    const drawn = new Set([...container.querySelectorAll('polygon')].map((p) => p.getAttribute('class')));
    expect(container.querySelectorAll('figcaption > span:not(.sr-only)')).toHaveLength(drawn.size);
  });

  it('negative classes count as flat', () => {
    const down = RIDE.map((p) => ({ dM: p.dM, ele: 900 - p.ele }));
    render(<ProfileSvg profile={down} label="Perfil" legend />);
    const legend = screen.getByText('Llano o bajada').closest('figcaption')!;
    expect(legend).toHaveTextContent(/^Pendientes:Llano o bajada$/);
  });

  it('gradeClass thresholds', () => {
    expect(gradeClass(0.9)).toBe(0);
    expect(gradeClass(1)).toBe(1);
    expect(gradeClass(6.9)).toBe(2);
    expect(gradeClass(7)).toBe(3);
    expect(gradeClass(15.9)).toBe(4);
    expect(gradeClass(16)).toBe(5);
  });

  it('km axis has round ticks placed by distance and the total at the end', () => {
    const { container } = render(<ProfileSvg profile={RIDE} label="Perfil" axis="ticks" />);
    const ticks = [...container.querySelectorAll<HTMLElement>('.profile-axis span')];
    expect(ticks.map((t) => t.textContent)).toEqual(['0', '20', '40', '60', '87,6 km']);
    // Proporcionales a los km: el 20 queda al 22,83 % de 87,6 km.
    expect(ticks[1].style.left).toBe('22.83%');
    expect(ticks.at(-1)!.style.left).toBe('100%');
  });
});
