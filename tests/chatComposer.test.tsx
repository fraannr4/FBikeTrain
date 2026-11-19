import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../src/ui/chat/Composer';

const finePointer = (fine: boolean) => {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    matches: fine && query.includes('pointer: fine'), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
};

describe('campo de texto del chat', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enviar está apagado con el campo vacío o solo con espacios', () => {
    render(<Composer onSend={vi.fn()} />);
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensaje' }), { target: { value: '   \n ' } });
    expect(send).toBeDisabled();
  });

  it('envía el texto, vacía el campo y un segundo toque no vuelve a enviar', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Mensaje' });
    fireEvent.change(box, { target: { value: 'Hola' } });
    const send = screen.getByRole('button', { name: 'Enviar' });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hola');
    expect(box).toHaveValue('');
  });

  it('el contador aparece al pasar de 1800 caracteres y el texto se queda en 2000', () => {
    render(<Composer onSend={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Mensaje' });
    fireEvent.change(box, { target: { value: 'a'.repeat(1800) } });
    expect(screen.queryByText(/\/2000$/)).toBeNull();
    fireEvent.change(box, { target: { value: 'a'.repeat(1801) } });
    expect(screen.getByText('1801/2000')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'a'.repeat(2050) } });
    expect(box).toHaveValue('a'.repeat(2000));
  });

  it('en escritorio Intro envía y Mayús+Intro salta de línea', () => {
    finePointer(true);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Mensaje' });
    fireEvent.change(box, { target: { value: 'Línea' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Línea');
  });

  it('en táctil Intro salta de línea', () => {
    finePointer(false);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Mensaje' });
    fireEvent.change(box, { target: { value: 'Línea' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('tras enviar, el foco vuelve al campo: el teclado del móvil no se cierra', async () => {
    render(<Composer onSend={vi.fn()} />);
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Mensaje' });
    await user.type(box, 'Hola');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(box).toHaveFocus();
  });
});
