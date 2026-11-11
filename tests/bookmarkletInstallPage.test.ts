import { screen, within } from '@testing-library/react';
import { bookmarkletHref, renderInstallPage } from '../src/bookmarklet/installPage';
import { APP_BASES, APP_BASE_PLACEHOLDER } from '../src/bookmarklet/protocol';

// Código de marcador sintético: lo que importa es dónde va la dirección de la app y cómo se codifica.
const CODE = `(function(){var a="${APP_BASE_PLACEHOLDER}";var b='"</textarea><script>alert(1)</script>&';console.log(a,b,"100%")})();`;
const decode = (href: string) => decodeURIComponent(href.slice('javascript:'.length));

describe('bookmarkletHref', () => {
  it('pone la dirección de la app en el código y lo codifica como enlace javascript:', () => {
    const href = bookmarkletHref(CODE, APP_BASES.prod);
    expect(href.startsWith('javascript:')).toBe(true);
    expect(href).not.toMatch(/[\s"<>]/);
    expect(decode(href)).toBe(CODE.replace(APP_BASE_PLACEHOLDER, APP_BASES.prod));
  });
  it('se niega si el código no lleva la marca exactamente una vez o la dirección no es válida', () => {
    expect(() => bookmarkletHref('(function(){})()', APP_BASES.prod)).toThrow();
    expect(() => bookmarkletHref(CODE + CODE, APP_BASES.prod)).toThrow();
    expect(() => bookmarkletHref(CODE, 'javascript:alert(1)//')).toThrow();
    expect(() => bookmarkletHref(CODE, 'https://fraannr4.github.io/FBikeTrain')).toThrow();
  });
});

const html = renderInstallPage(CODE);
const parsed = new DOMParser().parseFromString(html, 'text/html');
const mountBody = () => document.body.replaceChildren(...Array.from(parsed.body.cloneNode(true).childNodes));
const [themeScript, pageScript] = Array.from(parsed.querySelectorAll('script'), s => s.textContent ?? '');

describe('renderInstallPage', () => {
  beforeEach(mountBody);

  it('es una página completa en castellano con título', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(parsed.documentElement.lang).toBe('es');
    expect(parsed.title).toBe('Marcador de Wikiloc para FBikeTrain');
    expect(parsed.querySelector('meta[name="viewport"]')).not.toBeNull();
  });

  it('ofrece el marcador de producción para arrastrar y el de desarrollo aparte', () => {
    const link = screen.getByRole('link', { name: '→ FBikeTrain' });
    expect(link.getAttribute('href')).toBe(bookmarkletHref(CODE, APP_BASES.prod));
    expect(link.getAttribute('data-dev-href')).toBe(bookmarkletHref(CODE, APP_BASES.dev));
  });

  it('deja copiar el código para Chrome para Android', () => {
    expect(screen.getByLabelText('Código del marcador')).toHaveValue(bookmarkletHref(CODE, APP_BASES.prod));
    expect(screen.getByRole('button', { name: 'Copiar el código' })).toBeInTheDocument();
    const android = screen.getByRole('heading', { name: 'Instalar en Chrome para Android' }).closest('section')!;
    expect(within(android).getByText(/barra de direcciones/i)).toBeInTheDocument();
  });

  it('explica qué lee el marcador y qué no', () => {
    const section = screen.getByRole('heading', { name: 'Qué lee y qué no' }).closest('section')!;
    expect(section).toHaveTextContent(/nombre, los km, el desnivel, la dificultad, el autor y el enlace/i);
    expect(section).toHaveTextContent(/botón «Descargar»/);
    expect(section).toHaveTextContent(/no lee tus contraseñas ni tus cookies/i);
    expect(section).toHaveTextContent(/no salta Premium/i);
  });

  it('no deja HTML del código sin codificar en la página', () => {
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('</textarea><script>');
  });

  it('enlaza de vuelta con la app', () => {
    expect(screen.getByRole('link', { name: 'Volver a FBikeTrain' })).toHaveAttribute('href', './#/rutas');
  });
});

describe('script de la página de instalación', () => {
  // Se ejecuta el script de la página sobre el documento de la prueba, con la dirección simulada.
  const run = (hostname: string) => {
    mountBody();
    new Function('location', pageScript)({ hostname });
  };
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('en GitHub Pages usa el marcador de producción', () => {
    run('fraannr4.github.io');
    expect(screen.getByRole('link', { name: '→ FBikeTrain' })).toHaveAttribute('href', bookmarkletHref(CODE, APP_BASES.prod));
  });

  it('en local usa el marcador de desarrollo, también en el código para copiar', () => {
    run('localhost');
    const dev = bookmarkletHref(CODE, APP_BASES.dev);
    expect(screen.getByRole('link', { name: '→ FBikeTrain' })).toHaveAttribute('href', dev);
    expect(screen.getByLabelText('Código del marcador')).toHaveValue(dev);
  });

  it('pulsar el marcador en esta página no lo ejecuta y explica que se arrastra', () => {
    run('fraannr4.github.io');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByRole('link', { name: '→ FBikeTrain' }).dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.getElementById('aviso-arrastre')).toHaveTextContent(/arrastra el enlace/i);
  });

  it('copia el código y lo confirma', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    run('fraannr4.github.io');
    screen.getByRole('button', { name: 'Copiar el código' }).click();
    expect(writeText).toHaveBeenCalledWith(bookmarkletHref(CODE, APP_BASES.prod));
    expect(await screen.findByText('Código copiado.')).toBeInTheDocument();
  });

  it('toma el tema guardado de la app y, sin él, el oscuro', () => {
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    localStorage.setItem('fbt-theme', 'light');
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
