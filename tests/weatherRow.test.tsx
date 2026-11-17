import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LatLng } from '../src/domain/types';
import { clearForecastCache } from '../src/weather/forecast';
import { useRideWeather, WeatherRow, WindLine } from '../src/ui/routes/WeatherRow';

const START: LatLng = { lat: 41.38794, lng: 2.17435 };
const NOW = new Date('2026-11-17T10:20:00+01:00');

/** Hora de mañana (18) con viento del norte de 18 km/h; hoy a las 11. */
const sample = () => {
  const time: string[] = [];
  for (const d of ['2026-11-17', '2026-11-18']) for (let h = 0; h < 24; h++) time.push(`${d}T${String(h).padStart(2, '0')}:00`);
  const fill = (v: number) => time.map(() => v);
  return {
    hourly: {
      time, temperature_2m: fill(12.4), precipitation_probability: fill(30), wind_speed_10m: fill(18), wind_direction_10m: fill(0), wind_gusts_10m: fill(35),
    },
  };
};

/** Norte 10 km y vuelta por la misma carretera. */
const OUT_AND_BACK: LatLng[] = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map((i) => ({ lat: START.lat + i * 0.018, lng: START.lng }));

function Harness({ start }: { start: LatLng | null }) {
  const w = useRideWeather(start);
  return (
    <>
      <WeatherRow weather={w} />
      <WindLine points={OUT_AND_BACK} weather={w.hour} />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  clearForecastCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WeatherRow y WindLine', () => {
  it('con previsión: temperatura, lluvia, viento y cómo pega en la vuelta', async () => {
    const f = vi.fn(async (_url: string) => new Response(JSON.stringify(sample()), { status: 200 }));
    vi.stubGlobal('fetch', f);
    render(<Harness start={START} />);
    expect(await screen.findByText(/12 °C/)).toBeInTheDocument();
    expect(screen.getByText(/Lluvia 30 %/)).toBeInTheDocument();
    expect(screen.getByText(/Viento 18 km\/h del N, rachas de 35/)).toBeInTheDocument();
    expect(screen.getByText(/De cara a la ida y a favor al volver \(18 km\/h del N\)/)).toBeInTheDocument();
    expect(screen.getByText(/50 % de cara · 50 % a favor · 0 % de lado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Día')).toHaveValue('2026-11-17');
    expect(screen.getByLabelText('Hora')).toHaveValue('11');
    // Solo viaja el punto redondeado.
    expect(String(f.mock.calls[0][0])).toContain('latitude=41.39&longitude=2.17');
  });

  it('cambiar de día recalcula la hora ofrecida', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sample()), { status: 200 })));
    render(<Harness start={START} />);
    await screen.findByText(/12 °C/);
    await userEvent.setup({ advanceTimers: () => undefined }).selectOptions(screen.getByLabelText('Día'), '2026-11-18');
    expect(screen.getByLabelText('Hora')).toHaveValue('11');
    expect(screen.getByRole('option', { name: '06:00' })).toBeInTheDocument();
  });

  it('si la previsión falla, solo una línea discreta y ninguna línea de viento', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<Harness start={START} />);
    expect(await screen.findByText('Sin previsión ahora')).toBeInTheDocument();
    expect(screen.queryByLabelText('Día')).not.toBeInTheDocument();
    expect(screen.queryByText(/km\/h/)).not.toBeInTheDocument();
  });

  it('sin inicio no pide nada ni pinta nada', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { container } = render(<Harness start={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(f).not.toHaveBeenCalled();
  });

  it('con viento flojo lo dice y no reparte porcentajes', async () => {
    const body = sample();
    body.hourly.wind_speed_10m = body.hourly.wind_speed_10m.map(() => 6);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    render(<Harness start={START} />);
    await waitFor(() => expect(screen.getByText(/Viento flojo \(6 km\/h del N\)/)).toBeInTheDocument());
    expect(screen.queryByText(/de cara ·/)).not.toBeInTheDocument();
  });
});
