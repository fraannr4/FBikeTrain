import { render } from '@testing-library/react';
import { ValueText } from '../src/ui/components/ValueText';

const figs = (value: string) => {
  const { container } = render(<ValueText value={value} />);
  return Array.from(container.querySelectorAll('.fig')).map((n) => n.textContent);
};

describe('ValueText', () => {
  it('keeps text content', () => {
    for (const v of ['88 km', '1.240 m', '3 h 42 min', '24,6 km/h', '−8 %', 'Sin salidas']) {
      const { container, unmount } = render(<ValueText value={v} />);
      expect(container.textContent).toBe(v);
      unmount();
    }
  });

  it('marks digit groups as figures', () => {
    expect(figs('1.240 m')).toEqual(['1.240']);
    expect(figs('3 h 42 min')).toEqual(['3', '42']);
    expect(figs('24,6 km/h')).toEqual(['24,6']);
    expect(figs('−8 %')).toEqual(['−8']);
    expect(figs('Sin salidas')).toEqual([]);
  });

  it('wraps the rest in units', () => {
    const { container } = render(<ValueText value="3 h 42 min" />);
    expect(Array.from(container.querySelectorAll('.unit')).map((n) => n.textContent)).toEqual([' h ', ' min']);
  });
});
