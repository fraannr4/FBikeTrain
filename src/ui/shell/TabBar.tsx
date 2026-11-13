import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { Calendar, ChartColumn, Ellipsis, House, Route, Swords, User, Users, type LucideIcon } from '../icons';
import { BrandMark } from './BrandMark';
import { TAB_ROOT, tabOf, type TabId } from './screens';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'inicio', label: 'Inicio', icon: House },
  { id: 'historial', label: 'Historial', icon: ChartColumn },
  { id: 'rutas', label: 'Rutas', icon: Route },
  { id: 'plan', label: 'Plan', icon: Calendar },
  { id: 'mas', label: 'Más', icon: Ellipsis },
];

type Props = {
  pathname: string;
  /** Contador sobre la pestaña Plan; 0 no pinta nada. */
  planBadge: number;
};

/**
 * Barra inferior de cinco pestañas; desde 900 px, carril lateral con la marca arriba (kit.css).
 * La pestaña de la pantalla actual, o de su madre, lleva `aria-current="page"`.
 */
export const TabBar = memo(function TabBar({ pathname, planBadge }: Props) {
  const current = tabOf(pathname);
  const account = useAccount();
  const inProfile = pathname === '/perfil' || pathname === '/zona';
  const inFriends = pathname.startsWith('/amigos') || pathname.startsWith('/personas/');
  const inChallenges = pathname.startsWith('/retos');
  return (
    <nav className="tabbar" aria-label="Menú principal">
      <Link className="rail-brand" to="/" aria-label="FBikeTrain, inicio">
        <BrandMark />
      </Link>
      {TABS.filter(tab => !account || tab.id !== 'mas').map(({ id, label, icon: Icon }) => {
        const badge = id === 'plan' && planBadge > 0 ? planBadge : 0;
        return (
          <Link
            key={id}
            className="tab"
            to={TAB_ROOT[id]}
            aria-current={id === current ? 'page' : undefined}
            aria-label={badge > 0 ? `${label}, ${badge === 1 ? '1 pendiente' : `${badge} pendientes`}` : undefined}
          >
            <span className="tab-ic">
              <Icon className="ic" aria-hidden="true" />
              {badge > 0 ? (
                <span className="tab-badge" aria-hidden="true">
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
      {account && <>
        <CommunityLink to="/perfil" label="Perfil" icon={User} current={current === 'mas'} className="tab--mobile" />
        <div className="nav-community" role="group" aria-label="Comunidad">
          <h2 className="rail-section">Comunidad</h2>
          <CommunityLink to="/perfil" label="Tu perfil" icon={User} current={inProfile} />
          <CommunityLink to="/amigos" label="Amigos" icon={Users} current={inFriends} />
          <CommunityLink to="/retos" label="Retos" icon={Swords} current={inChallenges} />
        </div>
        <CommunityLink to="/mas" label="Más" icon={Ellipsis} current={current === 'mas' && !inProfile && !inFriends && !inChallenges} className="tab--desktop" />
      </>}
    </nav>
  );
});

function CommunityLink({ to, label, icon: Icon, current, className = '' }: {
  to: string; label: string; icon: LucideIcon; current: boolean; className?: string;
}) {
  return <Link className={`tab ${className}`} to={to} aria-current={current ? 'page' : undefined}>
    <span className="tab-ic"><Icon className="ic" aria-hidden="true" /></span>
    <span>{label}</span>
  </Link>;
}
