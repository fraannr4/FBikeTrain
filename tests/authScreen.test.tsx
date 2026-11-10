import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthScreen } from '../src/auth/AuthScreen';

function mockClient() {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}

describe('acceso a la cuenta', () => {
  it('envía credenciales sin almacenarlas en ajustes y muestra errores traducidos', async () => {
    const { client, auth } = mockClient();
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } });
    render(<AuthScreen client={client} />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'test@example.invalid');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'synthetic-password');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'test@example.invalid', password: 'synthetic-password' });
    expect(await screen.findByRole('alert')).toHaveTextContent('correo o la contraseña');
  });
  it('registra con callback en el documento y solicita confirmación por correo', async () => {
    const { client, auth } = mockClient();
    render(<AuthScreen client={client} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'test@example.invalid');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'synthetic-password');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: { emailRedirectTo: expect.not.stringContaining('#') } }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revisa tu correo');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
  });
  it('recupera sin confirmar si una dirección tiene cuenta', async () => {
    const { client, auth } = mockClient();
    render(<AuthScreen client={client} />);
    await userEvent.click(screen.getByRole('button', { name: '¿Has olvidado tu contraseña?' }));
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'test@example.invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('test@example.invalid', { redirectTo: expect.stringContaining('?auth=recovery') });
    expect(await screen.findByRole('status')).toHaveTextContent('Si existe una cuenta');
  });
  it('no ofrece acceso con Google', () => {
    const { client } = mockClient();
    render(<AuthScreen client={client} />);
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });
  it('solo termina la recuperación cuando updateUser tiene éxito', async () => {
    const { client, auth } = mockClient();
    const done = vi.fn();
    render(<AuthScreen client={client} recovery onRecovered={done} />);
    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'synthetic-password');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'synthetic-password' });
    expect(done).toHaveBeenCalledOnce();
  });
});
