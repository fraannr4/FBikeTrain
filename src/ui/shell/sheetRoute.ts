/**
 * Estado de navegación de una hoja inferior abierta desde su lista (`/historial/subidas/:id`).
 * La dirección cambia para que Atrás cierre la hoja, pero la pantalla de debajo sigue igual: ni
 * se vuelve arriba al abrirla ni se rehace la lista al cerrarla.
 */
export const SHEET_STATE = { sheet: true } as const;

export function isSheetState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { sheet?: unknown }).sheet === true;
}
