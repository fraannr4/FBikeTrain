import { Suspense, useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { AppShell } from './ui/shell/AppShell';
import { lazyPage, preloadWhenIdle } from './ui/shell/lazyPage';
import { CyclingLoader } from './ui/components/CyclingLoader';

// Cada pantalla es un fragmento aparte: la primera carga solo trae la que se abre.
const Inicio = lazyPage(() => import('./ui/pages/Inicio').then((m) => ({ default: m.Inicio })));
const Importar = lazyPage(() => import('./ui/pages/Importar').then((m) => ({ default: m.Importar })));
const Compartido = lazyPage(() => import('./ui/pages/Compartido').then((m) => ({ default: m.Compartido })));
const Ajustes = lazyPage(() => import('./ui/pages/Ajustes').then((m) => ({ default: m.Ajustes })));
const HistoryWorkspace = lazyPage(() => import('./ui/historial/HistoryWorkspace').then((m) => ({ default: m.HistoryWorkspace })));
const Subidas = lazyPage(() => import('./ui/pages/Subidas').then((m) => ({ default: m.Subidas })));
const Repetidas = lazyPage(() => import('./ui/pages/Repetidas').then((m) => ({ default: m.Repetidas })));
const Rutas = lazyPage(() => import('./ui/pages/Rutas').then((m) => ({ default: m.Rutas })));
const Calendario = lazyPage(() => import('./ui/pages/Calendario').then((m) => ({ default: m.Calendario })));
const Objetivos = lazyPage(() => import('./ui/pages/Objetivos').then((m) => ({ default: m.Objetivos })));
const Mas = lazyPage(() => import('./ui/pages/Mas').then((m) => ({ default: m.Mas })));
const Perfil = lazyPage(() => import('./ui/pages/Perfil').then((m) => ({ default: m.Perfil })));
const PerfilNuevo = lazyPage(() => import('./ui/pages/PerfilNuevo').then((m) => ({ default: m.PerfilNuevo })));
const Persona = lazyPage(() => import('./ui/pages/Persona').then((m) => ({ default: m.Persona })));
const BibliotecaRutas = lazyPage(() => import('./ui/pages/BibliotecaRutas').then((m) => ({ default: m.BibliotecaRutas })));
const RutaCompartida = lazyPage(() => import('./ui/pages/RutaCompartida').then((m) => ({ default: m.RutaCompartida })));
const Zona = lazyPage(() => import('./ui/pages/Zona').then((m) => ({ default: m.Zona })));
const Amigos = lazyPage(() => import('./ui/pages/Amigos').then((m) => ({ default: m.Amigos })));
const Retos = lazyPage(() => import('./ui/pages/Retos').then((m) => ({ default: m.Retos })));
const NuevoReto = lazyPage(() => import('./ui/pages/NuevoReto').then((m) => ({ default: m.NuevoReto })));
const Reto = lazyPage(() => import('./ui/pages/Reto').then((m) => ({ default: m.Reto })));
const Ciclistas = lazyPage(() => import('./ui/pages/Ciclistas').then((m) => ({ default: m.Ciclistas })));
const CommunityRetos = lazyPage(() => import('./ui/pages/CommunityRetos').then((m) => ({ default: m.CommunityRetos })));
const CommunityNuevoReto = lazyPage(() => import('./ui/pages/CommunityNuevoReto').then((m) => ({ default: m.CommunityNuevoReto })));
const NoEncontrada = lazyPage(() => import('./ui/pages/NoEncontrada').then((m) => ({ default: m.NoEncontrada })));
const CommunityReto = lazyPage(() => import('./ui/pages/CommunityReto').then((m) => ({ default: m.CommunityReto })));

// Destinos de la barra de pestañas: se descargan en un rato libre, después de pintar la primera pantalla.
const TAB_PAGES = [HistoryWorkspace, Rutas, Calendario, Mas];

/**
 * Las pantallas anteriores al kit (Inicio, Importar, Ajustes) llevan su propio margen: la `main`
 * del kit ya no lo pone. Se quita cuando cada una pasa a `Page`.
 */
function Legacy({ children }: { children: ReactNode }) {
  return <div className="legacy">{children}</div>;
}

/** Existing library links carry a selected route; preserve their route-duel flow. */
function NewChallengeRoute() {
  const [params] = useSearchParams();
  return params.has('ruta') ? <NuevoReto /> : <CommunityNuevoReto />;
}

export function App() {
  useEffect(() => preloadWhenIdle(TAB_PAGES), []);
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell>
        <Suspense fallback={<CyclingLoader label="Cargando pantalla" />}>
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
          <Route path="/rutas/biblioteca" element={<BibliotecaRutas />} />
          {/* Enlaces antiguos: Rutas con IA, Rutas cerca, Empalmar, el catálogo y el marcador de Wikiloc, ya retirados. */}
          {['/rutas/ia', '/rutas/cerca', '/rutas/empalmar', '/rutas/catalogo', '/rutas/wikiloc/*'].map((path) => (
            <Route key={path} path={path} element={<Navigate to="/rutas" replace />} />
          ))}
          <Route path="/rutas/compartida" element={<RutaCompartida />} />
          <Route path="/plan" element={<Calendario />} />
          <Route path="/plan/objetivos" element={<Objetivos />} />
          <Route path="/mas" element={<Mas />} />
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/perfil/nuevo" element={<PerfilNuevo />} />
          <Route path="/personas/:id" element={<Persona />} />
          <Route path="/importar" element={<Importar />} />
          <Route path="/compartido" element={<Compartido />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="/zona" element={<Zona />} />
          <Route path="/perfil/amigos" element={<Amigos />} />
          {/* Amigos vive ahora dentro del perfil; el enlace antiguo (también ?vista=amigos) redirige. */}
          <Route path="/amigos" element={<Navigate to="/perfil/amigos" replace />} />
          <Route path="/ciclistas" element={<Ciclistas />} />
          <Route path="/retos" element={<CommunityRetos />} />
          <Route path="/retos/nuevo" element={<NewChallengeRoute />} />
          <Route path="/retos/comunidad/:id" element={<CommunityReto />} />
          <Route path="/retos/anteriores" element={<Retos />} />
          <Route path="/retos/anterior/nuevo" element={<NuevoReto />} />
          <Route path="/retos/:id" element={<Reto />} />
          {/* El plan tuvo los objetivos en la raíz en enlaces antiguos. */}
          <Route path="/objetivos" element={<Navigate to="/plan/objetivos" replace />} />
          <Route path="*" element={<NoEncontrada />} />
        </Routes>
        </Suspense>
      </AppShell>
    </HashRouter>
  );
}
