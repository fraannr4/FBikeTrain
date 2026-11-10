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
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => { /* La web sigue funcionando si el navegador bloquea el SW. */ });
  });
}
