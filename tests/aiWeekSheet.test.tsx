import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WeekProposal } from '../src/ai/workoutPlanner';
import * as calendarRepo from '../src/calendar/calendarRepo';
import { listWorkouts } from '../src/calendar/calendarRepo';
import { db } from '../src/db/db';
import { AiWeekSheet } from '../src/ui/calendario/AiWeekSheet';

// Viernes 6 de noviembre de 2026: los próximos 7 días van del viernes 6 al jueves 12.
const TODAY = '2026-11-06';
const PROPOSAL: WeekProposal = {
  ok: true,
  motivo: 'Tu media es de 50 km y 600 m.',
  descartadas: 0,
  entrenos: [
    { dia: 1, titulo: 'Rodaje suave', distanciaKm: 35, desnivelM: 300, notas: 'Sin forzar.' },
    { dia: 3, titulo: 'Subidas', distanciaKm: 45, desnivelM: 690, notas: '' },
    { dia: 5, titulo: 'Salida larga', distanciaKm: 57.5, desnivelM: null, notas: 'Come cada hora.' },
  ],
};

function setup(propose: (req: { disponibles: number[]; notas: string; ocupados: number[] }, signal: AbortSignal) => Promise<WeekProposal>, busy: number[] = []) {
  const onAdded = vi.fn();
  const onClose = vi.fn();
  render(<AiWeekSheet open today={TODAY} busy={busy} propose={propose} onAdded={onAdded} onClose={onClose} />);
  return { onAdded, onClose, dialog: () => screen.getByRole('dialog', { name: 'Proponer semana con IA' }) };
}

describe('AiWeekSheet', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('propone, se desmarca uno y al añadir guarda N-1 entrenos de la IA', async () => {
    const user = userEvent.setup();
    const propose = vi.fn().mockResolvedValue(PROPOSAL);
    const { onAdded, dialog } = setup(propose, [0]);

    // El día ocupado (hoy) no se puede elegir; el lunes se desmarca.
    expect(within(dialog()).getByRole('button', { name: /viernes 6.*ya tiene entreno/i })).toBeDisabled();
    await user.click(within(dialog()).getByRole('button', { name: /^Lunes 9/ }));
    await user.type(within(dialog()).getByLabelText(/Notas/), 'El jueves voy justo');
    await user.click(within(dialog()).getByRole('button', { name: 'Proponer' }));

    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose.mock.calls[0][0]).toEqual({ disponibles: [1, 2, 4, 5, 6], ocupados: [0], notas: 'El jueves voy justo' });

    expect(await within(dialog()).findByText('Tu media es de 50 km y 600 m.')).toBeInTheDocument();
    const boxes = within(dialog()).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    boxes.forEach((b) => expect(b).toBeChecked());
    await user.click(within(dialog()).getByRole('checkbox', { name: /Subidas/ }));
    await user.click(within(dialog()).getByRole('button', { name: 'Añadir al calendario (2)' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    const saved = await listWorkouts();
    expect(saved.map((w) => [w.date, w.title, w.distanceM, w.elevGainM, w.notes, w.done, w.manual])).toEqual([
      ['2026-11-07', 'Rodaje suave', 35_000, 300, 'IA: Sin forzar.', false, false],
      ['2026-11-11', 'Salida larga', 57_500, undefined, 'IA: Come cada hora.', false, false],
    ]);
  });

  it('cancelar la espera no guarda nada aunque la IA conteste después', async () => {
    const user = userEvent.setup();
    let resolve!: (p: WeekProposal) => void;
    let signal!: AbortSignal;
    const propose = vi.fn((_req, s: AbortSignal) => {
      signal = s;
      return new Promise<WeekProposal>((r) => (resolve = r));
    });
    const { onAdded, dialog } = setup(propose);

    await user.click(within(dialog()).getByRole('button', { name: 'Proponer' }));
    expect(within(dialog()).getByRole('status')).toHaveTextContent(/Preparando/);
    await user.click(within(dialog()).getByRole('button', { name: 'Cancelar' }));
    expect(signal.aborted).toBe(true);
    resolve(PROPOSAL);

    expect(await within(dialog()).findByRole('button', { name: 'Proponer' })).toBeInTheDocument();
    expect(within(dialog()).queryByRole('checkbox')).toBeNull();
    expect(onAdded).not.toHaveBeenCalled();
    expect(await listWorkouts()).toEqual([]);
  });

  it('un error se explica, no guarda y deja volver a intentarlo', async () => {
    const user = userEvent.setup();
    const propose = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, cause: 'invalid_json', message: 'La IA no ha devuelto entrenos válidos.' })
      .mockResolvedValueOnce(PROPOSAL);
    const { dialog } = setup(propose);

    await user.click(within(dialog()).getByRole('button', { name: 'Proponer' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('La IA no ha devuelto entrenos válidos.');
    expect(await listWorkouts()).toEqual([]);
    await user.click(within(dialog()).getByRole('button', { name: 'Volver a intentarlo' }));
    expect(await within(dialog()).findByRole('button', { name: 'Añadir al calendario (3)' })).toBeInTheDocument();
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it('si guardar falla a medias, conserva lo que falta y reintenta sin volver a pedir a la IA', async () => {
    const user = userEvent.setup();
    const propose = vi.fn().mockResolvedValue(PROPOSAL);
    const real = calendarRepo.saveWorkout;
    const spy = vi.spyOn(calendarRepo, 'saveWorkout');
    spy.mockImplementationOnce(real).mockRejectedValueOnce(new Error('disco lleno'));
    const { onAdded, dialog } = setup(propose);

    await user.click(within(dialog()).getByRole('button', { name: 'Proponer' }));
    await user.click(await within(dialog()).findByRole('button', { name: 'Añadir al calendario (3)' }));

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(/guardar los que faltan/);
    expect(within(dialog()).getAllByRole('checkbox')).toHaveLength(2);
    expect(onAdded).not.toHaveBeenCalled();

    await user.click(within(dialog()).getByRole('button', { name: 'Añadir al calendario (2)' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onAdded.mock.calls[0][0]).toHaveLength(3);
    expect(propose).toHaveBeenCalledTimes(1);
    expect((await listWorkouts()).map((w) => w.title)).toEqual(['Rodaje suave', 'Subidas', 'Salida larga']);
    spy.mockRestore();
  });

  it('con los 7 días ocupados lo explica y no deja proponer', () => {
    const { dialog } = setup(vi.fn(), [0, 1, 2, 3, 4, 5, 6]);
    expect(within(dialog()).getByText(/Ya tienes entreno los 7 próximos días/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Proponer' })).toBeDisabled();
  });
});
