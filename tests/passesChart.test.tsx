import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PassesChart, type PassItem } from '../src/ui/charts/PassesChart';

/** Una pasada al mes desde `from` (año, mes 0-11), `months` meses seguidos. */
function monthly(fromYear: number, fromMonth: number, months: number): PassItem[] {
  return Array.from({ length: months }, (_, i) => {
    const t = Date.UTC(fromYear, fromMonth + i, 10, 8);
    return { t, s: 600 + (i % 7) * 10, when: String(t), sub: '' };
  });
}

async function yearLabels(items: PassItem[]) {
  const { container } = render(<PassesChart items={items} label="Tus tiempos" />);
  await userEvent.click(screen.getByRole('button', { name: 'Todas, por meses' }));
  return Array.from(container.querySelectorAll('.xl text'), (t) => t.textContent);
}

describe('PassesChart, todas por meses', () => {
  it('marks every year when they fit, even if the first one starts late', async () => {
    // De noviembre de 2022 a noviembre de 2026: 2023 no puede faltar.
    expect(await yearLabels(monthly(2022, 10, 49))).toEqual(['2023', '2024', '2025', '2026']);
  });

  it('marks every other year at regular steps when they do not fit', async () => {
    // Seis años en 320 px: cada dos años, siempre los pares.
    expect(await yearLabels(monthly(2020, 0, 72))).toEqual(['2020', '2022', '2024']);
  });

  it('names the year when no January falls in range', async () => {
    // Cuarenta pasadas de febrero a noviembre de 2025.
    const items = Array.from({ length: 40 }, (_, i) => {
      const t = Date.UTC(2025, 1 + Math.floor(i / 4), 1 + (i % 4) * 5, 8);
      return { t, s: 600 + i, when: String(t), sub: '' };
    });
    expect(await yearLabels(items)).toEqual(['2025']);
  });
});
