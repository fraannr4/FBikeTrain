import type { Page } from '@playwright/test';

export type ContrastReport = { contrast: string[]; unchecked: number; checked: number };

/**
 * Contraste de todo el texto visible (WCAG 1.4.3: 4,5:1, o 3:1 en texto grande) sobre el
 * fondo compuesto de las capas que hay debajo. Es la misma comprobación que
 * docs/design/prototipo-movil/shots.mjs, sin las demás (zonas táctiles, cortes...).
 * Los textos sobre una imagen o un fondo que no se puede leer cuentan como `unchecked`.
 */
export function auditContrast(page: Page, minimumTextRatio?: number): Promise<ContrastReport> {
  return page.evaluate((minimumTextRatio) => {
    const r = { contrast: [] as string[], unchecked: 0, checked: 0 };
    const y0 = scrollY;
    type C = [number, number, number, number];
    const desc = (el: Element) => {
      const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const c = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      return `${el.tagName.toLowerCase()}${c} "${t}"`;
    };
    const effOpacity = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement) o *= +getComputedStyle(n).opacity;
      return o;
    };
    const visible = (el: Element) => {
      if (el.closest('[hidden], .sr-only, dialog:not([open]), [inert]')) return false;
      // Una etiqueta de gráfica puede ser visible aunque su alternativa accesible sea otro texto.
      if (minimumTextRatio === undefined && el.closest('[aria-hidden="true"]')) return false;
      const shut = el.closest('details:not([open])');
      if (shut && !el.closest('summary')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const b = el.getBoundingClientRect();
      return b.width > 1 && b.height > 1 && effOpacity(el) >= 0.05;
    };
    const ownText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
    const parse = (s: string): C | null => {
      let m = s.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      m = s.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)/);
      if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
      return null;
    };
    const over = (top: C, bot: C): C => {
      const a = top[3];
      return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1];
    };
    const lum = (c: C) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    // Capas bajo el centro del texto (incluye hermanos posicionados); si no se ve, sus ancestros.
    const bgOf = (el: Element): C | null => {
      let bx = el.getBoundingClientRect();
      if (bx.top < 0 || bx.bottom > innerHeight) {
        scrollTo(0, scrollY + bx.top - innerHeight / 2);
        bx = el.getBoundingClientRect();
      }
      const cx = bx.left + Math.min(bx.width / 2, 12);
      const cy = bx.top + bx.height / 2;
      const stack = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementsFromPoint(cx, cy) : [];
      const at = stack.indexOf(el);
      const chain: Element[] = at >= 0 ? stack.slice(at) : [];
      if (!chain.length) for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
      const layers: C[] = [];
      for (const n of chain) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage) && n !== el) return null;
        const c = parse(cs.backgroundColor);
        if (c === null) return null;
        if (c[3] > 0) {
          layers.push(c);
          if (c[3] >= 0.999) break;
        }
      }
      let base: C = [255, 255, 255, 1];
      if (!layers.length || layers[layers.length - 1][3] < 0.999) base = parse(getComputedStyle(document.body).backgroundColor) ?? base;
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      return base;
    };
    document.querySelectorAll('body *').forEach((el) => {
      // El modo estricto incluye las etiquetas SVG; paths y otras formas siguen siendo decorativos.
      const svgText = el.matches('svg text, svg tspan');
      if (el.closest('script, style, template') || (el.closest('svg') && !(minimumTextRatio !== undefined && svgText)) || !ownText(el) || !visible(el)) return;
      const cs = getComputedStyle(el);
      const fg = parse(svgText ? cs.fill : cs.color);
      const bg = bgOf(el);
      if (!fg || !bg) {
        r.unchecked++;
        return;
      }
      const op = effOpacity(el);
      if (op < 0.6) return; // atenuado a propósito (deshabilitado)
      r.checked++;
      const f = over([fg[0], fg[1], fg[2], fg[3] * op * (svgText ? +cs.fillOpacity : 1)], bg);
      const L1 = lum(f);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const fs = parseFloat(cs.fontSize);
      const large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (minimumTextRatio ?? (large ? 3 : 4.5))) r.contrast.push(`${desc(el)} ${ratio.toFixed(2)}:1`);
    });
    scrollTo(0, y0);
    r.contrast = [...new Set(r.contrast)];
    return r;
  }, minimumTextRatio);
}
