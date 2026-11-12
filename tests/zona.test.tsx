import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { ToastProvider } from '../src/ui/components/Toast';
import { Zona } from '../src/ui/pages/Zona';
import { areaCell, zonaSkippedRecently } from '../src/social/profileArea';
import { clearAllData } from '../src/db/repo';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings/settings';

const PLACE = 'Villa Prueba, Provincia Ficticia, España';

function fakeClient(error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as SupabaseClient, from, update, eq };
}

function nominatim(rows: unknown[] | 'down') {
  const fetchMock = vi.fn(async () => {
    if (rows === 'down') throw new TypeError('offline');
    return new Response(JSON.stringify(rows), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderZona(client: SupabaseClient, path = '/zona') {
  const account = { client, user: { id: 'u1' } as User };
  return render(
    <AccountContext.Provider value={account}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes>
            <Route path="/zona" element={<Zona />} />
            <Route path="/" element={<p>Pantalla de Inicio</p>} />
            <Route path="/ajustes" element={<p>Pantalla de Ajustes</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
}

async function chooseVilla() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('¿Desde qué pueblo sales a rodar?'), 'Villa');
  await user.click(await screen.findByRole('radio', { name: PLACE }, { timeout: 4000 }));
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  return user;
}

describe('Tu zona', () => {
  beforeEach(async () => {
    await clearAllData();
    localStorage.removeItem('fbt-zona-skip');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('la celda se redondea a 2 decimales', () => {
    expect(areaCell({ lat: 41.6077, lng: 2.2876 })).toEqual({ area_lat: 41.61, area_lng: 2.29 });
    expect(areaCell({ lat: -3.704, lng: -0.756 })).toEqual({ area_lat: -3.7, area_lng: -0.76 });
  });

  it('explica qué se guarda y no busca con menos de 3 letras', async () => {
    const fetchMock = nominatim([]);
    renderZona(fakeClient().client);
    expect(screen.getByText('Solo guardamos el nombre del pueblo y una zona aproximada. Tu dirección exacta no sale del móvil.')).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('¿Desde qué pueblo sales a rodar?'), 'Vi');
    await new Promise((r) => setTimeout(r, 500));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('elegir un pueblo guarda la localidad y la celda redondeada, fija Casa si faltaba y vuelve a Inicio', async () => {
    nominatim([{ display_name: PLACE, lat: '41.6077', lon: '2.2876' }]);
    const { client, from, update, eq } = fakeClient();
    renderZona(client);
    await chooseVilla();
    expect(await screen.findByText('Pantalla de Inicio')).toBeInTheDocument();
    expect(from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ locality: PLACE, area_lat: 41.61, area_lng: 2.29 });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
    expect((await loadSettings()).home).toEqual({ lat: 41.6077, lng: 2.2876 });
  });

  it('con Casa ya elegida no la cambia', async () => {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), home: { lat: 40.1234, lng: -3.4321 } });
    nominatim([{ display_name: PLACE, lat: '41.6077', lon: '2.2876' }]);
    renderZona(fakeClient().client);
    await chooseVilla();
    expect(await screen.findByText('Pantalla de Inicio')).toBeInTheDocument();
    expect((await loadSettings()).home).toEqual({ lat: 40.1234, lng: -3.4321 });
  });

  it('desde Ajustes vuelve a Ajustes', async () => {
    nominatim([{ display_name: PLACE, lat: '41.6077', lon: '2.2876' }]);
    renderZona(fakeClient().client, '/zona?desde=ajustes');
    await chooseVilla();
    expect(await screen.findByText('Pantalla de Ajustes')).toBeInTheDocument();
  });

  it('si el servidor no guarda, lo dice y no toca Casa', async () => {
    nominatim([{ display_name: PLACE, lat: '41.6077', lon: '2.2876' }]);
    renderZona(fakeClient({ message: 'fallo' }).client);
    await chooseVilla();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido guardar tu zona.');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    expect((await loadSettings()).home).toBeNull();
  });

  it('si ha cambiado la zona demasiadas veces hoy, muestra el mensaje del servidor tal cual', async () => {
    nominatim([{ display_name: PLACE, lat: '41.6077', lon: '2.2876' }]);
    renderZona(fakeClient({ message: 'Has cambiado tu zona demasiadas veces hoy. Prueba mañana.', code: 'ZN429' }).client);
    await chooseVilla();
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Has cambiado tu zona demasiadas veces hoy\. Prueba mañana\.$/);
    expect((await loadSettings()).home).toBeNull();
  });

  it('«Ahora no» deja la marca de 7 días y vuelve a Inicio', async () => {
    renderZona(fakeClient().client);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(await screen.findByText('Pantalla de Inicio')).toBeInTheDocument();
    expect(zonaSkippedRecently(Date.now())).toBe(true);
    expect(zonaSkippedRecently(Date.now() + 8 * 86_400_000)).toBe(false);
  });

  it('con Nominatim caído lo dice y deja «Ahora no»', async () => {
    nominatim('down');
    renderZona(fakeClient().client);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('¿Desde qué pueblo sales a rodar?'), 'Villa');
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('No se ha podido buscar el pueblo.');
    await user.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(await screen.findByText('Pantalla de Inicio')).toBeInTheDocument();
  });
});
