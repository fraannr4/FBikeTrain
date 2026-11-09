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
  it('tokens.css is a literal copy of the design tokens', () => {
    expect(existsSync(appPath)).toBe(true);
    expect(app.replace(/\r\n/g, '\n')).toBe(design.replace(/\r\n/g, '\n'));
  });

  it('chart tokens are hex or comma rgba', () => {
    const names = chartTokens(app);
    expect(names).toEqual(expect.arrayContaining(['--surface', '--line', '--acc-dist', '--g5']));
    const ok = (v: string) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) || /^rgba\(\d+, \d+, \d+, [\d.]+\)$/.test(v);
    for (const theme of [dark(), light()]) {
      for (const name of names) {
        expect({ name, value: theme.get(name), ok: ok(theme.get(name) ?? '') }).toMatchObject({ ok: true });
      }
    }
  });

  it('ink is AA on surface in both themes', () => {
    for (const theme of [dark(), light()]) {
      const surface = theme.get('--surface')!;
      for (const ink of ['--ink', '--ink-2', '--ink-3']) {
        const ratio = contrast(theme.get(ink)!, surface);
        expect({ ink, ratio, aa: ratio >= 4.5 }).toMatchObject({ aa: true });
      }
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
