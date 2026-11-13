import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JournalFeed } from '../src/ui/profile/JournalFeed';
import { createPost, deletePost, listJournal, type JournalPost } from '../src/social/journal';
import { listActivities } from '../src/db/repo';
import type { StoredActivity } from '../src/domain/types';

vi.mock('../src/social/journal', () => ({ createPost: vi.fn(), deletePost: vi.fn(), listJournal: vi.fn() }));
vi.mock('../src/db/repo', () => ({ listActivities: vi.fn() }));
vi.mock('../src/ui/profile/ProfileAvatar', () => ({ ProfileAvatar: ({ name }: { name: string }) => <span aria-label={`Avatar de ${name}`} /> }));

const client = {} as SupabaseClient;
const post = (id: string, authorId = 'u1'): JournalPost => ({
  id, author_id: authorId, body: `Historia ${id}`, visibility: 'friends', ride: null, created_at: '2026-11-13T12:00:00Z',
  author: { id: authorId, username: `ciclista_${authorId}`, display_name: `Ciclista ${authorId}`, riding_style: 'explorar', avatar_version: 0 },
});
const renderFeed = (targetId: string | null = 'u1', statsVisibility: 'everyone' | 'friends' = 'everyone', refreshKey?: string | number) => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><JournalFeed client={client} userId="u1" targetId={targetId} statsVisibility={statsVisibility} refreshKey={refreshKey} showComposer /></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listJournal).mockResolvedValue([]);
  vi.mocked(createPost).mockResolvedValue('new-post');
  vi.mocked(deletePost).mockResolvedValue(undefined);
  vi.mocked(listActivities).mockResolvedValue([]);
});

it('publica solo las cifras elegidas, sin nombre, id ni geometría, y respeta la privacidad de estadísticas', async () => {
  vi.mocked(listActivities).mockResolvedValue([{
    id: 'secret-local-id', startTime: Date.parse('2026-11-13T08:00:00Z'), name: 'Salida desde mi dirección privada', sport: 'cycling',
    totals: { distanceM: 42500.3, movingTimeS: 5400.4, elapsedTimeS: 6000, elevGainM: 635, avgSpeedMs: 7.8, maxSpeedMs: 12 },
    points: [{ lat: 40.1, lng: 2.1 }], hasTrack: true, source: 'gpx', importedAt: 0,
  } as unknown as StoredActivity]);
  renderFeed('u1', 'friends');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Escribir en mi cuaderno' }));
  await user.type(screen.getByLabelText('¿Qué te llevas de la ruta?'), 'Hoy la última subida supo mejor.');
  await user.selectOptions(screen.getByLabelText('Quién verá esta publicación'), 'everyone');
  await user.click(screen.getByRole('button', { name: 'Añadir cifras de una salida' }));
  await user.selectOptions(await screen.findByLabelText('Salida que quieres compartir'), 'secret-local-id');
  expect(screen.getByRole('option', { name: 'Toda la comunidad' })).toBeDisabled();
  expect(screen.getByLabelText('Quién verá esta publicación')).toHaveValue('friends');
  expect(screen.getByText('Compartes las cifras, nunca el mapa.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Publicar en mi cuaderno' }));
  expect(createPost).toHaveBeenCalledWith(client, {
    body: 'Hoy la última subida supo mejor.', visibility: 'friends',
    ride: { activity_date: '2026-11-13', distance_m: 42500, moving_time_s: 5400, elev_gain_m: 635 },
  });
  expect(JSON.stringify(vi.mocked(createPost).mock.calls[0][1])).not.toMatch(/secret-local-id|dirección|points|lat|lng|startTime/);
  expect(await screen.findByText('Publicado en tu cuaderno.')).toBeInTheDocument();
});

it('conserva éxito y descarta el borrador si escribir funciona pero falla el refresco', async () => {
  vi.mocked(listJournal).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('No hay conexión para leer el cuaderno.')).mockResolvedValue([]);
  renderFeed();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Escribir en mi cuaderno' }));
  await user.type(screen.getByLabelText('¿Qué te llevas de la ruta?'), 'Una salida que recordar.');
  await user.click(screen.getByRole('button', { name: 'Publicar en mi cuaderno' }));
  expect(await screen.findByText('Publicado en tu cuaderno.')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('No hay conexión');
  await user.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(listJournal).toHaveBeenCalledTimes(3));
  expect(createPost).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Escribir en mi cuaderno' }));
  expect(screen.getByLabelText('¿Qué te llevas de la ruta?')).toHaveValue('');
});

it('permite reintentar la carga inicial y no confunde el error con un cuaderno vacío', async () => {
  vi.mocked(listJournal).mockRejectedValueOnce(new Error('Lectura interrumpida')).mockResolvedValueOnce([post('one', 'u2')]);
  renderFeed(null);
  expect(await screen.findByRole('alert')).toHaveTextContent('Lectura interrumpida');
  expect(screen.queryByText('Las buenas historias se ruedan en compañía')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Historia one')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ver perfil de Ciclista u2' })).toHaveAttribute('href', '/personas/u2');
});

it('solo ofrece borrar publicaciones propias y requiere una confirmación explícita', async () => {
  vi.mocked(listJournal).mockResolvedValueOnce([post('mine'), post('other', 'u2')]).mockResolvedValueOnce([post('other', 'u2')]);
  renderFeed(null);
  const own = await screen.findByRole('article', { name: 'Publicación de Ciclista u1' });
  const other = screen.getByRole('article', { name: 'Publicación de Ciclista u2' });
  expect(within(other).queryByRole('button', { name: 'Borrar publicación' })).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(within(own).getByRole('button', { name: 'Borrar publicación' }));
  expect(deletePost).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Sí, borrar' }));
  expect(deletePost).toHaveBeenCalledWith(client, 'mine');
  await waitFor(() => expect(screen.queryByText('Historia mine')).not.toBeInTheDocument());
  expect(screen.getByText('Historia other')).toBeInTheDocument();
});

it('pagina con fecha e id y no duplica una tarjeta ya recibida', async () => {
  const firstPage = Array.from({ length: 20 }, (_, i) => post(`post-${i}`));
  vi.mocked(listJournal).mockResolvedValueOnce(firstPage).mockResolvedValueOnce([firstPage[19], post('older')]);
  renderFeed();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Ver publicaciones anteriores' }));
  expect(listJournal).toHaveBeenLastCalledWith(client, 'u1', { createdAt: firstPage[19].created_at, id: 'post-19' });
  expect(await screen.findByText('Historia older')).toBeInTheDocument();
  expect(screen.getAllByText('Historia post-19')).toHaveLength(1);
});

it('una respuesta tardía del perfil anterior no sustituye al nuevo cuaderno', async () => {
  let finish!: (rows: JournalPost[]) => void;
  vi.mocked(listJournal).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([post('new-profile', 'u2')]);
  const view = renderFeed();
  view.rerender(<MemoryRouter><JournalFeed client={client} userId="u1" targetId="u2" /></MemoryRouter>);
  expect(await screen.findByText('Historia new-profile')).toBeInTheDocument();
  await act(async () => { finish([post('old-profile')]); });
  expect(screen.queryByText('Historia old-profile')).not.toBeInTheDocument();
  expect(screen.getByText('Historia new-profile')).toBeInTheDocument();
});

it('sin texto ni salida no publica y conserva el editor', async () => {
  renderFeed();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Escribir en mi cuaderno' }));
  await user.click(screen.getByRole('button', { name: 'Publicar en mi cuaderno' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Escribe algo o elige una salida');
  expect(createPost).not.toHaveBeenCalled();
  expect(screen.getByRole('form', { name: 'Nueva publicación' })).toBeInTheDocument();
});

it('refresca autores al cambiar refreshKey sin desmontar el editor ni perder el borrador', async () => {
  const updated = post('one'); updated.author.display_name = 'Ana del Puerto';
  vi.mocked(listJournal).mockResolvedValueOnce([post('one')]).mockResolvedValueOnce([updated]);
  const view = renderFeed('u1', 'everyone', 'before');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Escribir en mi cuaderno' }));
  await user.type(screen.getByLabelText('¿Qué te llevas de la ruta?'), 'Un borrador que quiero conservar.');
  view.rerender(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><JournalFeed client={client} userId="u1" targetId="u1" statsVisibility="friends" refreshKey="after" showComposer /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Ver perfil de Ana del Puerto' })).toBeInTheDocument();
  expect(listJournal).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('¿Qué te llevas de la ruta?')).toHaveValue('Un borrador que quiero conservar.');
  expect(createPost).not.toHaveBeenCalled();
});
