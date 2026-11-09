import {
  daysAgoLabel,
  formatClimb,
  formatClock,
  formatCount,
  formatDeltaPct,
  formatDuration,
  formatKm,
  formatMeters,
  formatNumber,
  formatSpeed,
  formatVam,
} from '../src/ui/format';

describe('daysAgoLabel', () => {
  it('says hoy, ayer or hace N días, with thousands only from 10.000', () => {
    expect(daysAgoLabel(0)).toBe('hoy');
    expect(daysAgoLabel(1)).toBe('ayer');
    expect(daysAgoLabel(9)).toBe('hace 9 días');
    expect(daysAgoLabel(1000)).toBe('hace 1000 días');
    expect(daysAgoLabel(12000)).toBe('hace 12.000 días');
  });
});

describe('formatNumber (FBT.fmt)', () => {
  it('groups thousands only from 10.000', () => {
    expect(formatNumber(1542)).toBe('1542');
    expect(formatNumber(9999)).toBe('9999');
    expect(formatNumber(10000)).toBe('10.000');
    expect(formatNumber(13120)).toBe('13.120');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('uses a decimal comma and the typographic minus', () => {
    expect(formatNumber(87.64, 1)).toBe('87,6');
    expect(formatNumber(13120.46, 1)).toBe('13.120,5');
    expect(formatNumber(-4)).toBe('−4');
    expect(formatNumber(-0.04, 1)).toBe('0,0');
  });

  it('never prints NaN or Infinity', () => {
    expect(formatNumber(Number.NaN)).toBe('–');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('–');
  });
});

describe('formatCount, formatKm, formatMeters, formatSpeed', () => {
  it('follow the same grouping rule', () => {
    expect(formatCount(214)).toBe('214');
    expect(formatCount(1240)).toBe('1240');
    expect(formatCount(13120)).toBe('13.120');
    expect(formatKm(87_640, 1)).toBe('87,6 km');
    expect(formatKm(13_120_000)).toBe('13.120 km');
    expect(formatMeters(1542)).toBe('1542 m');
    expect(formatMeters(11_443)).toBe('11.443 m');
    expect(formatSpeed(27.4 / 3.6)).toBe('27,4 km/h');
  });
});

describe('formatDuration (FBT.dur hm)', () => {
  it('short style: «3 h 12», minutes padded, «48 min» under an hour', () => {
    expect(formatDuration(3 * 3600 + 12 * 60, 'short')).toBe('3 h 12');
    expect(formatDuration(6 * 3600 + 8 * 60, 'short')).toBe('6 h 08');
    expect(formatDuration(48 * 60, 'short')).toBe('48 min');
    expect(formatDuration(3 * 3600, 'short')).toBe('3 h 00');
  });

  it('long style (default): «6 h 08 min», «3 h» on the hour', () => {
    expect(formatDuration(6 * 3600 + 8 * 60)).toBe('6 h 08 min');
    expect(formatDuration(3 * 3600 + 42 * 60)).toBe('3 h 42 min');
    expect(formatDuration(3 * 3600)).toBe('3 h');
    expect(formatDuration(42 * 60)).toBe('42 min');
  });

  it('rounds to the nearest minute, carrying into the hour', () => {
    expect(formatDuration(3599, 'short')).toBe('1 h 00');
    expect(formatDuration(89, 'short')).toBe('1 min');
    expect(formatDuration(29, 'short')).toBe('0 min');
  });
});

describe('formatClock (FBT.dur clock)', () => {
  it('writes m:ss or h:mm:ss', () => {
    expect(formatClock(24 * 60 + 14)).toBe('24:14');
    expect(formatClock(3735)).toBe('1:02:15');
    expect(formatClock(59.6)).toBe('1:00');
  });
});

describe('formatDeltaPct', () => {
  it('keeps sign and typographic minus', () => {
    expect(formatDeltaPct(25.4)).toBe('+25 %');
    expect(formatDeltaPct(-4)).toBe('−4 %');
    expect(formatDeltaPct(0.2)).toBe('0 %');
    expect(formatDeltaPct(1250)).toBe('+1250 %');
  });
});

describe('formatClimb y formatVam', () => {
  it('writes a climb as length and grade', () => {
    expect(formatClimb(2000, 5)).toBe('2,0 km al 5,0 %');
  });

  it('writes VAM in m/h with the thousands point from 10.000', () => {
    expect(formatVam(712.4)).toBe('712 m/h');
    // El prototipo manda: punto de miles a partir de 10.000 (README, «Cifras dorsal»).
    expect(formatVam(1240)).toBe('1240 m/h');
  });
});
