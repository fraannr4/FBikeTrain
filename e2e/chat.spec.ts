import { test, expect, TEST_USER_ID, type Page } from './accountFixture';
import { auditContrast } from './contrast';

// Chat con las RPC simuladas y el WebSocket de Realtime sin responder. Nombres y textos sintéticos.
test.setTimeout(90_000);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = 'test-results/chat';
const ME = TEST_USER_ID;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

type Row = Record<string, unknown>;
const conversation = (over: Row = {}): Row => ({
  id: 'c1', kind: 'direct', title: null, peer_id: 'p2', peer_name: 'Ana Ruta', peer_avatar_version: 0, peer_last_read_at: null,
  last_kind: 'text', last_preview: '¿Quedamos a las 8:15 mejor?', last_sender_id: 'p2', last_message_at: ago(3), unread: 2,
  muted: false, can_send: true, last_deleted: false, ...over,
});
const message = (id: string, sender: string, body: string, at: string, over: Row = {}): Row => ({
  id, conversation_id: 'c1', sender_id: sender, sender_name: sender === ME ? 'Tú' : 'Ana Ruta', created_at: at, kind: 'text', body, payload: {}, deleted: false, ...over,
});
const TWO = [
  conversation(),
  conversation({ id: 'c2', peer_id: 'p3', peer_name: 'Marc Coll', last_preview: 'Mañana te cuento qué tal la subida', last_sender_id: ME, last_message_at: ago(60 * 26), unread: 0 }),
];
const THREAD = [
  message('m1', 'p2', '¿Te apuntas el sábado? Salimos a las 8:30 desde la fuente.', ago(30)),
  message('m2', ME, 'Sí, cuenta conmigo', ago(20)),
  message('m3', 'p2', '¿Quedamos a las 8:15 mejor?', ago(3)),
];

type Options = { conversations?: Row[]; messages?: Row[]; unread?: number; send?: 'ok' | 'fail' | 'not-friends' };
async function fakeChat(page: Page, opts: Options = {}) {
  const state = { conversations: opts.conversations ?? TWO, messages: [...(opts.messages ?? THREAD)], send: opts.send ?? 'ok', sends: [] as Row[] };
  // Realtime nunca contesta: el chat tiene que seguir por sondeo. Tampoco sale nada a la red real.
  await page.routeWebSocket(/supabase\.co/, () => {});
  await page.route('https://*.supabase.co/rest/v1/rpc/*', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const fn = new URL(req.url()).pathname.split('/').pop();
    const json = (body: unknown, status = 200) => r.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (fn === 'chat_unread_count') return json(opts.unread ?? 0);
    if (fn === 'chat_list_conversations') return json(state.conversations);
    if (fn === 'chat_list_messages') return json([...state.messages].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    if (fn === 'chat_send') {
      const args = req.postDataJSON() as Row;
      state.sends.push(args);
      if (state.send === 'fail') return json({ code: 'XX000', message: 'Fallo sintético', details: null, hint: null }, 500);
      if (state.send === 'not-friends') return json({ code: 'P0001', message: 'Ya no sois amigos', details: null, hint: null }, 400);
      const saved = message(String(args.message_id), ME, String(args.message_body), new Date().toISOString());
      if (!state.messages.some((m) => m.id === saved.id)) state.messages.push(saved);
      return json([saved]);
    }
    return r.fulfill({ status: 204, headers: CORS });
  });
  return state;
}
const box = async (page: Page, name: string) => (await page.getByRole('link', { name }).or(page.getByRole('button', { name })).first().boundingBox())!;

test.describe('a 390 px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('lista vacía: título, texto y «Escribe a un amigo»; «Nuevo chat» lleva a tus amigos y mide 44 px', async ({ page }) => {
    await fakeChat(page, { conversations: [conversation({ last_kind: null, last_preview: '', unread: 0 })] });
    await page.goto('./#/chat');
    await expect(page.getByRole('heading', { name: 'Chat', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aún no has hablado con nadie' })).toBeVisible();
    await expect(page.getByText('Aquí verás tus conversaciones. Puedes escribir a cualquiera de tus amigos.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Escribe a un amigo' })).toHaveAttribute('href', '#/perfil/amigos');
    const nuevo = await box(page, 'Nuevo chat');
    expect(nuevo.width).toBeGreaterThanOrEqual(44);
    expect(nuevo.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('link', { name: 'Nuevo chat' }).click();
    await expect(page).toHaveURL(/#\/perfil\/amigos$/);
  });

  test('lista con dos conversaciones: el contador de la no leída y la insignia de la barra', async ({ page }) => {
    await fakeChat(page, { unread: 1 });
    await page.goto('./#/chat');
    const list = page.getByRole('list', { name: 'Conversaciones' });
    await expect(list.getByRole('link', { name: /^Ana Ruta, 2 mensajes sin leer\./ })).toBeVisible();
    await expect(list.locator('.chat-row-count')).toHaveText('2');
    await expect(list.getByText('Tú: Mañana te cuento qué tal la subida')).toBeVisible();
    await expect(list.getByText('Ayer')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Chat, 1 conversación sin leer' })).toBeVisible();
  });

  test('abrir una conversación, escribir «Hola» y enviar', async ({ page }) => {
    const state = await fakeChat(page);
    await page.goto('./#/chat');
    await page.getByRole('link', { name: /^Ana Ruta/ }).click();
    await expect(page).toHaveURL(/#\/chat\/c1$/);
    const log = page.getByRole('log', { name: 'Mensajes con Ana Ruta' });
    await expect(log.getByText('¿Quedamos a las 8:15 mejor?')).toBeVisible();
    // Sin muelle inferior en la conversación.
    await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeHidden();
    await page.getByRole('textbox', { name: 'Mensaje' }).fill('Hola');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(log.getByText('Hola', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveValue('');
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]).toMatchObject({ conversation: 'c1', message_body: 'Hola', message_kind: 'text' });
  });

  test('si chat_send falla: «No enviado»; «Reintentar» reusa el mismo id y el mensaje sale una vez (foco 1)', async ({ page }) => {
    const state = await fakeChat(page, { send: 'fail' });
    await page.goto('./#/chat/c1');
    await page.getByRole('textbox', { name: 'Mensaje' }).fill('Vale, a las 8:15 en la fuente');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('No enviado')).toBeVisible();
    state.send = 'ok';
    await page.getByRole('button', { name: 'Reintentar' }).dblclick();
    await expect(page.getByText('No enviado')).toBeHidden();
    const ids = state.sends.map((s) => s.message_id);
    expect(new Set(ids).size).toBe(1);
    await expect(page.getByRole('log').getByText('Vale, a las 8:15 en la fuente')).toHaveCount(1);
    expect(state.messages.filter((m) => m.body === 'Vale, a las 8:15 en la fuente')).toHaveLength(1);
  });

  test('sin WebSocket, un mensaje nuevo del servidor aparece por sondeo en menos de 15 s (foco 2)', async ({ page }) => {
    const state = await fakeChat(page);
    await page.goto('./#/chat/c1');
    await expect(page.getByRole('log').getByText('¿Quedamos a las 8:15 mejor?')).toBeVisible();
    state.messages.push(message('m9', 'p2', 'Llevo la bomba', new Date().toISOString()));
    await expect(page.getByRole('log').getByText('Llevo la bomba')).toBeVisible({ timeout: 15_000 });
  });

  test('«Ya no sois amigos» al enviar: aparece la explicación y el campo desaparece (foco 3)', async ({ page }) => {
    await fakeChat(page, { send: 'not-friends' });
    await page.goto('./#/chat/c1');
    await page.getByRole('textbox', { name: 'Mensaje' }).fill('¿Sigue en pie?');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('Ya no sois amigos: no puedes escribir aquí.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/solo-lectura-390.png` });
  });

  test('«Visto» bajo el último mensaje propio leído', async ({ page }) => {
    await fakeChat(page, { conversations: [conversation({ peer_last_read_at: ago(1) })], messages: [...THREAD, message('m4', ME, '¿Llevo cámaras de repuesto?', ago(2))] });
    await page.goto('./#/chat/c1');
    const seen = page.getByText('Visto', { exact: true });
    await expect(seen).toHaveCount(1);
    await expect(page.getByRole('listitem').filter({ has: seen })).toContainText('¿Llevo cámaras de repuesto?');
  });

  test('con el teclado abierto (500 px de alto) el campo sigue dentro de la ventana', async ({ page }) => {
    await fakeChat(page);
    await page.goto('./#/chat/c1');
    const field = page.getByRole('textbox', { name: 'Mensaje' });
    await expect(field).toBeVisible();
    await page.setViewportSize({ width: 390, height: 500 });
    await expect.poll(async () => { const b = await field.boundingBox(); return b ? b.y + b.height : 9999; }).toBeLessThanOrEqual(500);
    await expect(page.getByRole('button', { name: 'Enviar' })).toBeInViewport();
  });

  test('objetivos táctiles de 44 px y contraste en los dos temas', async ({ page }) => {
    await fakeChat(page, { send: 'fail', conversations: [conversation({ peer_last_read_at: ago(4) }), TWO[1]] });
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      await page.goto('./#/chat/c1');
      await page.reload();
      await expect(page.getByRole('log').getByText('¿Quedamos a las 8:15 mejor?')).toBeVisible();
      // Con un «No enviado» y «Visto» a la vista, para medir también su rojo y su gris.
      await page.getByRole('textbox', { name: 'Mensaje' }).fill('Mensaje que no sale');
      await page.getByRole('button', { name: 'Enviar' }).click();
      await expect(page.getByText('No enviado')).toBeVisible();
      await expect(page.getByText('Visto', { exact: true })).toBeVisible();
      await page.getByRole('textbox', { name: 'Mensaje' }).fill('Hola');
      for (const name of ['Enviar', 'Volver a Chat']) {
        const b = await box(page, name);
        expect(b.width, name).toBeGreaterThanOrEqual(44);
        expect(b.height, name).toBeGreaterThanOrEqual(44);
      }
      const report = await auditContrast(page);
      expect(report.contrast, `conversación en ${theme}`).toEqual([]);
      await page.goto('./#/chat');
      await expect(page.getByRole('list', { name: 'Conversaciones' })).toBeVisible();
      expect((await auditContrast(page)).contrast, `lista en ${theme}`).toEqual([]);
    }
  });
});

test('textos extremos a 360 px: 2000 caracteres sin espacios, emoji y árabe no desbordan (foco 4)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await fakeChat(page, {
    messages: [
      message('x1', 'p2', 'a'.repeat(2000), ago(5)),
      message('x2', 'p2', '🚴‍♀️🏔️🚴'.repeat(40), ago(4)),
      message('x3', 'p2', 'مرحبا، هل نخرج يوم السبت في الثامنة والنصف؟', ago(3)),
      message('x4', ME, '\n\n\n', ago(2)),
    ],
  });
  await page.goto('./#/chat/c1');
  await expect(page.getByRole('log').getByText(/^مرحبا/)).toBeVisible();
  const overflow = await page.evaluate(() => {
    const thread = document.querySelector('.chat-thread')!;
    return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, thread: thread.scrollWidth - thread.clientWidth };
  });
  expect(overflow).toEqual({ doc: 0, thread: 0 });
  await page.screenshot({ path: `${SHOTS}/extremos-360.png` });
});

test('a 1440 × 900, lista y conversación a la vez', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fakeChat(page);
  await page.goto('./#/chat/c1');
  const list = page.getByRole('navigation', { name: 'Conversaciones' });
  await expect(list.getByRole('link', { name: /^Ana Ruta/ })).toHaveAttribute('aria-current', 'page');
  await expect(list.getByText('Marc Coll')).toBeVisible();
  await expect(page.getByRole('log', { name: 'Mensajes con Ana Ruta' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/escritorio-1440.png` });
});

for (const width of [360, 390, 430]) {
  test(`capturas a ${width} px en claro y oscuro: lista, conversación y vacío`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const state = await fakeChat(page, { unread: 1 });
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript((t) => localStorage.setItem('fbt-theme', t), theme);
      state.conversations = TWO;
      await page.goto('./#/chat');
      await page.reload();
      await expect(page.getByRole('list', { name: 'Conversaciones' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/lista-${width}-${theme}.png` });
      await page.goto('./#/chat/c1');
      await expect(page.getByRole('log').getByText('¿Quedamos a las 8:15 mejor?')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/conversacion-${width}-${theme}.png` });
      state.conversations = [];
      await page.goto('./#/chat');
      await expect(page.getByRole('heading', { name: 'Aún no has hablado con nadie' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/vacio-${width}-${theme}.png` });
    }
  });
}
