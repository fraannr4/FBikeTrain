import type { MatcherFunction } from '@testing-library/react';

/**
 * Comparador de Testing Library que acepta el elemento más profundo cuyo `textContent`
 * completo es `text`. Sirve cuando la cifra y la unidad van en `<span>` distintos
 * («<span class="fig">88</span><span class="unit"> km</span>»). Playwright ya busca así.
 */
export function fullText(text: string): MatcherFunction {
  return (_content, element) => {
    if (!element || element.textContent !== text) return false;
    return !Array.from(element.children).some((child) => child.textContent === text);
  };
}
