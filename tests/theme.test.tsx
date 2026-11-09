import { act, renderHook } from '@testing-library/react';
import { getTheme, setTheme, subscribe, THEME_KEY, useTheme } from '../src/ui/theme/theme';
import { useReducedMotion } from '../src/ui/theme/motion';

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '<meta name="theme-color" content="#0A1122">';
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getTheme is dark without attribute', () => {
    expect(getTheme()).toBe('dark');
  });

  it('setTheme persists and notifies', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    // jsdom no aplica tokens.css: simulamos el --bg resuelto del tema claro.
    document.documentElement.style.setProperty('--bg', '#EEF2F8');

    setTheme('light');

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(getTheme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#EEF2F8');
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    setTheme('dark');
    expect(cb).toHaveBeenCalledTimes(1);
    document.documentElement.style.removeProperty('--bg');
  });

  it('setTheme survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Cuota agotada', 'QuotaExceededError');
    });
    const cb = vi.fn();
    const off = subscribe(cb);

    expect(() => setTheme('light')).not.toThrow();
    expect(getTheme()).toBe('light');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('useTheme rerenders on change', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe('dark');

    act(() => setTheme('light'));
    expect(result.current).toBe('light');

    act(() => setTheme('dark'));
    expect(result.current).toBe('dark');
  });
});

describe('useReducedMotion', () => {
  const original = window.matchMedia;

  afterEach(() => {
    window.matchMedia = original;
  });

  it('follows prefers-reduced-motion', () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('is false without matchMedia', () => {
    // @ts-expect-error: simula un entorno sin matchMedia.
    delete window.matchMedia;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
