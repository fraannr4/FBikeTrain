import { aiGoal } from '../src/ai/goalContext';
import type { EventGoal, Goal, StoredActivity, VolumeGoal } from '../src/domain/types';

// Viernes 6 de noviembre de 2026 a las 13:00 de Madrid.
const TODAY = '2026-11-06';
const NOW = Date.parse('2026-11-06T12:00:00Z');

let seq = 0;
const ride = (startTime: string, distanceM: number, elevGainM = 0): StoredActivity => ({
  id: `r${++seq}`, startTime: Date.parse(startTime), sport: 'cycling', hasTrack: false, source: 'gpx', importedAt: 0,
  totals: { distanceM, movingTimeS: 3600, elapsedTimeS: 3600, elevGainM, avgSpeedMs: 7, maxSpeedMs: 15 },
});
// Nombres con lugar a propósito: no deben salir nunca hacia la IA.
const event = (id: string, date: string, over: Partial<EventGoal> = {}): Goal =>
  ({ kind: 'event', id, title: 'Marcha de Mallorca', date, distanceM: 120_000, elevGainM: 1500, createdAt: 1, ...over });
const volume = (id: string, period: VolumeGoal['period'], start: string, over: Partial<VolumeGoal> = {}): Goal =>
  ({ kind: 'volume', id, title: 'Noviembre en Mallorca', period, start, distanceM: 400_000, createdAt: 1, ...over });

const eventIn5d = event('e5', '2026-11-11');
const eventIn20d = event('e20', '2026-11-26');
const pastEvent = event('e0', '2026-11-01');
const monthVolume400km = volume('vn', 'month', '2026-11-01');
const lastMonthVolume = volume('vo', 'month', '2026-10-01');
const weekVolume = volume('vw', 'week', '2026-11-02', { distanceM: 200_000, elevGainM: 3000 });
const acts = [ride('2026-11-03T08:00:00Z', 50_250, 500)];
const actsWith430km = [ride('2026-11-02T08:00:00Z', 150_000), ride('2026-11-03T08:00:00Z', 150_000), ride('2026-11-04T08:00:00Z', 130_000)];

describe('objetivo para la IA', () => {
  it('prefiere el evento futuro más próximo', () => {
    expect(aiGoal([monthVolume400km, eventIn20d, eventIn5d], acts, NOW, TODAY)).toEqual({ tipo: 'evento', diasHasta: 5, distanciaKm: 120, desnivelM: 1500 });
  });

  it('sin evento usa el volumen vigente con restantes no negativos', () => {
    expect(aiGoal([monthVolume400km], actsWith430km, NOW, TODAY)).toEqual({ tipo: 'volumen', diasRestantes: 25, distanciaRestanteKm: 0, desnivelRestanteM: null });
  });

  it('entre varios volúmenes vigentes elige el de menos días restantes, con km a 1 decimal y m enteros', () => {
    expect(aiGoal([monthVolume400km, weekVolume], acts, NOW, TODAY)).toEqual({ tipo: 'volumen', diasRestantes: 3, distanciaRestanteKm: 149.8, desnivelRestanteM: 2500 });
  });

  it('evento pasado y periodo terminado dan null', () => {
    expect(aiGoal([pastEvent, lastMonthVolume], acts, NOW, TODAY)).toBeNull();
    expect(aiGoal([], acts, NOW, TODAY)).toBeNull();
  });

  it('un evento a más de dos años no orienta la ruta: pasa al volumen', () => {
    expect(aiGoal([event('far', '2029-01-01'), monthVolume400km], actsWith430km, NOW, TODAY)).toMatchObject({ tipo: 'volumen' });
    expect(aiGoal([event('far', '2029-01-01')], acts, NOW, TODAY)).toBeNull();
  });

  it('no incluye nombre ni lugar', () => {
    for (const goals of [[eventIn5d], [monthVolume400km]]) {
      expect(JSON.stringify(aiGoal(goals, acts, NOW, TODAY))).not.toMatch(/Mallorca|title|id/);
    }
  });
});
