import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { chatUnreadLabel } from '../../social/chatBadge';
import { Calendar, ChartColumn, Ellipsis, House, MessageCircle, Route, Swords, User, Users, type LucideIcon } from '../icons';
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
  /** Contador de Retos (invitaciones por aceptar y retos que acaban hoy); 0 no pinta nada. */
  retosBadge?: number;
  /** Conversaciones de chat sin leer, en el carril de PC; 0 no pinta nada. */
  chatBadge?: number;
};

/**
 * Barra inferior de cinco pestañas; desde 900 px, carril lateral con la marca arriba (kit.css).
 * La pestaña de la pantalla actual, o de su madre, lleva `aria-current="page"`.
 */
export const TabBar = memo(function TabBar({ pathname, planBadge, retosBadge = 0, chatBadge = 0 }: Props) {
  const current = tabOf(pathname);
  const account = useAccount();
  const inProfile = pathname === '/perfil' || pathname === '/zona';
  const inFriends = pathname.startsWith('/amigos') || pathname.startsWith('/perfil/amigos');
  const inCyclists = pathname.startsWith('/ciclistas') || pathname.startsWith('/personas/');
  const inChallenges = pathname.startsWith('/retos');
  const inChat = pathname.startsWith('/chat');
  const registered = account && !account.user.is_anonymous;
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
        <CommunityLink to="/retos" label="Retos" icon={Swords} current={inChallenges || pathname.startsWith('/ciclistas')} badge={retosBadge} className="tab--mobile" />
        <div className="nav-community" role="group" aria-label="Comunidad">
          <h2 className="rail-section">Comunidad</h2>
          <CommunityLink to="/perfil" label="Tu perfil" icon={User} current={inProfile} />
          <CommunityLink to="/ciclistas" label="Ciclistas" icon={Users} current={inCyclists} />
          <CommunityLink to="/perfil/amigos" label="Amigos" icon={Users} current={inFriends} />
          {registered && <CommunityLink to="/chat" label="Chat" icon={MessageCircle} current={inChat} badge={chatBadge} ariaLabel={chatUnreadLabel(chatBadge)} />}
          <CommunityLink to="/retos" label="Retos" icon={Swords} current={inChallenges} badge={retosBadge} />
        </div>
        <CommunityLink to="/mas" label="Más" icon={Ellipsis} current={current === 'mas' && !inProfile && !inFriends && !inCyclists && !inChallenges && !inChat} className="tab--desktop" />
      </>}
    </nav>
  );
});

function CommunityLink({ to, label, icon: Icon, current, badge = 0, className = '', ariaLabel }: {
  to: string; label: string; icon: LucideIcon; current: boolean; badge?: number; className?: string;
  /** Nombre accesible con contador, si «pendientes» no es la palabra. */
  ariaLabel?: string;
}) {
  const counted = ariaLabel ?? `${label}, ${badge === 1 ? '1 pendiente' : `${badge} pendientes`}`;
  return <Link className={`tab ${className}`} to={to} aria-current={current ? 'page' : undefined}
    aria-label={badge > 0 ? counted : undefined}>
    <span className="tab-ic"><Icon className="ic" aria-hidden="true" />
      {badge > 0 ? <span className="tab-badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span> : null}
    </span>
    <span>{label}</span>
  </Link>;
}
