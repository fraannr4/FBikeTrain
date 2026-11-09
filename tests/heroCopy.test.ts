import type { PeriodTotals } from '../src/metrics/aggregate';
import { heroDate, heroSentence } from '../src/ui/inicio/heroCopy';

// Viernes 6 de noviembre de 2026, 13:00 en Madrid (los mismos datos que inicio.test).
const NOW = Date.parse('2026-11-06T12:00:00Z');

const week = (over: Partial<PeriodTotals> = {}): PeriodTotals => ({
  start: Date.parse('2026-11-01T23:00:00Z'),
  label: '2 nov',
  distanceM: 88_000,
  elevGainM: 1_240,
  movingTimeS: 13_320,
  rides: 2,
  avgSpeedMs: 88_000 / 13_320,
  ...over,
});

describe('heroCopy', () => {
  it('heroDate', () => {
    expect(heroDate(NOW)).toBe('Viernes 6 de noviembre');
  });

  it('below the average', () => {
    expect(heroSentence(week(), -8)).toEqual({
      lead: 'Llevas ',
      figure: '88 km',
      tail: ' esta semana, un 8 % menos que tu media.',
    });
  });

  it('above the average', () => {
    expect(heroSentence(week(), 5).tail).toBe(' esta semana, un 5 % más que tu media.');
  });

  it('same as the average', () => {
    expect(heroSentence(week(), 0).tail).toBe(' esta semana, lo mismo que tu media.');
    expect(heroSentence(week(), 0.4).tail).toBe(' esta semana, lo mismo que tu media.');
  });

  it('without a reference', () => {
    expect(heroSentence(week(), null).tail).toBe(' esta semana.');
  });

  it('no rides this week', () => {
    expect(heroSentence(week({ distanceM: 0, elevGainM: 0, movingTimeS: 0, rides: 0, avgSpeedMs: 0 }), -100)).toEqual({
      lead: 'Esta semana aún no has salido.',
      figure: '',
      tail: '',
    });
  });

  it('big deltas use es-ES grouping', () => {
    expect(heroSentence(week(), 1_250).tail).toBe(' esta semana, un 1250 % más que tu media.');
  });
});
