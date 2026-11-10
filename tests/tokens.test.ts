import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appPath = resolve(__dirname, '../src/ui/styles/tokens.css');
const designPath = resolve(__dirname, '../docs/design/tokens.css');
const design = readFileSync(designPath, 'utf8');
const app = existsSync(appPath) ? readFileSync(appPath, 'utf8') : '';

type Block = Map<string, string>;

function block(css: string, selector: RegExp): Block {
  const match = css.match(selector);
  if (!match) throw new Error(`No encuentro el bloque ${selector}`);
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

const dark = () => block(app, /:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
const light = () => block(app, /:root\[data-theme="light"\]\s*\{([^}]*)\}/);

// Tokens [chart]: los que lo llevan en su línea y los de un grupo cuya cabecera lo lleva.
function chartTokens(css: string): string[] {
  const darkBody = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? '';
  const names: string[] = [];
  let inGroup = false;
  for (const line of darkBody.split('\n')) {
    if (/\/\*\s*-{2,}/.test(line)) inGroup = line.includes('[chart]');
    for (const [, name] of line.matchAll(/(--[\w-]+)\s*:/g)) {
      if (inGroup || line.includes('[chart]')) names.push(name);
    }
  }
  return names;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  it('keeps the original typography, spacing, geometry and motion tokens', () => {
    expect(existsSync(appPath)).toBe(true);
    // La paleta A sustituye los colores del prototipo, sin rediseñar su interfaz.
    const shared = /:root\s*\{([^}]*)\}\s*$/;
    expect(block(app, shared)).toEqual(block(design, shared));
  });

  it('chart tokens are hex or comma rgba', () => {
    const names = chartTokens(app);
    expect(names).toEqual(expect.arrayContaining(['--surface', '--line', '--acc-dist', '--g5', '--series-1', '--series-6']));
    const ok = (v: string) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) || /^rgba\(\d+, \d+, \d+, [\d.]+\)$/.test(v);
    for (const theme of [dark(), light()]) {
      for (const name of names) {
        expect({ name, value: theme.get(name), ok: ok(theme.get(name) ?? '') }).toMatchObject({ ok: true });
      }
    }
  });

  it('text meets the chosen A palette contrast on every surface, including 12px metadata', () => {
    const minima = [[9.30, 6.96, 5.84, 5.19, 6.53, 7.26, 6.01], [8.98, 5.93, 4.90, 5.01, 5.19, 5.16, 5.03]];
    for (const [i, theme] of [dark(), light()].entries()) {
      for (const surface of ['--bg', '--surface', '--surface-2', '--surface-3']) {
        for (const [j, ink] of ['--ink', '--ink-2', '--ink-3', '--link', '--good', '--warning', '--critical'].entries()) {
          const ratio = contrast(theme.get(ink)!, theme.get(surface)!);
          // La tabla presenta dos decimales; solo se tolera su redondeo, nunca bajar de AA.
          expect({ ink, surface, ratio, aa: ratio >= Math.max(4.5, minima[i][j] - 0.005) }).toMatchObject({ aa: true });
        }
      }
    }
  });

  it('keeps buttons, badges, difficulty labels and chart series readable', () => {
    for (const theme of [dark(), light()]) {
      for (const [fg, bg] of [['--on-action', '--action'], ['--on-action', '--action-hover'], ['--on-badge', '--badge'], ['--easy-ink', '--easy-bg'], ['--mid-ink', '--mid-bg'], ['--hard-ink', '--hard-bg']]) {
        expect(contrast(theme.get(fg)!, theme.get(bg)!)).toBeGreaterThanOrEqual(4.5);
      }
      for (let i = 1; i <= 6; i++) expect(contrast(theme.get(`--series-${i}`)!, theme.get('--surface')!)).toBeGreaterThanOrEqual(3);
    }
  });

  it('light theme turns glow and thread off', () => {
    expect(light().get('--glow')).toBe('0');
    expect(light().get('--thread')).toBe('0');
  });

  it('every dark token exists in light', () => {
    const missing = [...dark().keys()].filter((k) => !light().has(k));
    expect(missing).toEqual([]);
  });
});
