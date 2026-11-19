import { MAX_MESSAGE_CHARS, type Conversation, type Message } from '../../social/chat';
import { formatCount } from '../format';

/**
 * Lógica pura de las pantallas del chat: fundir páginas, agrupar por día, «Visto», la línea de la
 * lista y el contador del campo. Las fechas se leen en Europe/Madrid, como el resto de la app.
 */

/** Un mensaje tal como lo pinta la conversación: los del servidor no llevan `state`. */
export type LocalMessage = Message & { state?: 'sending' | 'failed' };

const TZ = 'Europe/Madrid';
const COUNTER_FROM = 1800;
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const longDayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

/** Días desde 1970 de la fecha de Madrid: restar dos da «hoy», «ayer»… sin líos con el cambio de hora. */
function dayNumber(ms: number): number {
  const [y, m, d] = dayKeyFmt.format(ms).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}
const yearOf = (ms: number) => dayKeyFmt.format(ms).slice(0, 4);

/** Por `id`: gana el del servidor; un optimista o fallido que el servidor no trae se conserva. Orden por fecha y luego `id`. */
export function mergeMessages(current: LocalMessage[], incoming: Message[]): LocalMessage[] {
  const byId = new Map<string, LocalMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** «Hoy», «Ayer» o «Sábado 14 de noviembre» (con el año si no es el actual). */
function dayLabel(ms: number, now: number): string {
  const diff = dayNumber(now) - dayNumber(ms);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  const parts = longDayFmt.formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  const weekday = part('weekday');
  const label = `${weekday.charAt(0).toLocaleUpperCase('es')}${weekday.slice(1)} ${part('day')} de ${part('month')}`;
  return yearOf(ms) === yearOf(now) ? label : `${label} de ${part('year')}`;
}

/** Mensajes ya ordenados, en bloques por día de Madrid. */
export function groupByDay(messages: LocalMessage[], now: number): { label: string; items: LocalMessage[] }[] {
  const groups: { day: number; label: string; items: LocalMessage[] }[] = [];
  for (const m of messages) {
    const ms = Date.parse(m.createdAt);
    const day = dayNumber(ms);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m);
    else groups.push({ day, label: dayLabel(ms, now), items: [m] });
  }
  return groups.map(({ label, items }) => ({ label, items }));
}

/** El último mensaje propio, ya guardado, que la otra persona ha leído. En grupos no hay «Visto». */
export function seenMessageId(conversation: Conversation, messages: LocalMessage[], myId: string): string | null {
  if (conversation.kind !== 'direct' || !conversation.peerLastReadAt) return null;
  const readAt = Date.parse(conversation.peerLastReadAt);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.senderId === myId && !m.state && Date.parse(m.createdAt) <= readAt) return m.id;
  }
  return null;
}

const SENT: Partial<Record<Conversation['lastKind'] & string, [own: string, theirs: string]>> = {
  ride: ['Has enviado una salida', 'Te ha enviado una salida'],
  route: ['Has enviado una ruta', 'Te ha enviado una ruta'],
  library_route: ['Has enviado una ruta', 'Te ha enviado una ruta'],
  proposal: ['Has propuesto una salida', 'Te ha propuesto una salida'],
};

/** Última línea de un renglón de la lista. */
export function previewLine(conversation: Conversation, myId: string): string {
  if (conversation.lastDeleted) return 'Mensaje borrado';
  if (!conversation.lastKind) return '';
  const own = conversation.lastSenderId === myId;
  const sent = SENT[conversation.lastKind];
  if (sent) return own ? sent[0] : sent[1];
  if (conversation.lastKind === 'text' && own) return `Tú: ${conversation.lastPreview}`;
  return conversation.lastPreview;
}

/** Fuera las conversaciones de dos sin ningún mensaje o sin la otra persona (cuenta borrada). */
export function visibleConversations(rows: Conversation[]): Conversation[] {
  return rows.filter(c => c.kind !== 'direct' || (c.lastKind !== null && c.peerId !== null));
}

/** Hora de un mensaje: «9:30». */
export const messageTime = (iso: string): string => timeFmt.format(Date.parse(iso));

/** Hora o día de un renglón de la lista: «9:42», «Ayer», «14 nov». */
export function listTime(iso: string, now: number): string {
  const ms = Date.parse(iso);
  const diff = dayNumber(now) - dayNumber(ms);
  if (diff === 0) return messageTime(iso);
  if (diff === 1) return 'Ayer';
  return shortDayFmt.format(ms).replace('.', '');
}

/** Caracteres como los cuenta el servidor: un emoji es uno. */
const chars = (text: string) => [...text].length;

/** «1801/2000» al pasar de 1800 caracteres; antes, nada. */
export function counterText(text: string): string | null {
  const n = chars(text);
  return n > COUNTER_FROM ? `${formatCount(n)}/${formatCount(MAX_MESSAGE_CHARS)}` : null;
}

/** Recorta al tope sin partir un emoji. */
export function clampMessage(text: string): string {
  return chars(text) > MAX_MESSAGE_CHARS ? [...text].slice(0, MAX_MESSAGE_CHARS).join('') : text;
}

const READ_ONLY = new Set(['Ya no sois amigos: no puedes escribir aquí.', 'Esta conversación ya no está disponible.']);
/** Errores de envío tras los que el campo de texto deja paso a la línea de solo lectura. */
export const isReadOnlyError = (message: string): boolean => READ_ONLY.has(message);
