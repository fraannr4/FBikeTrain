import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from '../src/push/webpush';

// Vector del apéndice A de RFC 8291 (cifrado de mensajes Web Push, aes128gcm).
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function importPair(publicB64: string, privateB64: string, usage: KeyUsage[], algorithm: EcKeyImportParams): Promise<CryptoKeyPair> {
  const pub = b64urlDecode(publicB64);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)) };
  return {
    publicKey: await crypto.subtle.importKey('jwk', jwk, algorithm, true, []),
    privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: privateB64 }, algorithm, false, usage),
  };
}

describe('Web Push: cifrado aes128gcm (RFC 8291)', () => {
  it('reproduce el vector del apéndice A byte a byte', async () => {
    const serverKeys = await importPair(RFC.asPublic, RFC.asPrivate, ['deriveBits'], { name: 'ECDH', namedCurve: 'P-256' });
    const body = await encryptPayload(new TextEncoder().encode(RFC.plaintext), RFC.uaPublic, RFC.auth, { salt: b64urlDecode(RFC.salt), serverKeys });
    expect(b64urlEncode(body)).toBe(RFC.body);
  });

  it('el navegador destinatario puede descifrar lo que se envía con claves nuevas', async () => {
    const body = await encryptPayload(new TextEncoder().encode('Hola, ciclista'), RFC.uaPublic, RFC.auth);
    // Cabecera: sal (16) + tamaño de registro (4) + longitud de clave (1) + clave pública del servidor (65).
    expect(body[20]).toBe(65);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    const salt = body.slice(0, 16);
    const asPublic = body.slice(21, 86);
    const ua = await importPair(RFC.uaPublic, RFC.uaPrivate, ['deriveBits'], { name: 'ECDH', namedCurve: 'P-256' });
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256);
    const enc = new TextEncoder();
    const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...b64urlDecode(RFC.uaPublic), ...asPublic]);
    const ikm = await crypto.subtle.importKey('raw', await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: b64urlDecode(RFC.auth), info }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), 256), 'HKDF', false, ['deriveBits']);
    const cek = await crypto.subtle.importKey('raw', await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\0') }, ikm, 128), 'AES-GCM', false, ['decrypt']);
    const nonce = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\0') }, ikm, 96);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cek, body.slice(86)));
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('Hola, ciclista');
    expect(plain.at(-1)).toBe(2);
  });

  it('usa una sal distinta en cada envío', async () => {
    const a = await encryptPayload(new Uint8Array([1]), RFC.uaPublic, RFC.auth);
    const b = await encryptPayload(new Uint8Array([1]), RFC.uaPublic, RFC.auth);
    expect(b64urlEncode(a.slice(0, 16))).not.toBe(b64urlEncode(b.slice(0, 16)));
  });

  it('rechaza una clave pública que no es un punto P-256 sin comprimir', async () => {
    await expect(encryptPayload(new Uint8Array([1]), b64urlEncode(new Uint8Array(65)), RFC.auth)).rejects.toThrow();
    await expect(encryptPayload(new Uint8Array([1]), 'corta', RFC.auth)).rejects.toThrow('p256dh');
  });

  it('rechaza cargas que no caben en un registro', async () => {
    await expect(encryptPayload(new Uint8Array(4080), RFC.uaPublic, RFC.auth)).rejects.toThrow('payload');
  });
});

describe('Web Push: cabecera VAPID (RFC 8292)', () => {
  it('firma un JWT ES256 con audiencia, caducidad y contacto', async () => {
    const vapid = await importPair(RFC.asPublic, RFC.asPrivate, ['sign'], { name: 'ECDSA', namedCurve: 'P-256' });
    expect(vapid.privateKey).toBeTruthy();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey: RFC.asPublic, privateKey: RFC.asPrivate, subject: 'mailto:avisos@example.invalid' }, 1_700_000_000_000);
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(RFC.asPublic);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:avisos@example.invalid' });
    const verifyKey = await crypto.subtle.importKey('raw', b64urlDecode(RFC.asPublic), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });
});
