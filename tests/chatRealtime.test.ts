import type { SupabaseClient } from '@supabase/supabase-js';
import { POLL_MS, subscribeConversation } from '../src/social/chatRealtime';

const ID = '00000000-0000-0000-0000-0000000000d1';

function fakeClient() {
  const handlers: { type: string; filter: Record<string, unknown>; callback: () => void }[] = [];
  let onStatus: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn((type: string, filter: Record<string, unknown>, callback: () => void) => { handlers.push({ type, filter, callback }); return channel; }),
    subscribe: vi.fn((callback: (status: string) => void) => { onStatus = callback; return channel; }),
  };
  const raw = { channel: vi.fn(() => channel), removeChannel: vi.fn().mockResolvedValue('ok') };
  return { client: raw as unknown as SupabaseClient, raw, channel, handlers, status: (value: string) => onStatus?.(value) };
}

describe('chat: canal de tiempo real', () => {
  it('escucha solo altas y cambios de los mensajes de esa conversación', () => {
    const f = fakeClient();
    subscribeConversation(f.client, ID, vi.fn(), vi.fn());
    expect(f.raw.channel).toHaveBeenCalledWith(`chat:${ID}`);
    expect(f.handlers.map(h => [h.type, h.filter])).toEqual([
      ['postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${ID}` }],
      ['postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${ID}` }],
    ]);
    expect(f.channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('cada cambio avisa, sin pasar el contenido: el cliente vuelve a pedir la página al servidor', () => {
    const f = fakeClient();
    const onPoke = vi.fn();
    subscribeConversation(f.client, ID, onPoke, vi.fn());
    for (const handler of f.handlers) handler.callback();
    expect(onPoke).toHaveBeenCalledTimes(2);
    expect(onPoke).toHaveBeenCalledWith();
  });

  it('dice si el canal está vivo: solo SUBSCRIBED cuenta', () => {
    const f = fakeClient();
    const onStatus = vi.fn();
    subscribeConversation(f.client, ID, vi.fn(), onStatus);
    for (const status of ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) f.status(status);
    expect(onStatus.mock.calls.map(call => call[0])).toEqual([true, false, false, false]);
  });

  it('al cerrar quita el canal una vez y deja de avisar', () => {
    const f = fakeClient();
    const onPoke = vi.fn();
    const onStatus = vi.fn();
    const close = subscribeConversation(f.client, ID, onPoke, onStatus);
    close();
    close();
    expect(f.raw.removeChannel).toHaveBeenCalledTimes(1);
    expect(f.raw.removeChannel).toHaveBeenCalledWith(f.channel);
    f.handlers[0].callback();
    f.status('CLOSED');
    expect(onPoke).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('el sondeo de respaldo es de 10 s', () => expect(POLL_MS).toBe(10_000));
});
