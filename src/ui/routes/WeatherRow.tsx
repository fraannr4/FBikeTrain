import { useEffect, useMemo, useState } from 'react';
import { isAbort } from '../../ai/abort';
import type { LatLng } from '../../domain/types';
import { cardinal, windEffect, windSummary } from '../../routes/wind';
import { dayOptions, defaultSlot, fetchForecast, hoursFor, pickHour, roundPoint, type HourForecast } from '../../weather/forecast';
import { formatCount } from '../format';
import { ArrowDown } from '../icons';
import '../styles/weather.css';

type Slot = { date: string; hour: number };
export type RideWeather = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  /** La previsión de la hora elegida; `null` si no hay (aún o fuera del rango de 7 días). */
  hour: HourForecast | null;
  slot: Slot;
  setSlot: (s: Slot) => void;
  days: { date: string; label: string }[];
  hours: number[];
};

/**
 * Día y hora de la salida y su previsión (Open-Meteo) para el punto de salida redondeado. Falla en silencio:
 * `status: 'error'` deja las tarjetas como siempre y la fila dice «Sin previsión ahora».
 */
export function useRideWeather(start: LatLng | null): RideWeather {
  const [now] = useState(() => Date.now());
  const [slot, setSlot] = useState<Slot>(() => defaultSlot(now));
  const [state, setState] = useState<{ status: RideWeather['status']; hours: HourForecast[] }>({ status: 'idle', hours: [] });
  const point = start ? roundPoint(start) : null;
  const lat = point?.lat;
  const lng = point?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      setState({ status: 'idle', hours: [] });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ status: 'loading', hours: s.hours }));
    fetchForecast({ lat, lng }, controller.signal)
      .then((hours) => setState({ status: 'ok', hours }))
      .catch((e: unknown) => {
        if (!isAbort(e) && !controller.signal.aborted) setState({ status: 'error', hours: [] });
      });
    return () => controller.abort();
  }, [lat, lng]);

  const days = useMemo(() => dayOptions(now), [now]);
  const hours = useMemo(() => hoursFor(slot.date, now), [slot.date, now]);
  const hour = useMemo(() => pickHour(state.hours, slot.date, slot.hour), [state.hours, slot]);
  const choose = (s: Slot) => {
    const valid = hoursFor(s.date, now);
    setSlot({ date: s.date, hour: valid.includes(s.hour) ? s.hour : (valid[0] ?? s.hour) });
  };
  return { status: state.status, hour, slot, setSlot: choose, days, hours };
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Flecha hacia donde va el viento; el texto «del NO» dice lo mismo, así que la flecha es solo apoyo. */
function WindArrow({ fromDeg }: { fromDeg: number }) {
  return <ArrowDown className="ic wx-arrow" style={{ transform: `rotate(${Math.round(fromDeg)}deg)` }} aria-hidden="true" />;
}

/** Una fila sobre las tarjetas: día, hora y qué tiempo hará. */
export function WeatherRow({ weather }: { weather: RideWeather }) {
  const { status, hour, slot, days, hours } = weather;
  if (status === 'idle') return null;
  if (status === 'error') return <p className="help wx-quiet">Sin previsión ahora</p>;
  return (
    <div className="wx-row" role="group" aria-label="Tiempo para la salida">
      <div className="wx-pick">
        <label className="wx-label">
          <span>Día</span>
          <select className="wx-select" value={slot.date} onChange={(e) => weather.setSlot({ date: e.target.value, hour: slot.hour })}>
            {days.map((d) => (
              <option key={d.date} value={d.date}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wx-label">
          <span>Hora</span>
          <select className="wx-select" value={slot.hour} onChange={(e) => weather.setSlot({ date: slot.date, hour: Number(e.target.value) })}>
            {hours.map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="wx-now" aria-live="polite">
        {status === 'loading' ? (
          'Mirando el tiempo…'
        ) : hour ? (
          <>
            <span>{hour.tempC === null ? 'Sin temperatura' : `${formatCount(Math.round(hour.tempC))} °C`}</span>
            <span>{hour.rainPct === null ? 'Lluvia sin dato' : `Lluvia ${formatCount(Math.round(hour.rainPct))} %`}</span>
            <span className="wx-wind-now">
              <WindArrow fromDeg={hour.windFromDeg} />
              {`Viento ${formatCount(Math.round(hour.windKmh))} km/h del ${cardinal(hour.windFromDeg)}`}
              {hour.gustKmh !== null && hour.gustKmh >= hour.windKmh + 8 ? `, rachas de ${formatCount(Math.round(hour.gustKmh))}` : ''}
            </span>
          </>
        ) : (
          'Sin previsión para esa hora'
        )}
      </p>
    </div>
  );
}

const pct = (x: number) => `${formatCount(Math.round(x * 100))} %`;

/** Cómo pega el viento de esa hora en esta vuelta; nada si no hay previsión. */
export function WindLine({ points, weather }: { points: LatLng[]; weather?: HourForecast | null }) {
  const effect = useMemo(() => (weather ? windEffect(points, weather.windFromDeg, weather.windKmh) : null), [points, weather]);
  if (!effect) return null;
  return (
    <div className="wx-wind">
      <p className="wx-summary">
        <WindArrow fromDeg={effect.fromDeg} />
        {windSummary(effect)}
      </p>
      {effect.calm ? null : (
        <p className="wx-share">{`${pct(effect.share.head)} de cara · ${pct(effect.share.tail)} a favor · ${pct(effect.share.cross)} de lado`}</p>
      )}
    </div>
  );
}
