import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { avatarBlob } from '../src/social/avatar';
import { ProfileAvatar } from '../src/ui/profile/ProfileAvatar';

vi.mock('../src/social/avatar', () => ({ avatarBlob: vi.fn() }));
const client = {} as SupabaseClient;
const originalUrl = URL;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends originalUrl {
    static createObjectURL = vi.fn(() => 'blob:synthetic-avatar');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('muestra monograma cuando no hay foto y cuando falla la descarga', async () => {
  vi.mocked(avatarBlob).mockResolvedValue(null);
  const { rerender } = render(<ProfileAvatar client={client} userId="u1" name="Ana Ruta" />);
  expect(screen.getByText('A')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  vi.mocked(avatarBlob).mockRejectedValue(new Error('offline'));
  rerender(<ProfileAvatar client={client} userId="u1" name="Ana Ruta" version={1} />);
  await waitFor(() => expect(avatarBlob).toHaveBeenLastCalledWith(client, 'u1', 1));
  expect(screen.getByText('A')).toBeInTheDocument();
});

it('revoca las URLs al cambiar de identidad y al desmontar', async () => {
  vi.mocked(avatarBlob).mockResolvedValue(new Blob(['photo'], { type: 'image/webp' }));
  const { rerender, unmount } = render(<ProfileAvatar client={client} userId="u1" name="Ana Ruta" version={1} size="large" />);
  expect(await screen.findByRole('img', { name: 'Foto de Ana Ruta' })).toHaveAttribute('src', 'blob:synthetic-avatar');
  rerender(<ProfileAvatar client={client} userId="u2" name="Bea Puerto" version={2} />);
  expect(await screen.findByRole('img', { name: 'Foto de Bea Puerto' })).toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('no crea URLs si la descarga termina después de desmontar', async () => {
  let finish: (value: Blob) => void = () => {};
  vi.mocked(avatarBlob).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { unmount } = render(<ProfileAvatar client={client} userId="u1" name="Ana Ruta" version={1} />);
  unmount();
  finish(new Blob(['photo']));
  await Promise.resolve();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('si los píxeles recibidos no se pueden mostrar, conserva el monograma', async () => {
  vi.mocked(avatarBlob).mockResolvedValue(new Blob(['invalid-photo'], { type: 'image/webp' }));
  render(<ProfileAvatar client={client} userId="u1" name="Ana Ruta" version={1} />);
  fireEvent.error(await screen.findByRole('img', { name: 'Foto de Ana Ruta' }));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('A')).toBeInTheDocument();
});
