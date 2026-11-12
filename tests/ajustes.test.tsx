import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { Ajustes } from '../src/ui/pages/Ajustes';
import { ToastProvider } from '../src/ui/components/Toast';
import { db } from '../src/db/db';
import { clearAllData, setLastBackupAt } from '../src/db/repo';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/settings/settings';
import { hasDemoData } from '../src/demo/demoData';
import type { StoredActivity } from '../src/domain/types';

const DAY = 86_400_000;

// La pantalla lleva la barra superior del kit (enlace de volver): se monta con un router en memoria.
function renderAjustes(path = '/ajustes') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <Ajustes />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function ride(id: string): StoredActivity {
  return {
    id,
    startTime: Date.UTC(2026, 9, 1, 8),
    sport: 'cycling',
    totals: { distanceM: 40_000, movingTimeS: 5400, elapsedTimeS: 5600, elevGainM: 300, avgSpeedMs: 7.4, maxSpeedMs: 14 },
    hasTrack: false,
    source: 'gpx',
    importedAt: Date.UTC(2026, 9, 2),
  };
}

describe('Ajustes', () => {
  beforeEach(async () => {
    await clearAllData();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('labels every field', async () => {
    const user = userEvent.setup();
    renderAjustes();
    for (const name of ['Nombre', 'Clave de OpenRouteService', 'Clave de la IA']) {
      expect(await screen.findByLabelText(name)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Usar otro proveedor' }));
    expect(await screen.findByLabelText('URL base de la IA')).toHaveValue('https://api.groq.com/openai/v1');
    expect(screen.getByLabelText('Modelo de la IA')).toBeInTheDocument();
  });

  it('groups the settings in sections', async () => {
    renderAjustes();
    await screen.findByLabelText('Nombre');
    const titles = Array.from(document.querySelectorAll('details.disclosure > summary .row-title')).map((n) => n.textContent);
    expect(titles).toEqual(['Perfil', 'Casa', 'Claves de servicio', 'Apariencia', 'Copia de seguridad', 'Borrar datos']);
  });

  it('saves each change when leaving the field', async () => {
    const user = userEvent.setup();
    renderAjustes();
    await user.type(await screen.findByLabelText('Nombre'), 'Ana');
    await user.tab();
    expect(await screen.findByText('Nombre guardado')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Clave de OpenRouteService'), 'ors-123');
    await user.tab();
    expect(await screen.findByText('Clave guardada')).toBeInTheDocument();
    const s = await loadSettings();
    expect(s.displayName).toBe('Ana');
    expect(s.ors.apiKey).toBe('ors-123');
  });

  it('explains when browser storage is unavailable', async () => {
    vi.spyOn(db.settings, 'get').mockRejectedValueOnce(new Error('SecurityError'));
    renderAjustes();
    expect(await screen.findByText(/No se puede usar el almacenamiento de este navegador/)).toBeInTheDocument();
    expect(screen.queryByText('Cargando tus ajustes')).not.toBeInTheDocument();
  });

  it('explains when saving fails', async () => {
    const user = userEvent.setup();
    renderAjustes();
    await user.type(await screen.findByLabelText('Nombre'), 'Ana');
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se han podido guardar los ajustes/);
  });

  it('network failure mentions a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const user = userEvent.setup();
    renderAjustes();
    await user.type(await screen.findByLabelText('Clave de OpenRouteService'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Probar conexión con OpenRouteService' }));
    expect(await screen.findByText(/rechazado la clave/)).toBeInTheDocument();
  });

  it('shows the probe result as text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const user = userEvent.setup();
    renderAjustes();
    await user.type(await screen.findByLabelText('Clave de OpenRouteService'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Probar conexión con OpenRouteService' }));
    expect(await screen.findByText('La clave no es válida.')).toBeInTheDocument();
  });

  it('probe error is linked to the field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const user = userEvent.setup();
    renderAjustes();
    const input = await screen.findByLabelText('Clave de OpenRouteService');
    await user.type(input, 'mala');
    await user.click(screen.getByRole('button', { name: 'Probar conexión con OpenRouteService' }));
    const error = await screen.findByText('La clave no es válida.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toContain(error.closest('[id]')?.id);
  });

  it('a probe without key asks for it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    renderAjustes();
    await screen.findByLabelText('Clave de OpenRouteService');
    await user.click(screen.getByRole('button', { name: 'Probar conexión con OpenRouteService' }));
    expect(await screen.findByText('Pega la clave antes de probarla.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('key can be shown and hidden', async () => {
    const user = userEvent.setup();
    renderAjustes();
    const input = await screen.findByLabelText('Clave de OpenRouteService');
    const eye = screen.getByRole('button', { name: 'Mostrar la clave de OpenRouteService' });
    expect(input).toHaveAttribute('type', 'password');
    expect(eye).toHaveAttribute('aria-pressed', 'false');
    await user.click(eye);
    expect(input).toHaveAttribute('type', 'text');
    expect(eye).toHaveAttribute('aria-pressed', 'true');
    await user.click(eye);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Mostrar la clave de la IA' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('provider sheet rejects an address without https and saves a good one', async () => {
    const user = userEvent.setup();
    renderAjustes();
    await user.click(await screen.findByRole('button', { name: 'Usar otro proveedor' }));
    const url = await screen.findByLabelText('URL base de la IA');
    await user.clear(url);
    await user.type(url, 'api.ejemplo.com');
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByText('Escribe la dirección completa, empezando por https://')).toBeInTheDocument();
    expect(url).toHaveAttribute('aria-invalid', 'true');
    await user.clear(url);
    await user.type(url, 'https://api.ejemplo.com/v1');
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByText('Proveedor guardado: ejemplo.com')).toBeInTheDocument();
    expect((await loadSettings()).llm.baseUrl).toBe('https://api.ejemplo.com/v1');
  });

  it('home shows a privacy notice and never the place', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, home: { lat: 41.0123, lng: 2.5432 } });
    renderAjustes();
    expect(await screen.findByText('Punto de salida guardado.')).toBeInTheDocument();
    expect(screen.getByText('La IA nunca recibe Casa.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/41[.,]0123|2[.,]5432/);
  });

  it('without home and key, the first step is Casa', async () => {
    renderAjustes();
    expect(await screen.findByText('Para crear rutas faltan dos cosas:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empezar por Casa' })).toBeInTheDocument();
  });

  it('with the shared road service it does not ask for keys and folds them as advanced', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: { lat: 40.4168, lng: -3.7038 } });
    vi.stubEnv('VITE_SHARED_ORS_ENABLED', 'true');
    try {
      const account = { client: {} as SupabaseClient, user: { id: 'u1' } as User };
      render(
        <AccountContext.Provider value={account}>
          <MemoryRouter initialEntries={['/ajustes']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ToastProvider>
              <Ajustes />
            </ToastProvider>
          </MemoryRouter>
        </AccountContext.Provider>,
      );
      await screen.findByLabelText('Nombre');
      const titles = Array.from(document.querySelectorAll('details.disclosure > summary .row-title')).map((n) => n.textContent);
      expect(titles).toContain('Avanzado: usar mis propias claves');
      expect(document.querySelector('details#claves')).not.toHaveAttribute('open');
      expect(screen.queryByText(/Para crear rutas falta/)).not.toBeInTheDocument();
      expect(screen.queryByText('Falta la clave de rutas')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('with an account, Tu zona shows the town, links to change it and toggles its visibility', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: { lat: 41.0123, lng: 2.5432 } });
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: [{ locality: 'Villa Prueba, Provincia Ficticia', show_area: true }], error: null }),
      from: vi.fn(() => ({ update })),
    } as unknown as SupabaseClient;
    render(
      <AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}>
        <MemoryRouter initialEntries={['/ajustes?abrir=zona']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <Ajustes />
          </ToastProvider>
        </MemoryRouter>
      </AccountContext.Provider>,
    );
    const zona = await waitFor(() => {
      const d = document.querySelector<HTMLElement>('details#zona');
      if (!d) throw new Error('sin sección Tu zona');
      return d;
    });
    expect(await within(zona).findByRole('link', { name: 'Cambiar' })).toHaveAttribute('href', '/zona?desde=ajustes');
    expect(zona).toHaveTextContent('Sales a rodar desde Villa Prueba, Provincia Ficticia.');
    const visible = within(zona).getByRole('checkbox', { name: 'Mostrar mi zona a otros usuarios' });
    expect(visible).toBeChecked();
    await userEvent.setup().click(visible);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ show_area: false }));
    expect(eq).toHaveBeenCalledWith('id', 'u1');
    expect(visible).not.toBeChecked();
    expect(document.body.textContent).not.toMatch(/41[.,]0123|2[.,]5432/);
  });

  it('if hiding the zone fails, the switch goes back and says so', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: [{ locality: null, show_area: true }], error: null }),
      from: vi.fn(() => ({ update: () => ({ eq: vi.fn().mockResolvedValue({ error: { message: 'x' } }) }) })),
    } as unknown as SupabaseClient;
    render(
      <AccountContext.Provider value={{ client, user: { id: 'u1' } as User }}>
        <MemoryRouter initialEntries={['/ajustes?abrir=zona']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <Ajustes />
          </ToastProvider>
        </MemoryRouter>
      </AccountContext.Provider>,
    );
    const zona = await waitFor(() => {
      const d = document.querySelector<HTMLElement>('details#zona');
      if (!d) throw new Error('sin sección Tu zona');
      return d;
    });
    expect(await within(zona).findByRole('link', { name: 'Indicar mi zona' })).toBeInTheDocument();
    const visible = within(zona).getByRole('checkbox', { name: 'Mostrar mi zona a otros usuarios' });
    await userEvent.setup().click(visible);
    expect(await screen.findByText('No se ha podido cambiar la visibilidad de tu zona.')).toBeInTheDocument();
    expect(visible).toBeChecked();
  });

  it('theme toggle lives in Apariencia', async () => {
    renderAjustes();
    const group = await screen.findByRole('group', { name: 'Tema' });
    const section = group.closest('details');
    expect(section?.querySelector('summary')).toHaveTextContent('Apariencia');
    expect(within(group).getByRole('button', { name: 'Oscuro' })).toBeInTheDocument();
  });

  it('backup keys checkbox is unchecked and warns', async () => {
    renderAjustes();
    const box = await screen.findByRole('checkbox', { name: 'Incluir claves' });
    expect(box).not.toBeChecked();
    expect(screen.getByText('Quien tenga el fichero podrá usar tus claves.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar copia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurar' })).toBeInTheDocument();
  });

  it('last backup date is shown', async () => {
    await setLastBackupAt(Date.now() - 12 * DAY);
    renderAjustes();
    expect(await screen.findByText('Última copia: hace 12 días')).toBeInTheDocument();
  });

  it('says when there is no backup yet', async () => {
    renderAjustes();
    expect(await screen.findByText('Aún no has hecho ninguna copia')).toBeInTheDocument();
  });

  it('export downloads a json without keys', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, displayName: 'Ana', ors: { apiKey: 'secreta-ors' } });
    let exported: Blob | undefined;
    // jsdom no implementa createObjectURL ni revokeObjectURL.
    URL.createObjectURL = vi.fn((b: Blob) => { exported = b; return 'blob:copia'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    renderAjustes();
    await user.click(await screen.findByRole('button', { name: 'Exportar copia' }));
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    const text = await exported!.text();
    expect(JSON.parse(text).settings.displayName).toBe('Ana');
    expect(text).not.toContain('secreta-ors');
    expect(await screen.findByText('Última copia: hoy')).toBeInTheDocument();
  });

  it('restore asks first and explains what it replaces', async () => {
    const user = userEvent.setup();
    renderAjustes();
    await user.click(await screen.findByRole('button', { name: 'Restaurar' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restaurar una copia' });
    expect(within(sheet).getByText('Sustituye tu calendario y tus objetivos')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Elegir la copia' })).toBeInTheDocument();
  });

  it('restore updates the form', async () => {
    const user = userEvent.setup();
    renderAjustes();
    await screen.findByLabelText('Nombre');
    const copy = JSON.stringify({ app: 'ciclismo', version: 1, exportedAt: '2026-11-06T10:00:00Z',
      settings: { displayName: 'Bea', home: null }, calendar: [], goals: [] });
    await user.upload(screen.getByLabelText('Fichero de copia'), new File([copy], 'copia.json', { type: 'application/json' }));
    expect(await screen.findByText('Copia restaurada.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Bea');
    expect((await loadSettings()).displayName).toBe('Bea');
  });

  it('restore explains an invalid file', async () => {
    const user = userEvent.setup();
    renderAjustes();
    await screen.findByLabelText('Nombre');
    await user.upload(screen.getByLabelText('Fichero de copia'), new File(['no es json'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText('El fichero no es una copia de esta aplicación.')).toBeInTheDocument();
  });

  it('restore explains another version', async () => {
    const user = userEvent.setup();
    renderAjustes();
    await screen.findByLabelText('Nombre');
    const copy = JSON.stringify({ app: 'ciclismo', version: 9, settings: {} });
    await user.upload(screen.getByLabelText('Fichero de copia'), new File([copy], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText(/es de otra versión de la aplicación/)).toBeInTheDocument();
  });

  it('delete all asks for confirmation', async () => {
    await db.activities.add(ride('r1'));
    await saveSettings({ ...DEFAULT_SETTINGS, displayName: 'Ana' });
    const user = userEvent.setup();
    renderAjustes();
    await screen.findByLabelText('Nombre');

    await user.click(screen.getByRole('button', { name: 'Borrar todos los datos' }));
    let sheet = await screen.findByRole('dialog', { name: 'Borrar todos los datos' });
    expect(within(sheet).getByText('1 salida')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await db.activities.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Borrar todos los datos' }));
    sheet = await screen.findByRole('dialog', { name: 'Borrar todos los datos' });
    await user.click(within(sheet).getByRole('button', { name: 'Borrar todo' }));
    expect(await screen.findByText('Datos borrados.')).toBeInTheDocument();
    expect(await db.activities.count()).toBe(0);
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
  });

  it('demo data can be removed', async () => {
    await db.activities.add(ride('demo-1'));
    await db.activities.add(ride('propia-1'));
    const user = userEvent.setup();
    renderAjustes();
    await user.click(await screen.findByRole('button', { name: 'Quitar datos de ejemplo' }));
    expect(await screen.findByText('Datos de ejemplo quitados')).toBeInTheDocument();
    expect(await hasDemoData()).toBe(false);
    expect(await db.activities.count()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Quitar datos de ejemplo' })).not.toBeInTheDocument();
  });

  it('without demo data there is nothing to remove', async () => {
    renderAjustes();
    await screen.findByLabelText('Nombre');
    expect(screen.queryByRole('button', { name: 'Quitar datos de ejemplo' })).not.toBeInTheDocument();
  });

  it('opens the section named in the link', async () => {
    renderAjustes('/ajustes?abrir=copia');
    await screen.findByLabelText('Nombre');
    const copia = document.getElementById('copia') as HTMLDetailsElement;
    expect(copia.open).toBe(true);
    expect((document.getElementById('perfil') as HTMLDetailsElement).open).toBe(false);
  });

  it('brings the linked section into view', async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      renderAjustes('/ajustes?abrir=copia');
      await screen.findByLabelText('Nombre');
      await waitFor(() => expect(scrolled).toContain(document.getElementById('copia')));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});

