/** Se lanza al leer o recibir mensajes: la insignia del chat vuelve a contar sin esperar a cambiar de pantalla. */
export const CHAT_CHANGED_EVENT = 'fbt-chat-changed';

export const notifyChatChanged = () => window.dispatchEvent(new Event(CHAT_CHANGED_EVENT));
