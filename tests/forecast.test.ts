import {
  clearForecastCache, dayOptions, defaultSlot, fetchForecast, forecastUrl, hoursFor, parseForecast, pickHour, roundPoint, WeatherError,
} from '../src/weather/forecast';

// Respuesta sintética con la forma real de Open-Meteo (hourly con arrays paralelos, hora local de Madrid).
const times = ['2026-11-17T09:00', '2026-11-17T10:00', '2026-11-17T11:00'];
const body = (over: Record<string, unknown> = {}) => ({
  latitude: 41.4, longitude: 2.2, timezone: 'Europe/Madrid',
  hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation_probability: '%', wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h' },
  hourly: {
    time: times,
    temperature_2m: [9.5, 11, 13.2],
    precipitation_probability: [5, null, 60],
    wind_speed_10m: [12.4, 18, 25],
    wind_direction_10m: [300, 315, 10],
    wind_gusts_10m: [20, 31, 40],
  },
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearForecastCache();
});

describe('roundPoint', () => {
  it('redondea a 2 decimales (cerca de 1 km), nunca el punto exacto', () => {
    expect(roundPoint({ lat: 41.38794, lng: 2.17435 })).toEqual({ lat: 41.39, lng: 2.17 });
  });
});

describe('forecastUrl', () => {
  it('pide solo las variables horarias necesarias, en hora de Madrid y km/h', () => {
    const u = new URL(forecastUrl({ lat: 41.39, lng: 2.17 }));
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('latitude')).toBe('41.39');
    expect(u.searchParams.get('longitude')).toBe('2.17');
    expect(u.searchParams.get('hourly')).toBe('temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    expect(u.searchParams.get('timezone')).toBe('Europe/Madrid');
    expect(u.searchParams.get('wind_speed_unit')).toBe('kmh');
    expect(u.searchParams.get('forecast_days')).toBe('7');
  });
});

describe('parseForecast', () => {
  it('convierte los arrays paralelos en horas', () => {
    const hours = parseForecast(body());
    expect(hours).toHaveLength(3);
    expect(hours[0]).toEqual({ time: '2026-11-17T09:00', tempC: 9.5, rainPct: 5, windKmh: 12.4, windFromDeg: 300, gustKmh: 20 });
    expect(hours[1].rainPct).toBeNull();
  });
  it('rechaza una respuesta con otra forma', () => {
    expect(() => parseForecast({ hourly: { time: times } })).toThrow(WeatherError);
    expect(() => parseForecast(body({ hourly: { ...body().hourly, wind_speed_10m: [1] } }))).toThrow(WeatherError);
    expect(() => parseForecast('hola')).toThrow(WeatherError);
  });
  it('si falta el viento en una hora, la descarta', () => {
    const b = body();
    b.hourly.wind_speed_10m = [12.4, null as unknown as number, 25];
    expect(parseForecast(b).map((h) => h.time)).toEqual(['2026-11-17T09:00', '2026-11-17T11:00']);
  });
});

describe('pickHour', () => {
  it('encuentra la hora por día y hora', () => {
    const hours = parseForecast(body());
    expect(pickHour(hours, '2026-11-17', 10)?.windKmh).toBe(18);
    expect(pickHour(hours, '2026-11-17', 23)).toBeNull();
  });
});

describe('fetchForecast', () => {
  const ok = () => vi.fn(async (_url: string) => new Response(JSON.stringify(body()), { status: 200 }));

  it('pide con el punto redondeado y cachea 30 minutos por punto redondeado', async () => {
    const f = ok();
    vi.stubGlobal('fetch', f);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T08:00:00Z'));
    const a = await fetchForecast({ lat: 41.38794, lng: 2.17435 });
    // Otro punto que redondea igual: sale de la caché.
    await fetchForecast({ lat: 41.3912, lng: 2.1749 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain('latitude=41.39&longitude=2.17');
    expect(a).toHaveLength(3);
    vi.setSystemTime(new Date('2026-11-17T08:29:00Z'));
    await fetchForecast({ lat: 41.39, lng: 2.17 });
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-17T08:31:00Z'));
    await fetchForecast({ lat: 41.39, lng: 2.17 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('no mezcla puntos distintos', async () => {
    const f = ok();
    vi.stubGlobal('fetch', f);
    await fetchForecast({ lat: 41.39, lng: 2.17 });
    await fetchForecast({ lat: 40.41, lng: -3.7 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('no cachea un fallo', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 500 })).mockResolvedValueOnce(new Response(JSON.stringify(body()), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await expect(fetchForecast({ lat: 41.39, lng: 2.17 })).rejects.toBeInstanceOf(WeatherError);
    await expect(fetchForecast({ lat: 41.39, lng: 2.17 })).resolves.toHaveLength(3);
  });
  it('sin conexión lanza WeatherError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchForecast({ lat: 41.39, lng: 2.17 })).rejects.toBeInstanceOf(WeatherError);
  });
  it('pasa la señal y deja pasar la cancelación sin convertirla', async () => {
    const f = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
    }));
    vi.stubGlobal('fetch', f);
    const c = new AbortController();
    const p = fetchForecast({ lat: 41.39, lng: 2.17 }, c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.mock.calls[0][1]?.signal).toBe(c.signal);
  });
});

describe('día y hora', () => {
  // 2026-11-17 10:20 en Madrid (UTC+1).
  const now = new Date('2026-11-17T10:20:00+01:00').getTime();

  it('por defecto es hoy a la hora siguiente', () => {
    expect(defaultSlot(now)).toEqual({ date: '2026-11-17', hour: 11 });
  });
  it('de madrugada empieza a las 7', () => {
    expect(defaultSlot(new Date('2026-11-17T03:10:00+01:00').getTime())).toEqual({ date: '2026-11-17', hour: 7 });
  });
  it('de noche pasa a mañana a las 9', () => {
    expect(defaultSlot(new Date('2026-11-17T21:40:00+01:00').getTime())).toEqual({ date: '2026-11-18', hour: 9 });
  });
  it('ofrece hoy y los 6 días siguientes', () => {
    const days = dayOptions(now);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: '2026-11-17', label: 'Hoy' });
    expect(days[1]).toMatchObject({ date: '2026-11-18', label: 'Mañana' });
    expect(days[6].date).toBe('2026-11-23');
    expect(days[2].label).toMatch(/^jue/i);
  });
  it('hoy solo ofrece horas que no han pasado; otros días de 6 a 21', () => {
    expect(hoursFor('2026-11-17', now)[0]).toBe(11);
    expect(hoursFor('2026-11-17', now).at(-1)).toBe(21);
    expect(hoursFor('2026-11-19', now)).toEqual(Array.from({ length: 16 }, (_, i) => 6 + i));
  });
});
