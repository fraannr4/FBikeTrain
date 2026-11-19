/** Se lanza al leer o recibir mensajes: la insignia del chat vuelve a contar sin esperar a cambiar de pantalla. */
export const CHAT_CHANGED_EVENT = 'fbt-chat-changed';

export const notifyChatChanged = () => window.dispatchEvent(new Event(CHAT_CHANGED_EVENT));

/** Nombre accesible del acceso al chat, con las conversaciones sin leer. */
export const chatUnreadLabel = (unread: number): string =>
  unread > 0 ? `Chat, ${unread === 1 ? '1 conversación sin leer' : `${unread} conversaciones sin leer`}` : 'Chat';
