import type { ClimbEffort, StoredActivity } from '../src/domain/types';
import { climbName, rideDayLabel } from '../src/ui/climbView';

const rep = { startDistM: 12_300 } as ClimbEffort;
const ride = (name?: string) => ({ id: 'r1', name }) as StoredActivity;

describe('climbName', () => {
  it('isolates the ride name so the quotes stay put with right-to-left text', () => {
    expect(climbName(rep, ride('رحلة الجبل'))).toBe('Subida del km 12 de «⁨رحلة الجبل⁩»');
  });

  it('names a ride without name', () => {
    expect(climbName(rep, ride('  '))).toBe('Subida del km 12 de «⁨Salida sin nombre⁩»');
  });
});

describe('rideDayLabel', () => {
  // Viernes 6 de noviembre de 2026, 13:00 en Madrid.
  const NOW = Date.parse('2026-11-06T12:00:00Z');

  it('says Hoy and Ayer with the weekday and the date', () => {
    expect(rideDayLabel(Date.parse('2026-11-06T07:00:00Z'), NOW)).toBe('Hoy, viernes 6 de noviembre');
    expect(rideDayLabel(Date.parse('2026-11-05T08:00:00Z'), NOW)).toBe('Ayer, jueves 5 de noviembre');
  });

  it('writes other days in full, with the year only when it is not this one', () => {
    expect(rideDayLabel(Date.parse('2026-10-29T08:00:00Z'), NOW)).toBe('Jueves 29 de octubre');
    expect(rideDayLabel(Date.parse('2025-10-30T08:00:00Z'), NOW)).toBe('Jueves 30 de octubre de 2025');
  });
});
