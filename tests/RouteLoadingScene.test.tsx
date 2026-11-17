import { act, render, screen } from '@testing-library/react';
import { RouteLoadingScene } from '../src/ui/components/RouteLoadingScene';

describe('RouteLoadingScene', () => {
  let hidden: boolean;
  let reduced: boolean;
  let media: MediaQueryList;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  beforeEach(() => {
    hidden = false;
    reduced = false;
    frames = new Map();
    nextFrame = 0;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    media = Object.assign(new EventTarget(), { media: '(prefers-reduced-motion: reduce)' }) as MediaQueryList;
    Object.defineProperty(media, 'matches', { get: () => reduced });
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  });

  afterEach(() => vi.restoreAllMocks());

  function advance(time: number) {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(time)));
  }

  it('es decorativo y cada instancia conserva sus propias referencias SVG', () => {
    const { container, unmount } = render(<><RouteLoadingScene /><RouteLoadingScene /></>);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const scenes = [...container.querySelectorAll('svg')];
    expect(scenes).toHaveLength(2);
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scene of scenes) {
      expect(scene).toHaveAttribute('aria-hidden', 'true');
      for (const use of scene.querySelectorAll('use')) {
        expect([...scene.querySelectorAll('[id]')].some((element) => `#${element.id}` === use.getAttribute('href'))).toBe(true);
      }
    }
    expect(frames.size).toBe(2);
    unmount();
    expect(frames.size).toBe(0);
  });

  it('articula el pedaleo con una sola animación y la limpia al desmontar', () => {
    const { container, unmount } = render(<RouteLoadingScene />);
    const shin = container.querySelector('[data-leg="front"] [data-shin]')!;
    const original = shin.getAttribute('d');
    advance(100);
    advance(116);
    expect(shin.getAttribute('d')).not.toBe(original);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });

  it('detiene los fotogramas con la pestaña oculta y reanuda sin saltos de tiempo', () => {
    const { container, unmount } = render(<RouteLoadingScene />);
    advance(100);
    advance(116);
    const shin = container.querySelector('[data-leg="front"] [data-shin]')!;
    const before = shin.getAttribute('d');
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(0);
    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(1);
    advance(20_000);
    expect(shin.getAttribute('d')).toBe(before);
    unmount();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(0);
  });

  it('respeta el movimiento reducido inicial y sus cambios durante la carga', () => {
    reduced = true;
    const { container, unmount } = render(<RouteLoadingScene />);
    expect(frames.size).toBe(0);
    expect(container.querySelector('[data-shin]')).toHaveAttribute('d');
    reduced = false;
    act(() => media.dispatchEvent(new Event('change')));
    expect(frames.size).toBe(1);
    reduced = true;
    act(() => media.dispatchEvent(new Event('change')));
    expect(frames.size).toBe(0);
    unmount();
    reduced = false;
    act(() => media.dispatchEvent(new Event('change')));
    expect(frames.size).toBe(0);
  });
});
