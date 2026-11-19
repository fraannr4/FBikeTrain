import { createContext, useContext, type ReactNode } from 'react';

const ChatUnreadContext = createContext(0);

/** El armazón cuenta una vez las conversaciones sin leer; el icono de cada barra superior lo lee de aquí. */
export function ChatUnreadProvider({ value, children }: { value: number; children: ReactNode }) {
  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}

export const useChatUnreadCount = () => useContext(ChatUnreadContext);
