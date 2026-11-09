import type { StoredActivity } from '../src/domain/types';
import {
  trendAriaLabel,
  trendCaption,
  trendReadout,
  trendScale,
  trendTable,
  weeklyTrend,
  type ReadPart,
} from '../src/ui/inicio/trend';

// Viernes 6 de noviembre de 2026, 13:00 en Madrid. La semana en curso empieza el lunes 2.
const NOW = Date.parse('2026-11-06T12:00:00Z');
// Lunes de las 11 semanas completas, del 17 de agosto al 26 de octubre.
const MONDAYS = ['08-17', '08-24', '08-31', '09-07', '09-14', '09-21', '09-28', '10-05', '10-12', '10-19', '10-26'];

function ride(iso: string, km: number, elevM = 0, timeS = km * 150): StoredActivity {
  const startTime = Date.parse(iso);
  return {
    id: `r-${startTime}`,
    startTime,
    sport: 'cycling',
    totals: {
      distanceM: km * 1000,
      movingTimeS: timeS,
      elapsedTimeS: timeS,
      elevGainM: elevM,
      avgSpeedMs: 0,
      maxSpeedMs: 0,
    },
    hasTrack: false,
    source: 'fit',
    importedAt: NOW,
  };
}

/** Martes de la semana `k` (0 = 17 de agosto) a las 8:00 UTC. */
const tuesday = (k: number) => {
  const d = new Date(`2026-${MONDAYS[k]}T08:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
};
/** Sábado de la semana `k`. */
const saturday = (k: number) => {
  const d = new Date(`2026-${MONDAYS[k]}T08:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 5);
  return d.toISOString();
};

const text = (parts: ReadPart[]) => parts.map((p) => ('t' in p ? p.t : '')).join('');

// 100 km cada semana completa (40 el martes y 60 el sábado) y 50 km esta semana, el martes 3.
const steady = [
  ...MONDAYS.flatMap((_, k) => [ride(tuesday(k), 40, 400, 6_000), ride(saturday(k), 60, 600, 9_000)]),
  ride('2026-11-03T08:00:00Z', 50, 300, 7_200),
];

describe('weeklyTrend', () => {
  it('covers the 11 complete weeks and the current one', () => {
    const t = weeklyTrend([ride('2026-08-16T08:00:00Z', 70), ...steady], NOW);
    expect(t.labels).toHaveLength(12);
    expect(t.labels[0]).toBe('17 ago');
    expect(t.labels[11]).toBe('2 nov');
    // La salida del domingo 16 de agosto queda fuera de las 12 semanas.
    expect(t.series.dist.values[0]).toBe(100);
  });

  it('mean is that of the 11 complete weeks', () => {
    const { dist, elev, time } = weeklyTrend(steady, NOW).series;
    expect(dist.values[11]).toBe(50);
    expect(dist.mean).toBe(100);
    expect(elev.mean).toBe(1000);
    expect(time.mean).toBe(15_000);
  });

  it('a estas alturas counts each past week up to the same moment', () => {
    // Hoy es viernes: de cada semana completa cuenta el martes, no el sábado.
    const { dist, speed } = weeklyTrend(steady, NOW).series;
    expect(dist.meanToDate).toBe(40);
    expect(speed.meanToDate).toBeNull();
  });

  it('no mean with fewer than 3 weeks with rides', () => {
    const t = weeklyTrend([ride(tuesday(3), 80), ride(tuesday(9), 60), ride('2026-11-03T08:00:00Z', 50)], NOW);
    expect(t.series.dist.mean).toBeNull();
    expect(t.series.dist.meanToDate).toBeNull();
    expect(t.series.speed.mean).toBeNull();
  });

  it('speed of a week without rides is null and its mean weights by time', () => {
    const acts = [ride(tuesday(0), 30, 0, 3_600), ride(tuesday(1), 60, 0, 7_200), ride(tuesday(2), 25, 0, 3_600)];
    const { speed, dist } = weeklyTrend(acts, NOW).series;
    expect(speed.values[0]).toBeCloseTo(30);
    expect(speed.values[5]).toBeNull();
    expect(speed.values[11]).toBeNull();
    expect(dist.values[5]).toBe(0);
    // 115 km en 4 h: 28,75 km/h, no la media de las tres semanas (28,3).
    expect(speed.mean).toBeCloseTo(28.75);
  });
});

describe('trendReadout', () => {
  const t = weeklyTrend(steady, NOW);

  it('past week compares with your mean', () => {
    const acts = steady.filter((a) => a.startTime !== Date.parse(saturday(4)));
    const s = weeklyTrend(acts, NOW).series.dist;
    // La semana del 14 de septiembre se queda en 40 km; la media baja a 94,5.
    expect(text(trendReadout(s, 4, t.labels))).toBe('Semana del 14 sep: 40 km, un 58 % menos que tu media.');
  });

  it('a week like your mean says so', () => {
    expect(text(trendReadout(t.series.dist, 4, t.labels))).toBe('Semana del 14 sep: 100 km, igual que tu media.');
  });

  it('current week uses what you usually have by now', () => {
    const parts = trendReadout(t.series.dist, 11, t.labels);
    expect(text(parts)).toBe(
      'Esta semana, en curso: 50 km. A estas alturas sueles llevar 40 km; la semana completa, 100 km.',
    );
    expect(parts).toContainEqual({ key: true });
    expect(parts).toContainEqual({ t: 'Esta semana', b: true });
  });

  it('current week without rides says what you usually have by now', () => {
    const s = weeklyTrend(steady.slice(0, -1), NOW).series.dist;
    expect(text(trendReadout(s, 11, t.labels))).toBe('Esta semana, en curso: aún sin salidas. A estas alturas sueles llevar 40 km.');
  });

  it('empty past week', () => {
    const acts = steady.filter((a) => a.startTime !== Date.parse(saturday(3)) && a.startTime !== Date.parse(tuesday(3)));
    const s = weeklyTrend(acts, NOW).series.dist;
    expect(text(trendReadout(s, 3, t.labels))).toBe('Semana del 7 sep: sin salidas.');
  });

  it('without mean asks for 3 weeks with rides', () => {
    const s = weeklyTrend([ride('2026-11-03T08:00:00Z', 50)], NOW).series.dist;
    expect(text(trendReadout(s, 11, t.labels))).toBe(
      'Esta semana, en curso: 50 km. Aún no hay media: necesitas 3 semanas con salidas.',
    );
  });

  it('speed this week compares with the mean and names it', () => {
    // 50 km en 2 h esta semana (25 km/h) frente a 24 km/h de media.
    expect(text(trendReadout(t.series.speed, 11, t.labels))).toBe(
      'Esta semana, en curso: 25,0 km/h, un 4 % más que tu media de 24,0 km/h.',
    );
  });

  it('time reads in hours and minutes', () => {
    expect(text(trendReadout(t.series.time, 0, t.labels))).toBe('Semana del 17 ago: 4 h 10 min, igual que tu media.');
  });
});

describe('trend texts', () => {
  const t = weeklyTrend(steady, NOW);

  it('aria label sums up the chart', () => {
    expect(trendAriaLabel(t.series.dist)).toBe(
      'Distancia por semana en las últimas 12 semanas: entre 50 km y 100 km. Tu media, 100 km. ' +
        'Esta semana, aún en curso, 50 km; a estas alturas sueles llevar 40 km. Los datos están en la tabla.',
    );
  });

  it('aria label without any ride says so', () => {
    const empty = weeklyTrend([ride('2025-01-07T08:00:00Z', 50)], NOW);
    expect(trendAriaLabel(empty.series.speed)).toBe(
      'Velocidad media por semana en las últimas 12 semanas: sin salidas. Aún no hay media: necesitas 3 semanas con salidas.',
    );
  });

  it('caption explains the mean', () => {
    expect(trendCaption(t.series.elev)).toBe(
      'Desnivel por semana, de lunes a domingo. La media es la de las 11 semanas completas: 1000 m. ' +
        'La semana en curso se compara con tus semanas a estas alturas: 400 m.',
    );
  });

  it('table lists the newest week first with its difference', () => {
    const rows = trendTable(t.series.dist, t.labels);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ week: '2 nov (en curso)', value: '50 km', diff: '+25 %', note: 'a estas alturas: 40 km', now: true });
    expect(rows[11]).toEqual({ week: '17 ago', value: '100 km', diff: '0 %', note: null, now: false });
  });
});

describe('trendScale', () => {
  it('bars start at 0 with at most 4 steps and room above the tallest', () => {
    const s = trendScale([178, 152, 215, 196, 104, 241, 186, 208, 222, 164, 235, 160], 191, 'dist');
    expect(s.lo).toBe(0);
    expect(s.ticks).toEqual([0, 100, 200, 300]);
  });

  it('time ticks are whole hours', () => {
    const s = trendScale([23_700, 33_240, 20_400], 25_440, 'time');
    expect(s.ticks.every((v) => v % 3600 === 0)).toBe(true);
    expect(s.ticks.length).toBeLessThanOrEqual(5);
  });

  it('speed does not start at 0 and spans at least 2 km/h', () => {
    const s = trendScale([27.0, 26.8, 27.1], 27, 'speed');
    expect(s.lo).toBeGreaterThan(20);
    expect(s.hi - s.lo).toBeGreaterThanOrEqual(2);
  });

  it('no data still gives a usable axis', () => {
    expect(trendScale([null, null], null, 'speed').ticks.length).toBeGreaterThan(1);
    expect(trendScale([0, 0], null, 'dist').hi).toBeGreaterThan(0);
  });
});
