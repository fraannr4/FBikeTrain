/** Cancelación de una búsqueda en curso: no es un error para el usuario, quien llama la ignora. */
export const abortError = () => new DOMException('Búsqueda cancelada', 'AbortError');

export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';
