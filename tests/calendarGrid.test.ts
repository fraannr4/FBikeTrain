import { monthGrid } from '../src/ui/calendarGrid';

describe('monthGrid', () => {
  it('november 2026 starts on monday 26 oct', () => {
    const weeks = monthGrid('2026-11');
    expect(weeks).toHaveLength(6);
    expect(weeks[0][0]).toBe('2026-10-26');
    expect(weeks[5][6]).toBe('2026-12-06');
  });

  it('october 2026 has 25 oct once', () => {
    // El 25 de octubre de 2026 cambia la hora en Madrid: el día dura 25 h.
    const weeks = monthGrid('2026-10');
    const days = weeks.flat();
    expect(days.filter((d) => d === '2026-10-25')).toHaveLength(1);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(new Set(days).size).toBe(days.length);
  });

  it('february 2027 is exactly 4 weeks', () => {
    const weeks = monthGrid('2027-02');
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe('2027-02-01');
    expect(weeks[3][6]).toBe('2027-02-28');
  });
});
