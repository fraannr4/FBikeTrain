import type { EventGoal, PlannedWorkout, VolumeGoal } from '../src/domain/types';
import type { VolumeProgress } from '../src/metrics/calendar';
import type { WeeklyTrend } from '../src/ui/inicio/trend';
import {
  dayMark,
  eventWhen,
  followUp,
  heroLead,
  pickGoals,
  pickUpcoming,
  shortName,
  volumeGlance,
  weekCaption,
  weekDeltas,
} from '../src/ui/inicio/inicioPlan';

// Viernes 6 de noviembre de 2026, 13:00 en Madrid.
const NOW = Date.parse('2026-11-06T12:00:00Z');

const ev = (id: string, date: string, extra: Partial<EventGoal> = {}): EventGoal => ({
  kind: 'event',
  id,
  title: `Marcha ${id}`,
  date,
  distanceM: 140_000,
  createdAt: 1,
  ...extra,
});
const vol = (id: string, period: 'week' | 'month', start: string, extra: Partial<VolumeGoal> = {}): VolumeGoal => ({
  kind: 'volume',
  id,
  title: id,
  period,
  start,
  distanceM: 800_000,
  createdAt: 1,
  ...extra,
});
const wo = (id: string, date: string, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({
  id,
  date,
  title: `Entreno ${id}`,
  done: false,
  manual: false,
  createdAt: 1,
  ...extra,
});

describe('pickGoals', () => {
  it('nearest event that has not passed', () => {
    const { event } = pickGoals([ev('lejos', '2027-03-14'), ev('pasado', '2026-11-01'), ev('cerca', '2026-12-13')], NOW);
    expect(event?.id).toBe('cerca');
  });

  it('an event today still counts', () => {
    expect(pickGoals([ev('hoy', '2026-11-06')], NOW).event?.id).toBe('hoy');
  });

  it('current volume goals only: one weekly and one monthly, the newest of each', () => {
    const { volume } = pickGoals(
      [
        vol('oct', 'month', '2026-10-01'),
        vol('dic', 'month', '2026-12-01'),
        vol('nov-viejo', 'month', '2026-11-01', { createdAt: 1 }),
        vol('nov', 'month', '2026-11-01', { createdAt: 5 }),
        vol('sem', 'week', '2026-11-02'),
        vol('sem-pasada', 'week', '2026-10-26'),
      ],
      NOW,
    );
    expect(volume.map((g) => g.id)).toEqual(['nov', 'sem']);
  });

  it('nothing current gives no goals', () => {
    expect(pickGoals([vol('oct', 'month', '2026-10-01'), ev('pasado', '2026-11-01')], NOW)).toEqual({
      event: null,
      volume: [],
    });
  });
});

describe('pickUpcoming', () => {
  it('pending workouts from today on, in date order', () => {
    const list = pickUpcoming(
      [wo('dom', '2026-11-08'), wo('ayer', '2026-11-05'), wo('hecho', '2026-11-07', { done: true }), wo('sab', '2026-11-07')],
      NOW,
    );
    expect(list.map((w) => w.id)).toEqual(['sab', 'dom']);
  });

  it('two at most', () => {
    const list = pickUpcoming([wo('a', '2026-11-07'), wo('b', '2026-11-08'), wo('c', '2026-11-09')], NOW);
    expect(list).toHaveLength(2);
  });
});

describe('dayMark', () => {
  it('tomorrow says mañana under the day', () => {
    expect(dayMark('2026-11-07', NOW)).toEqual({
      weekday: 'sáb',
      day: '7',
      under: 'mañana',
      spoken: 'Mañana, sábado 7 de noviembre',
      near: 'Mañana',
    });
  });

  it('today says hoy', () => {
    expect(dayMark('2026-11-06', NOW).under).toBe('hoy');
  });

  it('later days show the month', () => {
    expect(dayMark('2026-11-15', NOW)).toMatchObject({ weekday: 'dom', day: '15', under: 'nov', near: null });
    expect(dayMark('2026-11-15', NOW).spoken).toBe('Domingo 15 de noviembre');
  });
});

describe('followUp', () => {
  it('returns the parts so the title can be isolated', () => {
    expect(followUp(wo('d', '2026-11-08', { title: 'رحلة الدراجة', distanceM: 55_000 }), NOW)).toEqual({
      when: 'Y el domingo 8',
      title: 'رحلة الدراجة',
      km: ', 55 km',
    });
    expect(followUp(wo('s', '2026-11-07', { title: 'Rodaje' }), NOW)).toEqual({ when: 'Y mañana', title: 'Rodaje', km: '' });
  });
});

describe('eventWhen', () => {
  it('says the date and the days left', () => {
    expect(eventWhen(ev('m', '2026-12-13'), NOW)).toBe('13 de diciembre, faltan 37 días');
  });
  it('today and tomorrow', () => {
    expect(eventWhen(ev('m', '2026-11-06'), NOW)).toBe('Hoy, 6 de noviembre');
    expect(eventWhen(ev('m', '2026-11-07'), NOW)).toBe('Mañana, 7 de noviembre');
  });
});

const progress = (p: Partial<VolumeProgress> & Pick<VolumeProgress, 'targets'>): VolumeProgress => ({
  status: 'current',
  daysTotal: 30,
  daysLeft: 25,
  rides: 3,
  pct: p.targets[0].pct,
  expectedPct: 20,
  aheadPct: p.targets[0].pct - 20,
  ...p,
});

describe('volumeGlance', () => {
  it('monthly distance goal ahead of pace, in km', () => {
    const g = volumeGlance(
      vol('nov', 'month', '2026-11-01'),
      progress({
        daysLeft: 25,
        targets: [{ key: 'distanceM', target: 800_000, value: 201_000, pct: 25.125, expected: 160_000, aheadPct: 5.125 }],
      }),
    );
    expect(g).toMatchObject({
      title: 'Objetivo de noviembre',
      done: '201',
      of: 'de 800 km',
      dir: 'up',
      diff: '41 km',
      word: 'por delante del ritmo',
      left: 'Quedan 25 días',
    });
    expect(g.value).toBeCloseTo(0.251, 3);
    expect(g.pace).toBeCloseTo(0.2, 3);
    expect(g.label).toBe('El 25 % del objetivo. El ritmo esperado hoy es el 20 %: vas 41 km por delante del ritmo.');
  });

  it('weekly elevation goal behind pace', () => {
    const g = volumeGlance(
      vol('sem', 'week', '2026-11-02', { distanceM: undefined, elevGainM: 5_000 }),
      progress({
        daysLeft: 1,
        expectedPct: 60,
        targets: [{ key: 'elevGainM', target: 5_000, value: 2_000, pct: 40, expected: 3_000, aheadPct: -20 }],
      }),
    );
    expect(g).toMatchObject({
      title: 'Objetivo de la semana',
      done: '2000',
      of: 'de 5000 m',
      dir: 'down',
      diff: '1000 m',
      word: 'por detrás del ritmo',
      left: 'Hoy es el último día',
    });
  });

  it('within 1 % of the target is on pace', () => {
    const g = volumeGlance(
      vol('nov', 'month', '2026-11-01'),
      progress({
        targets: [{ key: 'distanceM', target: 800_000, value: 162_000, pct: 20.25, expected: 160_000, aheadPct: 0.25 }],
      }),
    );
    expect(g.dir).toBe('flat');
    expect(g.word).toBe('Vas justo al ritmo');
  });

  it('time goal in hours', () => {
    const g = volumeGlance(
      vol('nov', 'month', '2026-11-01', { distanceM: undefined, movingTimeS: 30 * 3600 }),
      progress({
        targets: [{ key: 'movingTimeS', target: 108_000, value: 22_080, pct: 20.4, expected: 21_600, aheadPct: 0.4 }],
      }),
    );
    expect(g.done).toBe('6 h 08');
    expect(g.of).toBe('de 30 h');
  });
});

describe('heroLead', () => {
  const next = wo('x', '2026-11-07', { title: 'Lluçanès por Prats' });
  it('tomorrow workout with its short name', () => {
    expect(heroLead(next, null, NOW)).toEqual({ lead: 'Mañana toca ', name: 'Lluçanès', tail: '.' });
  });
  it('adds the month pace', () => {
    expect(heroLead(next, { period: 'noviembre', word: 'por delante del ritmo' }, NOW)).toEqual({
      lead: 'Mañana toca ',
      name: 'Lluçanès',
      tail: ', y en noviembre vas por delante del ritmo.',
    });
  });
  it('only the pace when nothing is planned for today or tomorrow', () => {
    expect(heroLead(wo('y', '2026-11-12'), { period: 'noviembre', word: 'por detrás del ritmo' }, NOW)).toEqual({
      lead: 'En noviembre vas por detrás del ritmo.',
      name: '',
      tail: '',
    });
  });
  it('nothing to say gives null', () => {
    expect(heroLead(undefined, null, NOW)).toBeNull();
  });
});

describe('shortName', () => {
  it('cuts at « por » or a comma, 28 characters at most', () => {
    expect(shortName('Lluçanès por Prats')).toBe('Lluçanès');
    expect(shortName('Montseny, vuelta larga')).toBe('Montseny');
    expect(shortName('Vuelta interminable a todos los puertos del Ripollès')).toBe('Vuelta interminable a todos…');
  });
});

const trend = (dist: [number, number | null], speed: [number | null, number | null]): WeeklyTrend => ({
  labels: [],
  series: {
    dist: { metric: 'dist', values: [100, dist[0]], mean: 150, meanToDate: dist[1] },
    elev: { metric: 'elev', values: [1000, 1500], mean: 2000, meanToDate: 1000 },
    time: { metric: 'time', values: [3600, 7200], mean: 9000, meanToDate: null },
    speed: { metric: 'speed', values: [25, speed[0]], mean: speed[1], meanToDate: null },
  },
});

describe('weekDeltas', () => {
  it('sums against your weeks at this point, speed against your mean', () => {
    const d = weekDeltas(trend([125, 100], [26, 25]), 2);
    expect(d.dist).toBeCloseTo(25);
    expect(d.elev).toBeCloseTo(50);
    expect(d.time).toBeNull();
    expect(d.speed).toBeCloseTo(4);
  });
  it('no rides this week: no deltas', () => {
    expect(weekDeltas(trend([0, 100], [null, 25]), 0)).toEqual({ dist: null, elev: null, time: null, speed: null });
  });
});

describe('weekCaption', () => {
  it('counts the rides and says what it compares with', () => {
    expect(weekCaption(2, trend([125, 100], [26, 25]))).toBe('2 salidas esta semana, frente a tus semanas a estas alturas');
    expect(weekCaption(1, trend([125, 100], [26, 25]))).toBe('1 salida esta semana, frente a tus semanas a estas alturas');
  });
  it('without rides says what you usually have by now', () => {
    expect(weekCaption(0, trend([0, 35], [null, 25]))).toBe('Aún no has salido esta semana. A estas alturas sueles llevar 35 km.');
  });
  it('without a mean says why', () => {
    const t = trend([125, null], [26, null]);
    t.series.dist.mean = null;
    expect(weekCaption(2, t)).toBe('2 salidas esta semana. Aún no hay media: necesitas 3 semanas con salidas.');
  });
});
