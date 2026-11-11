/**
 * Acuerdo entre el marcador «→ FBikeTrain» y la pantalla `#/rutas/wikiloc/recibir`.
 * La app abierta por el marcador envía FBT_READY a `window.opener`; el marcador responde
 * con un único mensaje `WikilocMessage` dirigido al origen exacto de la app.
 */

export const FBT_READY = 'fbt-ready';
export const RECEIVE_HASH = '#/rutas/wikiloc/recibir';
/** Espera máxima de FBT_READY antes de avisar en la página de Wikiloc. */
export const READY_TIMEOUT_MS = 15_000;

/** Dirección de la app en producción y en desarrollo; el build crea un marcador para cada una. */
export const APP_BASES = {
  prod: 'https://fraannr4.github.io/FBikeTrain/',
  dev: 'http://localhost:5173/',
} as const;

/** Marca que el build sustituye en el código del marcador por la dirección de la app. */
export const APP_BASE_PLACEHOLDER = '__FBT_APP_BASE__';
