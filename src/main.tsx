import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AccountBoundary } from './auth/AccountBoundary';
import { accountClient, initializeAccount } from './auth/client';
import { rememberSharedLocation } from './pwa/sharedFiles';
// Fuentes autoalojadas, solo el subconjunto latin.
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import '@fontsource/barlow-semi-condensed/latin-700-italic.css';
// Tokens primero; después, de lo general a lo particular.
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/shell.css';
// El kit del prototipo móvil: manda sobre las clases que comparte con base.css.
import './ui/styles/kit.css';
import './ui/styles/inicio.css';
import './ui/styles/trend.css';
import './ui/styles/map.css';
import './ui/styles/routes.css';
import './ui/styles/forms.css';
import './ui/styles/motion.css';
// Una hoja por pantalla del kit.
import './ui/styles/historial.css';
import './ui/styles/salida.css';
import './ui/styles/subidas.css';
import './ui/styles/repetidas.css';
import './ui/styles/rutas.css';
import './ui/styles/ia.css';
import './ui/styles/plan.css';
import './ui/styles/objetivos.css';
import './ui/styles/mas.css';
import './ui/styles/account.css';

rememberSharedLocation();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountBoundary client={accountClient} initialize={initializeAccount}><App /></AccountBoundary>
  </StrictMode>,
);
