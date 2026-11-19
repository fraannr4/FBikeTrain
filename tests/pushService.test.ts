import { chatPushMessage, cleanActorName, cleanPreview, handlePush, isAllowedPushEndpoint, pushMessage, type PushDependencies, type PushSubscriptionRow } from '../src/push/service';

const SECRET = 's'.repeat(40);
const USER = '00000000-0000-0000-0000-000000000011';
const CHALLENGE = '00000000-0000-0000-0000-0000000000c1';
const ACTOR = '00000000-0000-0000-0000-0000000000a1';
const FCM = 'https://fcm.googleapis.com/fcm/send/abc';
const sub = (id: string, endpoint = FCM): PushSubscriptionRow => ({ id, endpoint, p256dh: 'P'.repeat(87), auth: 'a'.repeat(22) });

const webhook = (record: Record<string, unknown> = { id: 'n1', user_id: USER, kind: 'invitation', challenge_id: CHALLENGE, actor_id: ACTOR }, extra: Record<string, unknown> = {}, headers: Record<string, string> = { 'x-push-secret': SECRET }) =>
  new Request('https://example.invalid/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ type: 'INSERT', table: 'community_notifications', schema: 'public', record, old_record: null, ...extra }),
  });

const mock = (rows: PushSubscriptionRow[] = [sub('s1')]): PushDependencies => ({
  secret: SECRET,
  vapid: { publicKey: 'BEcWftIoA550l3d89Hp0UVXhPXJQtmOY-JzRcy08qAIaP5kTyjUKvwNefDSbqR7TucHhx1asEh1GOY1Bff2avww', privateKey: 'x', subject: 'mailto:avisos@example.invalid' },
  listSubscriptions: vi.fn().mockResolvedValue(rows),
  deleteSubscription: vi.fn().mockResolvedValue(undefined),
  markDelivered: vi.fn().mockResolvedValue(undefined),
  encrypt: vi.fn(async (plain: Uint8Array) => plain),
  authorize: vi.fn().mockResolvedValue('vapid t=jwt, k=key'),
  send: vi.fn().mockResolvedValue(201),
});

describe('push: quién puede disparar la función', () => {
  it('rechaza peticiones sin secreto o con otro secreto, sin tocar suscripciones', async () => {
    for (const headers of [{}, { "x-push-secret": "otro" }, { "x-push-secret": SECRET.slice(1) }, { authorization: `Bearer ${SECRET}` }] as Record<string, string>[]) {
      const deps = mock();
      expect((await handlePush(webhook(undefined, {}, headers), deps)).status).toBe(401);
      expect(deps.listSubscriptions).not.toHaveBeenCalled();
      expect(deps.send).not.toHaveBeenCalled();
    }
  });
  it('falla cerrado sin secreto configurado, con uno corto o sin claves VAPID', async () => {
    for (const patch of [{ secret: '' }, { secret: 'corto' }, { vapid: null }]) {
      const deps = { ...mock(), ...patch };
      const response = await handlePush(webhook(undefined, {}, { 'x-push-secret': patch.secret ?? SECRET }), deps);
      expect(response.status).toBe(503);
      expect(deps.send).not.toHaveBeenCalled();
    }
  });
  it('solo admite POST y no declara CORS: un navegador no puede llamarla', async () => {
    const deps = mock();
    const get = await handlePush(new Request('https://example.invalid/push', { headers: { 'x-push-secret': SECRET } }), deps);
    expect(get.status).toBe(405);
    const post = await handlePush(webhook(), deps);
    expect(post.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('rechaza cuerpos que no son JSON, demasiado grandes o con campos mal formados', async () => {
    const deps = mock();
    const plain = new Request('https://example.invalid/push', { method: 'POST', headers: { 'x-push-secret': SECRET, 'Content-Type': 'text/plain' }, body: '{}' });
    expect((await handlePush(plain, deps)).status).toBe(400);
    const big = new Request('https://example.invalid/push', { method: 'POST', headers: { 'x-push-secret': SECRET, 'Content-Type': 'application/json' }, body: 'x'.repeat(20_000) });
    expect((await handlePush(big, deps)).status).toBe(413);
    for (const record of [{ user_id: 'no-uuid', kind: 'invitation' }, { user_id: USER, kind: 'invitation', challenge_id: 'no-uuid' }, { user_id: USER }]) {
      expect((await handlePush(webhook(record), deps)).status).toBe(400);
    }
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('ignora otras tablas, otras operaciones y avisos que no son de retos ni de solicitudes de amistad', async () => {
    const deps = mock();
    for (const response of [
      await handlePush(webhook(undefined, { table: 'profiles' }), deps),
      await handlePush(webhook(undefined, { type: 'UPDATE' }), deps),
      await handlePush(webhook({ user_id: USER, kind: 'friendship_accepted', actor_id: ACTOR }), deps),
      await handlePush(webhook({ user_id: USER, kind: 'finished', challenge_id: CHALLENGE }), deps),
    ]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ignored: true });
    }
    expect(deps.listSubscriptions).not.toHaveBeenCalled();
  });
});

describe('push: texto del aviso', () => {
  it.each([
    ['invitation', 'Te han retado', 'Tienes una invitación a un reto. Ábrela para aceptarla o rechazarla.', `#/retos/comunidad/${CHALLENGE}`, 'reto'],
    ['accepted', 'Reto aceptado', 'Han aceptado tu reto.', `#/retos/comunidad/${CHALLENGE}`, 'reto'],
    ['declined', 'Reto rechazado', 'Han rechazado tu reto.', `#/retos/comunidad/${CHALLENGE}`, 'reto'],
    ['friendship', 'Solicitud de amistad', 'Tienes una nueva solicitud de amistad.', '#/perfil/amigos', 'amistad'],
  ])('%s: texto corto en castellano y ruta a abrir', (kind, title, body, url, tag) => {
    expect(pushMessage(kind, CHALLENGE)).toEqual({ title, body, url, tag });
  });
  it('un reto sin identificador abre la lista de retos; los demás tipos no avisan', () => {
    expect(pushMessage('invitation', null)?.url).toBe('#/retos');
    expect(pushMessage('finished', CHALLENGE)).toBeNull();
    expect(pushMessage('friendship_accepted', null)).toBeNull();
    expect(pushMessage('otra', null)).toBeNull();
  });
  it.each([
    ['invitation', 'Ana te ha retado', 'Tienes una invitación a un reto. Ábrela para aceptarla o rechazarla.'],
    ['accepted', 'Reto aceptado', 'Ana ha aceptado tu reto.'],
    ['declined', 'Reto rechazado', 'Ana ha rechazado tu reto.'],
    ['friendship', 'Solicitud de amistad', 'Ana quiere añadirte a sus amistades.'],
  ])('%s: con nombre público, el aviso dice quién', (kind, title, body) => {
    expect(pushMessage(kind, CHALLENGE, 'Ana')).toMatchObject({ title, body });
  });
  it('limpia el nombre: sin saltos ni caracteres de control, recortado a 40 y nulo si queda vacío o parece un enlace', () => {
    expect(cleanActorName('  Ana\n\u202eGarcía\t ')).toBe('Ana García');
    expect(cleanActorName('x'.repeat(200))).toHaveLength(40);
    for (const bait of ['Entra en evil.com', 'http://x', 'www.premio', 'soporte@fbiketrain', 'a/b']) expect(cleanActorName(bait)).toBeNull();
    expect(cleanActorName('Ana M. García')).toBe('Ana M. García');
    expect(cleanActorName(' \n ')).toBeNull();
    expect(cleanActorName(42)).toBeNull();
  });
  it('el nombre del webhook llega al título y la carga sigue sin cuentas ni ubicaciones', async () => {
    const deps = mock();
    await handlePush(webhook({ user_id: USER, kind: 'invitation', challenge_id: CHALLENGE, actor_id: ACTOR, actor_name: 'Ana' }), deps);
    const payload = JSON.parse(new TextDecoder().decode((deps.encrypt as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array));
    expect(payload.title).toBe('Ana te ha retado');
    expect(Object.keys(payload).sort()).toEqual(['body', 'tag', 'title', 'url']);
    expect(JSON.stringify(payload)).not.toContain(ACTOR);
  });
  it('sin nombre, la carga cifrada solo lleva título, texto, ruta y etiqueta: ni cuentas ni ubicaciones', async () => {
    const deps = mock();
    await handlePush(webhook(), deps);
    const plain = (deps.encrypt as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
    const payload = JSON.parse(new TextDecoder().decode(plain));
    expect(Object.keys(payload).sort()).toEqual(['body', 'tag', 'title', 'url']);
    expect(JSON.stringify(payload)).not.toContain(ACTOR);
    expect(JSON.stringify(payload)).not.toContain(USER);
  });
});

const CONVERSATION = '00000000-0000-0000-0000-0000000000d1';
const chatWebhook = (record: Record<string, unknown> = {}) =>
  webhook({ user_id: USER, kind: 'text', conversation_id: CONVERSATION, actor_name: 'Ana Ruta', title: null, preview: '¿Salimos mañana?', ...record }, { table: 'chat_messages' });
const sentPayload = (deps: PushDependencies) => JSON.parse(new TextDecoder().decode((deps.encrypt as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array));

describe('push: avisos del chat', () => {
  it('chat de dos: título con el nombre y cuerpo con el texto', () => {
    expect(chatPushMessage('text', CONVERSATION, 'Ana Ruta', null, '¿Salimos mañana?'))
      .toEqual({ title: 'Ana Ruta', body: '¿Salimos mañana?', url: `#/chat/${CONVERSATION}`, tag: 'chat' });
  });
  it('grupo: título con el grupo y el nombre delante del texto', () => {
    expect(chatPushMessage('text', CONVERSATION, 'Ana Ruta', 'Grupeta sábado', 'vale')).toMatchObject({ title: 'Grupeta sábado', body: 'Ana Ruta: vale' });
  });
  it.each([
    ['text', 'Te ha escrito.', 'Ana ha escrito.', 'Te han escrito.'],
    ['ride', 'Te ha enviado una salida.', 'Ana ha enviado una salida.', 'Te han enviado una salida.'],
    ['route', 'Te ha enviado una ruta.', 'Ana ha enviado una ruta.', 'Te han enviado una ruta.'],
    ['library_route', 'Te ha enviado una ruta.', 'Ana ha enviado una ruta.', 'Te han enviado una ruta.'],
    ['proposal', 'Propone una salida.', 'Ana propone una salida.', 'Te proponen una salida.'],
  ])('%s sin texto: dice el tipo, con el nombre donde toca', (kind, direct, group, anonymous) => {
    expect(chatPushMessage(kind, CONVERSATION, 'Ana', null, null)).toMatchObject({ title: 'Ana', body: direct });
    expect(chatPushMessage(kind, CONVERSATION, 'Ana', 'Grupeta', null)).toMatchObject({ title: 'Grupeta', body: group });
    expect(chatPushMessage(kind, CONVERSATION, null, null, null)).toMatchObject({ title: 'Mensaje nuevo', body: anonymous });
  });
  it('el texto solo viaja en los mensajes de texto; system y tipos desconocidos no avisan', () => {
    expect(chatPushMessage('ride', CONVERSATION, 'Ana', null, 'no debe salir')?.body).toBe('Te ha enviado una salida.');
    for (const kind of ['system', 'otra', 'constructor', '']) expect(chatPushMessage(kind, CONVERSATION, 'Ana', null, 'x')).toBeNull();
  });
  it('cleanPreview quita controles y saltos, colapsa espacios y corta a 120 sin partir un emoji', () => {
    expect(cleanPreview('  Hola\n\n\u202equé\ttal  ')).toBe('Hola qué tal');
    expect(cleanPreview('x'.repeat(500))).toHaveLength(120);
    expect(cleanPreview('😀'.repeat(200))).toBe('😀'.repeat(60));
    expect(cleanPreview(`a${'😀'.repeat(200)}`)).toBe(`a${'😀'.repeat(59)}`);
    expect(cleanPreview('👨‍👩‍👧 vamos')).toBe('👨‍👩‍👧 vamos');
    for (const empty of [' \n ', '', 42, null, undefined]) expect(cleanPreview(empty)).toBeNull();
  });
  it('handlePush entrega un mensaje de chat y la carga solo lleva título, texto, ruta y etiqueta', async () => {
    const deps = mock();
    const response = await handlePush(chatWebhook(), deps);
    expect(await response.json()).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(deps.listSubscriptions).toHaveBeenCalledWith(USER);
    expect(sentPayload(deps)).toEqual({ title: 'Ana Ruta', body: '¿Salimos mañana?', url: `#/chat/${CONVERSATION}`, tag: 'chat' });
  });
  it('limpia lo que llega del trigger: nombre con pinta de enlace, texto con controles y texto largo', async () => {
    const deps = mock();
    await handlePush(chatWebhook({ actor_name: 'gana en evil.com', preview: `premio\u202e\n${'x'.repeat(500)}` }), deps);
    const payload = sentPayload(deps);
    expect(payload.title).toBe('Mensaje nuevo');
    expect(payload.body).toHaveLength(120);
    expect(payload.body.startsWith('premio x')).toBe(true);
  });
  it('en un grupo el título es el del grupo y el nombre va delante del texto', async () => {
    const deps = mock();
    await handlePush(chatWebhook({ title: 'Grupeta del sábado', preview: 'vale' }), deps);
    expect(sentPayload(deps)).toMatchObject({ title: 'Grupeta del sábado', body: 'Ana Ruta: vale' });
  });
  it('rechaza un mensaje de chat sin conversación válida, sin cuenta válida o sin tipo', async () => {
    const deps = mock();
    for (const record of [{ conversation_id: 'no-uuid' }, { conversation_id: undefined }, { user_id: 'no-uuid' }, { kind: 7 }]) {
      expect((await handlePush(chatWebhook(record), deps)).status).toBe(400);
    }
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('un mensaje de sistema se ignora sin tocar suscripciones', async () => {
    const deps = mock();
    const response = await handlePush(chatWebhook({ kind: 'system' }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: true });
    expect(deps.listSubscriptions).not.toHaveBeenCalled();
  });
});

describe('push: envío', () => {
  it('cifra y envía a cada dispositivo de la cuenta con las cabeceras de Web Push y anota el éxito', async () => {
    const deps = mock([sub('s1'), sub('s2', 'https://updates.push.services.mozilla.com/wpush/v2/xyz')]);
    const response = await handlePush(webhook(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(deps.listSubscriptions).toHaveBeenCalledWith(USER);
    expect(deps.send).toHaveBeenCalledTimes(2);
    const [endpoint, init] = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(endpoint).toBe(FCM);
    expect(init.headers).toMatchObject({ Authorization: 'vapid t=jwt, k=key', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' });
    expect(deps.markDelivered).toHaveBeenCalledTimes(2);
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
  });
  it('sin dispositivos suscritos no envía nada', async () => {
    const deps = mock([]);
    expect(await (await handlePush(webhook(), deps)).json()).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(deps.send).not.toHaveBeenCalled();
  });
  it.each([404, 410])('borra el endpoint caducado (%i)', async status => {
    const deps = mock();
    (deps.send as ReturnType<typeof vi.fn>).mockResolvedValue(status);
    expect(await (await handlePush(webhook(), deps)).json()).toEqual({ sent: 0, removed: 1, failed: 0 });
    expect(deps.deleteSubscription).toHaveBeenCalledWith('s1');
    expect(deps.markDelivered).not.toHaveBeenCalled();
  });
  it.each([400, 429, 500, 301])('conserva el endpoint ante un fallo pasajero o ajeno (%i)', async status => {
    const deps = mock();
    (deps.send as ReturnType<typeof vi.fn>).mockResolvedValue(status);
    expect(await (await handlePush(webhook(), deps)).json()).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
  });
  it('un fallo de red en un dispositivo no impide el envío a los demás', async () => {
    const deps = mock([sub('s1'), sub('s2')]);
    (deps.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce(201);
    expect(await (await handlePush(webhook(), deps)).json()).toEqual({ sent: 1, removed: 0, failed: 1 });
  });
  it('borra sin enviar las suscripciones con claves que no se pueden usar', async () => {
    const deps = mock();
    (deps.encrypt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('p256dh'));
    expect(await (await handlePush(webhook(), deps)).json()).toEqual({ sent: 0, removed: 1, failed: 0 });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.deleteSubscription).toHaveBeenCalledWith('s1');
  });
  it('si la base de datos falla al borrar o anotar, responde igualmente y lo cuenta como fallo', async () => {
    const deps = mock([sub('s1'), sub('s2'), sub('bad', 'http://127.0.0.1/x')]);
    (deps.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce(410).mockResolvedValueOnce(201);
    (deps.deleteSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db'));
    const response = await handlePush(webhook(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 1, removed: 0, failed: 2 });
  });
  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1/push',
    'https://localhost/push',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/push',
    'https://10.0.0.5/push',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'ftp://fcm.googleapis.com/x',
    'no es una url',
  ])('no envía a un endpoint no permitido y lo borra: %s', async endpoint => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    const deps = mock([sub('bad', endpoint)]);
    expect(await (await handlePush(webhook(), deps)).json()).toEqual({ sent: 0, removed: 1, failed: 0 });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.deleteSubscription).toHaveBeenCalledWith('bad');
  });
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/QGx',
  ])('permite los servicios push conocidos: %s', endpoint => expect(isAllowedPushEndpoint(endpoint)).toBe(true));
});
