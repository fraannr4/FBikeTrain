import { act, renderHook } from '@testing-library/react';
import { DESKTOP_QUERY, useDesktopLayout, WIDE_QUERY } from '../src/ui/hooks/useDesktopLayout';

type Fake = { matches: boolean; added: number; removed: number; listeners: Set<() => void> };

describe('useDesktopLayout', () => {
  const original = window.matchMedia;
  let media: Map<string, Fake>;
  const fake = (query: string) => {
    let entry = media.get(query);
    if (!entry) { entry = { matches: false, added: 0, removed: 0, listeners: new Set() }; media.set(query, entry); }
    return entry;
  };
  beforeEach(() => {
    media = new Map();
    window.matchMedia = ((query: string) => {
      const entry = fake(query);
      return {
        get matches() { return entry.matches; },
        addEventListener: (_: string, fn: () => void) => { entry.added++; entry.listeners.add(fn); },
        removeEventListener: (_: string, fn: () => void) => { entry.removed++; entry.listeners.delete(fn); },
      };
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = original; });

  it('no se resuscribe al volver a renderizar', () => {
    const { rerender } = renderHook(() => useDesktopLayout());
    rerender(); rerender(); rerender();
    expect(fake(DESKTOP_QUERY).added).toBe(1);
    expect(fake(DESKTOP_QUERY).removed).toBe(0);
  });

  it('cambia de consulta: suelta la anterior y escucha la nueva', () => {
    const { rerender } = renderHook(({ query }) => useDesktopLayout(query), { initialProps: { query: DESKTOP_QUERY } });
    rerender({ query: WIDE_QUERY });
    expect(fake(DESKTOP_QUERY).removed).toBe(1);
    expect(fake(WIDE_QUERY).added).toBe(1);
  });

  it('responde al cambio de tamaño', () => {
    const { result } = renderHook(() => useDesktopLayout());
    expect(result.current).toBe(false);
    act(() => {
      const entry = fake(DESKTOP_QUERY);
      entry.matches = true;
      entry.listeners.forEach((fn) => fn());
    });
    expect(result.current).toBe(true);
  });
});
