import type { RiderThresholds, StoredActivity } from '../src/domain/types';
import { buildLevelSummary } from '../src/ai/levelSummary';
import { MIN_WEEKS_WITH_LOAD } from '../src/metrics/load';
import { referenceFromAnswers } from '../src/ai/levelSummary';
import {
  estimateNote,
  formSentence,
  loadGate,
  niceAxis,
  sensorPresence,
  warmupNote,
  weekSentence,
  weeklyRows,
} from '../src/ui/inicio/loadModel';

const NONE: RiderThresholds = { ftpW: null, maxHr: null, thresholdHr: null };
const act = (totals: Partial<StoredActivity['totals']>): StoredActivity => ({
  id: 'a', startTime: 1, sport: 'cycling', hasTrack: true, source: 'fit', importedAt: 1,
  totals: { distanceM: 1, movingTimeS: 1, elapsedTimeS: 1, elevGainM: 0, avgSpeedMs: 1, maxSpeedMs: 1, ...totals },
});

describe('carga y forma: qué se muestra', () => {
  it('sin pulso ni potencia en ninguna salida, estado vacío', () => {
    expect(loadGate(sensorPresence([act({}), act({ avgHr: 0 })]), { ftpW: 200, maxHr: 190, thresholdHr: null })).toEqual({ state: 'empty' });
    expect(loadGate(sensorPresence([]), NONE)).toEqual({ state: 'empty' });
  });

  it('con sensor pero sin el umbral que lo usa, pide el dato en lugar de pintar estimaciones', () => {
    expect(loadGate(sensorPresence([act({ avgPower: 180 })]), NONE)).toEqual({ state: 'needs-thresholds', missing: 'ftp' });
    expect(loadGate(sensorPresence([act({ avgHr: 140 })]), { ...NONE, ftpW: 200 })).toEqual({ state: 'needs-thresholds', missing: 'hr' });
    expect(loadGate(sensorPresence([act({ avgHr: 140, avgPower: 150 })]), NONE)).toEqual({ state: 'needs-thresholds', missing: 'both' });
  });

  it('listo con el umbral del sensor que hay, o del pulso de umbral', () => {
    expect(loadGate(sensorPresence([act({ avgPower: 180 })]), { ...NONE, ftpW: 200 })).toEqual({ state: 'ready' });
    expect(loadGate(sensorPresence([act({ avgHr: 140 })]), { ...NONE, thresholdHr: 165 })).toEqual({ state: 'ready' });
    expect(loadGate(sensorPresence([act({ avgHr: 140, avgPower: 150 })]), { ...NONE, maxHr: 190 })).toEqual({ state: 'ready' });
  });
});

describe('carga y forma: textos', () => {
  it('sin carga habitual lo dice y nombra lo que falta, sin porcentaje', () => {
    const s = weekSentence({ current: 40, usual: null, weeksUsed: 0, pctOfUsual: null });
    expect(s).toContain(String(MIN_WEEKS_WITH_LOAD));
    expect(s).not.toMatch(/%|NaN/);
  });
  it('con habitual, el porcentaje y la cifra', () => {
    expect(weekSentence({ current: 50, usual: 100, weeksUsed: 8, pctOfUsual: 50 })).toBe('Llevas el 50 % de tu carga semanal habitual (100).');
  });
  it('la forma se describe por su signo', () => {
    expect(formSentence(9)).toMatch(/\+9.*descansado/);
    expect(formSentence(-9)).toMatch(/−9.*cansancio/);
    expect(formSentence(0.2)).toMatch(/Forma 0/);
  });
  it('avisa de las estimaciones y de las medias solo si las hay', () => {
    expect(estimateNote([{ startTime: 1, tss: 1, source: 'power' }])).toBeNull();
    const n = estimateNote([
      { startTime: 1, tss: 1, source: 'estimate' },
      { startTime: 2, tss: 1, source: 'hr-avg' },
      { startTime: 3, tss: 1, source: 'power' },
    ])!;
    expect(n).toMatch(/1 de 3 salidas/);
    expect(n).toMatch(/media de la salida/);
  });
  it('avisa del arranque de la fitness con poco historial', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(warmupNote(now - 10 * 86_400_000, now)).toMatch(/fitness/);
    expect(warmupNote(now - 100 * 86_400_000, now)).toBeNull();
    expect(warmupNote(undefined, now)).toBeNull();
  });
});

describe('carga y forma: gráfica y tabla', () => {
  it('el eje llega a un máximo redondo que contiene los datos, desde 0', () => {
    for (const max of [0, 3, 37, 120, 480]) {
      const a = niceAxis(max);
      expect(a.ticks[0]).toBe(0);
      expect(a.hi).toBeGreaterThanOrEqual(max);
      expect(a.ticks.at(-1)).toBe(a.hi);
      expect(a.ticks.length).toBeLessThanOrEqual(6);
    }
  });
  it('la tabla agrupa de 7 en 7 días hacia atrás desde hoy y suma la carga del bloque', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, '0')}`, load: 10, fitness: i, fatigue: i, form: 0 }));
    const rows = weeklyRows(days);
    expect(rows).toHaveLength(2);
    expect(rows[0].load).toBe(70);
    expect(rows[0].fitness).toBe(13);
    expect(rows[1].fitness).toBe(6);
  });
});

describe('resumen para la IA con FTP', () => {
  const ref = referenceFromAnswers({ kmPorSalida: 50, desnivelPorSalidaM: 500, velocidadMediaKmh: 25 });
  it('con FTP conocido lo lleva, redondeado', () => {
    expect(buildLevelSummary(ref, [], 238.6).ftpW).toBe(239);
  });
  it('sin FTP, o con uno no válido, la clave no existe', () => {
    for (const ftp of [undefined, null, 0, -5]) expect('ftpW' in buildLevelSummary(ref, [], ftp)).toBe(false);
  });
});
