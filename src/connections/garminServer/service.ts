import { decryptSecret, digest, encryptSecret, randomSecret } from './crypto.ts';

// Contrato público de Garmin (OAuth2PKCE_1.pdf, consultado el 2026-11-16). Ver docs/garmin-directo.md.
const AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
const TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const USER_URL = 'https://apis.garmin.com/wellness-api/rest/user/';
// Courses API: la especificación detallada está en el portal tras la aprobación. Ruta y campos según
// integraciones públicas que la usan; verificar con el PDF del portal antes de activar.
const COURSE_URL = 'https://apis.garmin.com/training-api/courses/v1/course';
/** Único destino aceptado para los `callbackURL` de `activityFiles`. */
const FILE_HOST = 'apis.garmin.com';
const FILE_PATH = '/wellness-api/rest/activityFile';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PUSH_BYTES = 1024 * 1024;
const MAX_COURSE_BODY_BYTES = 4 * 1024 * 1024;
const MAX_COURSE_POINTS = 10_000;
const MAX_COURSE_SPACING_M = 100;
const THIRTY_DAYS = 30 * 86_400_000;
type PendingState = { userId: string; verifier: string; expiresAt: number };
export type GarminTokens = { garminUserId: string; ciphertext: string; expiresAt: number; refreshExpiresAt: number; permissions: string[]; lastSyncAt?: number };
export type GarminFile = { id: string; deviceName?: string; createdAt: number };
export type GarminStore = {
  putState: (hash: string, value: PendingState) => Promise<void>;
  /** Atomic DELETE ... RETURNING, including expired entries, makes state strictly one use. */
  consumeState: (hash: string) => Promise<PendingState | undefined>;
  loadConnection: (userId: string) => Promise<GarminTokens | undefined>;
  saveConnection: (userId: string, tokens: GarminTokens) => Promise<void>;
  removeConnection: (userId: string) => Promise<void>;
  withAccountLock: <T>(userId: string, run: () => Promise<T>) => Promise<T>;
  activities: (userId: string, since: number) => Promise<GarminFile[]>;
  file: (userId: string, id: string, since: number) => Promise<Uint8Array | null>;
  userForGarmin: (garminUserId: string) => Promise<string | undefined>;
  claimEvent: (userId: string, id: string, kind: string) => Promise<boolean>;
  finishEvent: (userId: string, id: string, success: boolean) => Promise<void>;
  saveFile: (userId: string, activity: GarminFile, bytes: Uint8Array, expiresAt: number) => Promise<void>;
  updatePermissions: (userId: string, permissions: string[]) => Promise<void>;
  pendingCount?: (userId: string) => Promise<number>;
};
export type GarminServiceOptions = {
  clientId: string; clientSecret: string; encryptionKey: string; callbackUrl: string; appUrl: string;
  allowedOrigins: string[]; authenticate: (token: string) => Promise<string | null>; store: GarminStore;
  /** Secreto del último tramo de la URL de notificaciones. Garmin no firma los push; sin él, el receptor responde 503. */
  webhookSecret?: string;
  fetcher?: typeof fetch; now?: () => number;
  signal?: AbortSignal;
};
/** One deadline shared by every request-side dependency. */
export function guardedFetch(fetcher: typeof fetch, deadline: AbortSignal): typeof fetch {
  return (input, init) => {
    deadline.throwIfAborted();
    return fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
  };
}
/** Cuenta FBikeTrain válida para Garmin: las anónimas no pueden conectar ni enviar recorridos. */
export function signedInAccount(user: { id: string; is_anonymous?: boolean } | null | undefined): string | null {
  return user && user.is_anonymous !== true ? user.id : null;
}
class SafeError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function bounded(response: Response, max: number): Promise<Uint8Array> {
  if (!response.ok) throw new SafeError(502, 'Garmin no ha entregado el archivo.');
  if (Number(response.headers.get('content-length')) > max) throw new SafeError(413, 'El archivo supera el límite permitido.');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > max) throw new SafeError(413, 'El archivo supera el límite permitido.'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new SafeError(response.status === 401 ? 401 : 502, 'Garmin no ha autorizado la operación. Vuelve a conectar.');
  try { return JSON.parse(new TextDecoder().decode(await bounded(response, 64 * 1024))); }
  catch (error) { if (error instanceof SafeError) throw error; throw new SafeError(502, 'Garmin devolvió una respuesta no válida.'); }
}
async function requestJson(request: Request, max: number): Promise<unknown> {
  try { return JSON.parse(new TextDecoder().decode(await bounded(new Response(request.body, { headers: request.headers }), max))); }
  catch (error) { if (error instanceof SafeError && error.status === 413) throw error; throw new SafeError(400, 'Petición no válida.'); }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const isFit = (bytes: Uint8Array) => bytes.length >= 12 && (bytes[0] === 12 || bytes[0] === 14) && new TextDecoder().decode(bytes.slice(8, 12)) === '.FIT';
function validPermissions(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(p => typeof p === 'string')) throw new SafeError(502, 'Garmin devolvió permisos no válidos.');
  return value;
}
/** Comparación en tiempo constante respecto al contenido (la longitud sí se filtra, y no es secreta). */
function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** Solo `https://apis.garmin.com/wellness-api/rest/activityFile`, sin credenciales en la URL ni otro puerto. */
function safeFileUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const ok = url.protocol === 'https:' && url.hostname === FILE_HOST && !url.port && !url.username && !url.password && url.pathname === FILE_PATH;
    return ok ? url.href : null;
  } catch { return null; }
}

type CoursePoint = { lat: number; lng: number; ele?: number };
type CourseRequest = { name: string; distanceM: number; elevationGainM: number; elevationLossM: number; points: CoursePoint[] };
const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function parseCourse(value: unknown): CourseRequest {
  const body = record(value);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const points = list(body.points).map(record);
  const valid = name && name.length <= 100 && points.length >= 2 && points.length <= 50_000
    && finite(body.distanceM, 1, 2_000_000) && finite(body.elevationGainM, 0, 100_000) && finite(body.elevationLossM, 0, 100_000)
    && points.every(p => finite(p.lat, -90, 90) && finite(p.lng, -180, 180) && (p.ele === undefined || finite(p.ele, -500, 12_000)));
  if (!valid) throw new SafeError(400, 'El recorrido no es válido para Garmin.');
  return { name, distanceM: body.distanceM as number, elevationGainM: body.elevationGainM as number, elevationLossM: body.elevationLossM as number,
    points: points.map(p => ({ lat: p.lat as number, lng: p.lng as number, ...(p.ele === undefined ? {} : { ele: p.ele as number }) })) };
}
const R = 6_371_000;
function metres(a: CoursePoint, b: CoursePoint) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * R;
}
/** Remuestrea a paso uniforme para cumplir los 100 m entre puntos y el máximo de puntos de Courses. */
function resample(points: CoursePoint[]): CoursePoint[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + metres(points[i - 1], points[i]));
  const total = lengths.at(-1)!;
  const step = Math.max(total / (MAX_COURSE_POINTS - 1), 10);
  if (step > MAX_COURSE_SPACING_M) throw new SafeError(400, 'El recorrido es demasiado largo para enviarlo a Garmin.');
  const out: CoursePoint[] = [points[0]];
  let segment = 1;
  for (let at = step; at < total; at += step) {
    while (lengths[segment] < at) segment++;
    const [a, b] = [points[segment - 1], points[segment]];
    const t = (at - lengths[segment - 1]) / (lengths[segment] - lengths[segment - 1]);
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t,
      ...(a.ele !== undefined && b.ele !== undefined ? { ele: a.ele + (b.ele - a.ele) * t } : {}) });
  }
  out.push(points.at(-1)!);
  return out;
}
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export function createGarminService(options: GarminServiceOptions) {
  const { store } = options;
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const requestSignal = options.signal ?? AbortSignal.timeout(60_000);
  const available = !!(options.clientId && options.clientSecret && options.encryptionKey && options.callbackUrl && options.appUrl);
  const remote = (url: string, init: RequestInit) => fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const tokenRequest = async (params: Record<string, string>) => {
    const value = record(await jsonResponse(await remote(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...params }) })));
    if (typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string' || typeof value.expires_in !== 'number' || value.expires_in <= 0 || typeof value.refresh_token_expires_in !== 'number' || value.refresh_token_expires_in <= 0) throw new SafeError(502, 'Garmin devolvió credenciales no válidas.');
    // Garmin recomienda restar 600 s o más a la caducidad para renovar a tiempo.
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: now() + Math.max(0, value.expires_in - 600) * 1000, refreshExpiresAt: now() + value.refresh_token_expires_in * 1000 };
  };
  const credentials = async (userId: string, connection: GarminTokens) => {
    let tokens = JSON.parse(await decryptSecret(connection.ciphertext, options.encryptionKey, userId)) as { accessToken: string; refreshToken: string };
    if (connection.expiresAt <= now()) {
      if (connection.refreshExpiresAt <= now()) throw new SafeError(401, 'La conexión Garmin ha caducado. Vuelve a conectar.');
      const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      tokens = refreshed;
      await store.saveConnection(userId, { ...connection, ciphertext: await encryptSecret(JSON.stringify(tokens), options.encryptionKey, userId), expiresAt: refreshed.expiresAt, refreshExpiresAt: refreshed.refreshExpiresAt });
    }
    return tokens;
  };
  const connectionFor = async (userId: string) => {
    const connection = await store.loadConnection(userId);
    if (!connection) throw new SafeError(409, 'Conecta primero Garmin Connect.');
    return connection;
  };

  /** Una entrega `activityFiles`. Errores permanentes: se marca hecha. Transitorios: queda pendiente y Garmin reintenta. */
  const activityFile = async (item: Record<string, unknown>) => {
    const callbackUrl = safeFileUrl(item.callbackURL);
    const summaryId = typeof item.summaryId === 'string' && item.summaryId.length <= 128 ? item.summaryId : '';
    const fileId = String(item.activityId ?? summaryId);
    if (item.fileType !== 'FIT' || !callbackUrl || !summaryId || !/^[A-Za-z0-9_-]{1,128}$/.test(fileId) || typeof item.userId !== 'string') return;
    const userId = await store.userForGarmin(item.userId);
    if (!userId) return;
    const eventId = `activityFile:${summaryId}`;
    await store.withAccountLock(userId, async () => {
      if (!await store.claimEvent(userId, eventId, 'activity')) return;
      let done = true;
      try {
        const connection = await store.loadConnection(userId);
        if (!connection?.permissions.includes('ACTIVITY_EXPORT')) return;
        const tokens = await credentials(userId, connection);
        let response: Response;
        try { response = await remote(callbackUrl, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }); }
        catch { done = false; throw new SafeError(503, 'Garmin no está disponible ahora.'); }
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel().catch(() => {});
          done = false; throw new SafeError(503, 'Garmin no está disponible ahora.');
        }
        // 4xx (enlace caducado, retirado…), archivo enorme o no FIT: reintentar no lo arregla.
        const bytes = await bounded(response, MAX_FILE_BYTES).catch(() => null);
        if (!bytes || !isFit(bytes)) return;
        await store.saveFile(userId, { id: fileId, createdAt: now() }, bytes, now() + THIRTY_DAYS);
      } catch (error) {
        if (error instanceof SafeError && error.status === 401) return; // Conexión caducada: reintentar no sirve.
        done = false; throw error;
      } finally { await store.finishEvent(userId, eventId, done); }
    });
  };
  const notification = async (request: Request, pathSecret: string) => {
    if (!available || !options.webhookSecret) throw new SafeError(503, 'La recepción de Garmin no está activada.');
    if (!sameSecret(pathSecret, options.webhookSecret) || !sameSecret(request.headers.get('garmin-client-id') ?? '', options.clientId)) throw new SafeError(401, 'Notificación no autorizada.');
    const body = record(await requestJson(request, MAX_PUSH_BYTES));
    const files = list(body.activityFiles).map(record);
    if (files.length > 100) throw new SafeError(413, 'Demasiadas notificaciones.');
    for (const item of list(body.userPermissionsChange).map(record)) {
      const userId = typeof item.userId === 'string' ? await store.userForGarmin(item.userId) : undefined;
      if (userId && Array.isArray(item.permissions) && item.permissions.every(p => typeof p === 'string')) await store.updatePermissions(userId, item.permissions as string[]);
    }
    for (const item of list(body.deregistrations).map(record)) {
      const userId = typeof item.userId === 'string' ? await store.userForGarmin(item.userId) : undefined;
      if (userId) await store.withAccountLock(userId, () => store.removeConnection(userId));
    }
    for (const item of files) { requestSignal.throwIfAborted(); await activityFile(item); }
  };
  const sendCourse = async (userId: string, request: Request) => {
    const course = parseCourse(await requestJson(request, MAX_COURSE_BODY_BYTES));
    const geoPoints = resample(course.points).map(p => ({ latitude: round(p.lat, 6), longitude: round(p.lng, 6), ...(p.ele === undefined ? {} : { elevation: round(p.ele, 1) }) }));
    const connection = await connectionFor(userId);
    if (!connection.permissions.includes('COURSE_IMPORT')) throw new SafeError(403, 'Autoriza en Garmin Connect el envío de recorridos.');
    const tokens = await credentials(userId, connection);
    const created = record(await jsonResponse(await remote(COURSE_URL, {
      method: 'POST', headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseName: course.name, distance: course.distanceM, elevationGain: course.elevationGainM, elevationLoss: course.elevationLossM,
        activityType: 'ROAD_CYCLING', coordinateSystem: 'WGS84', geoPoints }),
    })));
    if (typeof created.courseId !== 'number' && typeof created.courseId !== 'string') throw new SafeError(502, 'Garmin no confirmó el recorrido.');
    return { courseId: created.courseId };
  };

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json', Vary: 'Origin' });
    if (origin && options.allowedOrigins.includes(origin)) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Headers', 'authorization, content-type, apikey, x-client-info'); headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
    try {
      const url = new URL(request.url); const path = url.pathname.slice(url.pathname.indexOf('/garmin') + 7) || '/';
      if (request.method === 'OPTIONS') return new Response(null, { status: origin && options.allowedOrigins.includes(origin) ? 204 : 403, headers });
      const hook = path.match(/^\/notifications(?:\/([^/]*))?$/);
      if (request.method === 'POST' && hook) { await notification(request, hook[1] ?? ''); return json({ accepted: true }); }
      if (request.method === 'GET' && path === '/callback') {
        if (!available) throw new SafeError(503, 'Garmin Connect todavía no está disponible.');
        const state = url.searchParams.get('state');
        if (!state || state.length > 256) throw new SafeError(400, 'La autorización ha caducado. Vuelve a conectar.');
        const pending = await store.consumeState(await digest(state));
        const code = url.searchParams.get('code');
        if (!pending || pending.expiresAt <= now() || !code || code.length > 2048 || url.searchParams.has('error')) throw new SafeError(400, 'La autorización ha caducado o se ha cancelado. Vuelve a conectar.');
        await store.withAccountLock(pending.userId, async () => {
          const verifier = await decryptSecret(pending.verifier, options.encryptionKey, pending.userId);
          const tokens = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: options.callbackUrl });
          const auth = { Authorization: `Bearer ${tokens.accessToken}` };
          const identity = record(await jsonResponse(await remote(`${USER_URL}id`, { headers: auth })));
          const permissions = validPermissions(await jsonResponse(await remote(`${USER_URL}permissions`, { headers: auth })));
          if (typeof identity.userId !== 'string' || !identity.userId || identity.userId.length > 256) throw new SafeError(502, 'Garmin no identificó la cuenta.');
          if (!permissions.includes('ACTIVITY_EXPORT')) {
            const revoked = await remote(`${USER_URL}registration`, { method: 'DELETE', headers: auth });
            if (!revoked.ok && revoked.status !== 404) throw new SafeError(502, 'Garmin no concedió actividades y no se pudo revocar la autorización. Revócala desde Garmin Connect.');
            throw new SafeError(403, 'Autoriza el acceso a las actividades en Garmin Connect.');
          }
          const previous = await store.loadConnection(pending.userId);
          if (previous && previous.garminUserId !== identity.userId) {
            await remote(`${USER_URL}registration`, { method: 'DELETE', headers: auth });
            throw new SafeError(409, 'Desconecta la cuenta Garmin anterior antes de conectar otra.');
          }
          await store.saveConnection(pending.userId, { garminUserId: identity.userId, ciphertext: await encryptSecret(JSON.stringify(tokens), options.encryptionKey, pending.userId), expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt, permissions });
        });
        const redirect = new URL(options.appUrl); redirect.hash = '/ajustes?abrir=conexiones&garmin=connected';
        return new Response(null, { status: 303, headers: { Location: redirect.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
      }
      const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      const userId = bearer ? await options.authenticate(bearer) : null;
      if (!userId) throw new SafeError(401, 'Inicia sesión para conectar Garmin.');
      if (origin && !options.allowedOrigins.includes(origin)) throw new SafeError(403, 'Origen no permitido.');
      if (request.method === 'GET' && path === '/status') {
        const connection = await store.loadConnection(userId);
        return json({ available, connected: !!connection, backfillAvailable: false, pending: store.pendingCount ? await store.pendingCount(userId) : 0,
          ...(connection?.lastSyncAt ? { lastSyncAt: connection.lastSyncAt } : {}),
          ...(connection && !connection.permissions.includes('ACTIVITY_EXPORT') ? { permissionRequired: true } : {}),
          courseAvailable: !!connection?.permissions.includes('COURSE_IMPORT'), receptionAvailable: !!options.webhookSecret });
      }
      if (!available) throw new SafeError(503, 'Garmin Connect todavía no está disponible.');
      if (request.method === 'POST' && path === '/connect') {
        const state = randomSecret(); const verifier = randomSecret();
        await store.putState(await digest(state), { userId, verifier: await encryptSecret(verifier, options.encryptionKey, userId), expiresAt: now() + 600_000 });
        const authorization = new URL(AUTHORIZE_URL);
        authorization.search = new URLSearchParams({ response_type: 'code', client_id: options.clientId, redirect_uri: options.callbackUrl, state, code_challenge_method: 'S256', code_challenge: await digest(verifier) }).toString();
        return json({ authorizationUrl: authorization.href });
      }
      if (request.method === 'POST' && path === '/disconnect') {
        await store.withAccountLock(userId, async () => {
          const connection = await store.loadConnection(userId);
          if (connection) {
            const tokens = await credentials(userId, connection);
            // Obligatorio según Garmin cuando la app ofrece «Desconectar».
            const response = await remote(`${USER_URL}registration`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.accessToken}` } });
            if (!response.ok && response.status !== 404) throw new SafeError(502, 'No se pudo revocar Garmin. Reintenta en unos minutos.');
          }
          await store.removeConnection(userId);
        });
        return json({ disconnected: true });
      }
      if (request.method === 'POST' && path === '/course') return json(await store.withAccountLock(userId, () => sendCourse(userId, request)));
      if (request.method === 'GET' && path === '/activities') {
        const connection = await connectionFor(userId);
        if (!connection.permissions.includes('ACTIVITY_EXPORT')) throw new SafeError(403, 'Garmin no ha concedido acceso a las actividades.');
        return json({ activities: await store.activities(userId, now() - THIRTY_DAYS), backfillAvailable: false });
      }
      const match = path.match(/^\/activities\/([A-Za-z0-9_-]{1,128})\/file$/);
      if (request.method === 'GET' && match) {
        const connection = await connectionFor(userId);
        if (!connection.permissions.includes('ACTIVITY_EXPORT')) throw new SafeError(403, 'Garmin no ha concedido acceso a las actividades.');
        const bytes = await store.file(userId, match[1], now() - THIRTY_DAYS);
        if (!bytes) throw new SafeError(404, 'El archivo Garmin ya no está disponible.');
        if (bytes.length > MAX_FILE_BYTES) throw new SafeError(413, 'El archivo supera el límite permitido.');
        headers.set('Content-Type', 'application/octet-stream'); headers.set('Content-Disposition', `attachment; filename="garmin-${match[1]}.fit"`);
        return new Response(new Uint8Array(bytes), { headers });
      }
      return json({ error: 'Operación no disponible.' }, 404);
    } catch (error) { return json({ error: error instanceof SafeError ? error.message : 'No se pudo completar la conexión Garmin.' }, error instanceof SafeError ? error.status : 503); }
  };
}
