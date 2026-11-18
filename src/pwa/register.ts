type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
let prompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
export const subscribeInstall = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const canInstall = () => prompt !== null;
const notify = () => listeners.forEach(listener => listener());
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  prompt = event as InstallPrompt;
  notify();
});
window.addEventListener('appinstalled', () => { prompt = null; notify(); });
export async function installApp(): Promise<void> {
  const current = prompt;
  if (!current) return;
  prompt = null;
  notify();
  await current.prompt();
  await current.userChoice;
}
const KEEP_DELAY_MS = 8000;
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Primera visita: esta carga ha ido sin worker, así que se le pasa lo ya descargado para poder arrancar sin red.
    const firstVisit = !navigator.serviceWorker.controller;
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then(() => firstVisit ? navigator.serviceWorker.ready : null)
      // Con espera: guardar las copias no debe competir con el primer pintado de la app.
      .then(registration => registration && window.setTimeout(() => registration.active?.postMessage({
        type: 'keep',
        urls: [location.origin + location.pathname, ...performance.getEntriesByType('resource').map(entry => entry.name)],
      }), KEEP_DELAY_MS))
      .catch(() => { /* La web sigue funcionando si el navegador bloquea el SW. */ });
  });
}
