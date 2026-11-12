import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './ui/shell/AppShell';
import { Inicio } from './ui/pages/Inicio';
import { Importar } from './ui/pages/Importar';
import { Compartido } from './ui/pages/Compartido';
import { Ajustes } from './ui/pages/Ajustes';
import { HistoryWorkspace } from './ui/historial/HistoryWorkspace';
import { Subidas } from './ui/pages/Subidas';
import { Repetidas } from './ui/pages/Repetidas';
import { Rutas } from './ui/pages/Rutas';
import { RutasIa } from './ui/pages/RutasIa';
import { Calendario } from './ui/pages/Calendario';
import { Objetivos } from './ui/pages/Objetivos';
import { Mas } from './ui/pages/Mas';
import { Perfil } from './ui/pages/Perfil';
import { BibliotecaRutas } from './ui/pages/BibliotecaRutas';
import { Empalmar } from './ui/pages/Empalmar';
import { RutasCerca } from './ui/pages/RutasCerca';
import { RutaCompartida } from './ui/pages/RutaCompartida';

/**
 * Las pantallas anteriores al kit (Inicio, Importar, Ajustes) llevan su propio margen: la `main`
 * del kit ya no lo pone. Se quita cuando cada una pasa a `Page`.
 */
function Legacy({ children }: { children: ReactNode }) {
  return <div className="legacy">{children}</div>;
}

export function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell>
        <Routes>
          <Route
            path="/"
            element={
              <Legacy>
                <Inicio />
              </Legacy>
            }
          />
          <Route path="/historial" element={<HistoryWorkspace />} />
          <Route path="/historial/subidas" element={<Subidas />} />
          <Route path="/historial/subidas/:id" element={<Subidas />} />
          <Route path="/historial/repetidas" element={<Repetidas />} />
          <Route path="/historial/repetidas/:id" element={<Repetidas />} />
          <Route path="/historial/:id" element={<HistoryWorkspace />} />
          <Route path="/rutas" element={<Rutas />} />
          <Route path="/rutas/ia" element={<RutasIa />} />
          <Route path="/rutas/biblioteca" element={<BibliotecaRutas />} />
          <Route path="/rutas/empalmar" element={<Empalmar />} />
          <Route path="/rutas/cerca" element={<RutasCerca />} />
          {/* Enlaces antiguos: el catálogo de Ride with GPS y el marcador de Wikiloc, ya retirados. */}
          <Route path="/rutas/catalogo" element={<Navigate to="/rutas/cerca" replace />} />
          <Route path="/rutas/wikiloc/*" element={<Navigate to="/rutas/cerca" replace />} />
          <Route path="/rutas/compartida" element={<RutaCompartida />} />
          <Route path="/plan" element={<Calendario />} />
          <Route path="/plan/objetivos" element={<Objetivos />} />
          <Route path="/mas" element={<Mas />} />
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/importar" element={<Importar />} />
          <Route path="/compartido" element={<Compartido />} />
          <Route path="/ajustes" element={<Ajustes />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
