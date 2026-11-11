import { runBookmarklet } from './bookmarklet';
import { APP_BASE_PLACEHOLDER } from './protocol';

// Entrada del marcador. El build cambia la marca por la dirección de la app (producción o desarrollo).
void runBookmarklet({
  win: window,
  doc: document,
  pageUrl: location.href,
  fetch: (input, init) => fetch(input, init),
  appBase: APP_BASE_PLACEHOLDER,
});
