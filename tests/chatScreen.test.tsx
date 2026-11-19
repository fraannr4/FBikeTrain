import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { ToastProvider } from '../src/ui/components/Toast';
import { Chat } from '../src/ui/pages/Chat';
import { Chats } from '../src/ui/pages/Chats';

const ME = 'u1';
const conversationRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1', kind: 'direct', title: null, peer_id: 'p2', peer_name: 'Ana Ruta', peer_avatar_version: 0, peer_last_read_at: null,
  last_kind: 'text', last_preview: '¿Salimos?', last_sender_id: 'p2', last_message_at: new Date().toISOString(), unread: 1,
  muted: false, can_send: true, last_deleted: false, ...over,
});
const messageRow = (id: string, sender: string, body: string, minutesAgo: number) => ({
  id, conversation_id: 'c1', sender_id: sender, sender_name: sender === ME ? 'Yo' : 'Ana Ruta',
  created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), kind: 'text', body, payload: {}, deleted: false,
});

type Reply = { data?: unknown; error?: { message: string } | null };
/** Cliente falso: `send` decide la respuesta de cada `chat_send`. Los mensajes van del más nuevo al más antiguo, como el servidor. */
function setup(opts: { conversations?: unknown[]; messages?: unknown[] | (() => unknown[]); send?: (args: Record<string, unknown>) => Reply; extra?: Record<string, unknown> } = {}) {
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>): Promise<Reply> => {
    if (fn === 'chat_list_conversations') return { data: opts.conversations ?? [conversationRow()] };
    if (fn === 'chat_list_messages') return { data: (typeof opts.messages === 'function' ? opts.messages() : opts.messages) ?? [messageRow('m1', 'p2', '¿Salimos?', 5)] };
    if (fn === 'chat_send') return opts.send ? opts.send(args ?? {}) : { data: [{ ...messageRow(String(args?.message_id), ME, String(args?.message_body), 0) }] };
    return { data: null };
  });
  render(
    <AccountContext.Provider value={{ client: { rpc, ...opts.extra } as unknown as SupabaseClient, user: { id: ME } as User }}>
      <MemoryRouter initialEntries={['/chat/c1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes>
            <Route path="/chat" element={<Chats />} />
            <Route path="/chat/:id" element={<Chat />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
  return { rpc };
}
const sends = (rpc: ReturnType<typeof vi.fn>) => rpc.mock.calls.filter(([fn]) => fn === 'chat_send').map(([, args]) => args as Record<string, unknown>);

describe('conversación', () => {
  afterEach(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));

  it('pinta la cabecera, los mensajes por día y marca la conversación como leída', async () => {
    const { rpc } = setup();
    expect(await screen.findByRole('heading', { name: 'Ana Ruta', level: 1 })).toBeInTheDocument();
    const log = screen.getByRole('log', { name: 'Mensajes con Ana Ruta' });
    expect(within(log).getByRole('heading', { name: 'Hoy' })).toBeInTheDocument();
    expect(within(log).getByText('¿Salimos?')).toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('chat_mark_read', { conversation: 'c1' }));
  });

  it('envía el texto con un id propio y lo enseña una sola vez', async () => {
    const { rpc } = setup();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Mensaje' }), 'Hola');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Hola')).toBeInTheDocument();
    const [call] = sends(rpc);
    expect(sends(rpc)).toHaveLength(1);
    expect(call).toMatchObject({ conversation: 'c1', message_kind: 'text', message_body: 'Hola' });
    expect(String(call.message_id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('si el envío falla queda «No enviado» y «Reintentar» reusa el mismo id sin duplicar', async () => {
    let fail = true;
    const { rpc } = setup({
      send: (args) => (fail ? { error: { message: 'boom' } } : { data: [messageRow(String(args.message_id), ME, String(args.message_body), 0)] }),
    });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Mensaje' }), 'Vale');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('No enviado')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByText('No enviado')).not.toBeInTheDocument());
    const [first, second] = sends(rpc);
    expect(second.message_id).toBe(first.message_id);
    expect(screen.getAllByText('Vale')).toHaveLength(1);
  });

  it('«Ya no sois amigos» al enviar sustituye el campo por la línea de solo lectura', async () => {
    setup({ send: () => ({ error: { message: 'Ya no sois amigos' } }) });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Mensaje' }), 'Hola');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Ya no sois amigos: no puedes escribir aquí.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Mensaje' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('sin poder escribir, la conversación se abre en solo lectura', async () => {
    setup({ conversations: [conversationRow({ can_send: false })] });
    expect(await screen.findByText('Ya no sois amigos: no puedes escribir aquí.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Mensaje' })).not.toBeInTheDocument();
  });

  it('«Visto» bajo tu último mensaje leído por la otra persona', async () => {
    setup({
      conversations: [conversationRow({ peer_last_read_at: new Date(Date.now() - 60_000).toISOString() })],
      messages: [messageRow('m3', ME, 'Llevo cámaras', 2), messageRow('m2', 'p2', 'Perfecto', 3), messageRow('m1', ME, 'Voy', 4)],
    });
    const seen = await screen.findByText('Visto');
    expect(seen.closest('li')).toHaveTextContent('Llevo cámaras');
  });

  it('un tipo de mensaje que esta versión no conoce no rompe', async () => {
    setup({ messages: [{ ...messageRow('m1', 'p2', '', 1), kind: 'proposal' }] });
    expect(await screen.findByText('Mensaje no compatible con esta versión')).toBeInTheDocument();
  });

  it('un mensaje propio se borra desde su menú y queda «Mensaje borrado»', async () => {
    const { rpc } = setup({ messages: [messageRow('m2', ME, 'Me equivoqué', 1), messageRow('m1', 'p2', '¿Salimos?', 5)] });
    const user = userEvent.setup();
    fireEvent.contextMenu(await screen.findByRole('button', { name: /Me equivoqué/ }));
    await user.click(await screen.findByRole('button', { name: 'Borrar mensaje' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('chat_delete_message', { message_id: 'm2' }));
    expect(await screen.findByText('Mensaje borrado')).toBeInTheDocument();
    expect(screen.queryByText('Me equivoqué')).not.toBeInTheDocument();
  });

  it('un mensaje ajeno se denuncia con motivo, avisa del bloqueo y vuelve a la lista', async () => {
    const { rpc } = setup();
    const user = userEvent.setup();
    const bubble = await screen.findByRole('button', { name: /¿Salimos\?/ });
    bubble.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/también bloqueas a Ana Ruta/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Denunciar y bloquear' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Motivo de la denuncia' }), 'Insultos sintéticos');
    await user.click(submit);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_chat_message', { message_id: 'm1', reason: 'Insultos sintéticos' }));
    expect(await screen.findByRole('heading', { name: 'Chat', level: 1 })).toBeInTheDocument();
  });

  it('si la conversación no está en tu lista, lo dice y lleva de vuelta al chat', async () => {
    setup({ conversations: [] });
    expect(await screen.findByRole('heading', { name: 'Esta conversación ya no está disponible.' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Volver a Chat' });
    expect(links.every((a) => a.getAttribute('href') === '/chat')).toBe(true);
  });

  it('un mensaje que llega con la app oculta se marca como leído al volver', async () => {
    let poke = () => {};
    const channel = {
      on: (_event: string, _filter: unknown, handler: () => void) => { poke = handler; return channel; },
      subscribe: (cb: (status: string) => void) => { cb('SUBSCRIBED'); return channel; },
    };
    let rows = [messageRow('m1', 'p2', '¿Salimos?', 5)];
    const { rpc } = setup({ messages: () => rows, extra: { channel: () => channel, removeChannel: vi.fn() } });
    const marks = () => rpc.mock.calls.filter(([fn]) => fn === 'chat_mark_read').length;
    await waitFor(() => expect(marks()).toBe(1));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    rows = [messageRow('m2', 'p2', 'Mañana a las 9', 0), ...rows];
    act(() => poke());
    expect(await screen.findByText('Mañana a las 9')).toBeInTheDocument();
    expect(marks()).toBe(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(marks()).toBe(2));
  });

  it('el hilo es una sola parada de tabulador y las flechas pasan de un mensaje a otro', async () => {
    setup({ messages: [messageRow('m3', ME, 'Llevo cámaras', 2), messageRow('m2', 'p2', 'Perfecto', 3), messageRow('m1', ME, 'Voy', 4)] });
    const user = userEvent.setup();
    const last = await screen.findByRole('button', { name: /Llevo cámaras/ });
    const previous = screen.getByRole('button', { name: /Perfecto/ });
    expect(last).toHaveAttribute('tabindex', '0');
    expect(previous).toHaveAttribute('tabindex', '-1');
    last.focus();
    await user.keyboard('{ArrowUp}');
    expect(previous).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(last).toHaveFocus();
  });
});
