import { TZDate } from '@date-fns/tz';
import {
  ATL_DAYS,
  CTL_DAYS,
  loadSeries,
  MIN_WEEKS_WITH_LOAD,
  weekLoadVsUsual,
} from '../src/metrics/load';
import { LONG_WINDOW_WEEKS, SHORT_WINDOW_WEEKS } from '../src/metrics/reference';

const TZ = 'Europe/Madrid';
const at = (y: number, m: number, d: number, h = 12, min = 0) => new TZDate(y, m - 1, d, h, min, TZ).getTime();

describe('fitness, fatiga y forma (Coggan: medias exponenciales de 42 y 7 días)', () => {
  it('sin salidas no hay serie', () => {
    expect(loadSeries([], at(2026, 11, 12))).toEqual([]);
    expect(loadSeries([{ startTime: at(2026, 11, 20), tss: 80 }], at(2026, 11, 12))).toEqual([]);
  });

  it('el primer día aplica 1/42 y 1/7; la forma de un día es la fitness menos la fatiga del anterior', () => {
    const s = loadSeries([{ startTime: at(2026, 11, 9), tss: 100 }], at(2026, 11, 11));
    expect(s.map((d) => d.day)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(s[0].fitness).toBeCloseTo(100 / CTL_DAYS, 9);
    expect(s[0].fatigue).toBeCloseTo(100 / ATL_DAYS, 9);
    expect(s[0].form).toBe(0);
    expect(s[1].load).toBe(0);
    expect(s[1].fitness).toBeCloseTo((100 / CTL_DAYS) * (1 - 1 / CTL_DAYS), 9);
    expect(s[1].form).toBeCloseTo(s[0].fitness - s[0].fatigue, 9);
  });

  it('suma las salidas del mismo día de Madrid y rellena los días de descanso con 0', () => {
    const s = loadSeries(
      [
        { startTime: at(2026, 11, 9, 8), tss: 40 },
        { startTime: at(2026, 11, 9, 18), tss: 60 },
        { startTime: at(2026, 11, 12), tss: 50 },
      ],
      at(2026, 11, 12, 20),
    );
    expect(s.map((d) => d.load)).toEqual([100, 0, 0, 50]);
  });

  it('el domingo a las 23:30 de Madrid es de ese domingo', () => {
    const s = loadSeries([{ startTime: at(2026, 11, 8, 23, 30), tss: 70 }], at(2026, 11, 9));
    expect(s.map((d) => [d.day, d.load])).toEqual([
      ['2026-11-08', 70],
      ['2026-11-09', 0],
    ]);
  });

  it('con el cambio de hora de octubre (día de 25 h) no se pierde ni se duplica ningún día', () => {
    const s = loadSeries(
      [
        { startTime: at(2026, 10, 24), tss: 50 },
        { startTime: at(2026, 10, 26), tss: 50 },
      ],
      at(2026, 10, 26, 20),
    );
    expect(s.map((d) => d.day)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('converge a la carga diaria constante', () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({ startTime: at(2026, 1, 1 + i), tss: 80 }));
    const s = loadSeries(entries, entries[299].startTime);
    // Forma cerrada de la media exponencial tras 300 días de carga constante.
    expect(s.at(-1)!.fitness).toBeCloseTo(80 * (1 - (1 - 1 / CTL_DAYS) ** 300), 6);
    expect(s.at(-1)!.fatigue).toBeCloseTo(80 * (1 - (1 - 1 / ATL_DAYS) ** 300), 6);
    expect(s.at(-1)!.fitness).toBeGreaterThan(79.9);
  });
});

describe('carga de la semana frente a la habitual', () => {
  const NOW = at(2026, 11, 12); // jueves; la semana en curso empieza el lunes 9
  const weeksBack = (n: number) => at(2026, 11, 10 - 7 * n); // el martes de hace n semanas

  it('compara con la media de las semanas anteriores de la ventana corta, contando las vacías', () => {
    const entries = Array.from({ length: SHORT_WINDOW_WEEKS }, (_, i) => ({ startTime: weeksBack(i + 1), tss: 100 }));
    entries.push({ startTime: at(2026, 11, 10), tss: 50 });
    const w = weekLoadVsUsual(entries, NOW);
    expect(w.current).toBe(50);
    expect(w.usual).toBeCloseTo(100, 9);
    expect(w.weeksUsed).toBe(SHORT_WINDOW_WEEKS);
    expect(w.pctOfUsual).toBeCloseTo(50, 9);
  });

  it('con un historial más corto que la ventana, promedia solo las semanas que existen', () => {
    const entries = [1, 2, 3, 4].map((n) => ({ startTime: weeksBack(n), tss: 80 }));
    const w = weekLoadVsUsual(entries, NOW);
    expect(w.weeksUsed).toBe(4);
    expect(w.usual).toBeCloseTo(80, 9);
  });

  it('sin MIN_WEEKS_WITH_LOAD semanas con carga no hay habitual: null, no 0 ni NaN', () => {
    const entries = Array.from({ length: MIN_WEEKS_WITH_LOAD - 1 }, (_, i) => ({ startTime: weeksBack(i + 1), tss: 80 }));
    entries.push({ startTime: at(2026, 11, 10), tss: 60 });
    const w = weekLoadVsUsual(entries, NOW);
    expect(w.usual).toBeNull();
    expect(w.pctOfUsual).toBeNull();
    expect(w.current).toBe(60);
  });

  it('una sola salida: habitual null', () => {
    const w = weekLoadVsUsual([{ startTime: at(2026, 11, 10), tss: 60 }], NOW);
    expect(w).toMatchObject({ current: 60, usual: null, pctOfUsual: null });
  });

  it('semana vacía: carga 0 y, con historial, 0 % de lo habitual', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ startTime: weeksBack(i + 1), tss: 100 }));
    const w = weekLoadVsUsual(entries, NOW);
    expect(w.current).toBe(0);
    expect(w.pctOfUsual).toBe(0);
  });

  it('el domingo 23:30 cuenta en la semana que acaba y el lunes 00:10 en la nueva', () => {
    const entries = [
      { startTime: at(2026, 11, 8, 23, 30), tss: 70 },
      { startTime: at(2026, 11, 9, 0, 10), tss: 30 },
    ];
    expect(weekLoadVsUsual(entries, NOW).current).toBe(30);
  });

  it('amplía a la ventana larga si en las 8 semanas no hay semanas con carga suficientes', () => {
    const entries = [9, 10, 11, 12].map((n) => ({ startTime: weeksBack(n), tss: 90 }));
    const w = weekLoadVsUsual(entries, NOW);
    expect(w.weeksUsed).toBe(LONG_WINDOW_WEEKS);
    expect(w.usual).toBeCloseTo((4 * 90) / LONG_WINDOW_WEEKS, 9);
  });
});
