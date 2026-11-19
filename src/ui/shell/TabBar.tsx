import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { Calendar, ChartColumn, Ellipsis, House, MessageCircle, Route, Search, Swords, UserPlus, Users, type LucideIcon } from '../icons';
import { GENTE_PARTS, partCount, partLabel, type GentePart } from '../gente/genteParts';
import { BrandMark } from './BrandMark';
import type { GentePending } from './GentePendingContext';
import { OwnAvatar, YOU_LABEL } from './OwnProfileButton';
import { TAB_ROOT, tabOf, type TabId } from './screens';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'inicio', label: 'Inicio', icon: House },
  { id: 'historial', label: 'Salidas', icon: ChartColumn },
  { id: 'rutas', label: 'Rutas', icon: Route },
  { id: 'plan', label: 'Plan', icon: Calendar },
];
const PART_ICON: Record<GentePart['id'], LucideIcon> = { chats: MessageCircle, amigos: UserPlus, retos: Swords, ciclistas: Search };
const NO_PENDING: GentePending = { chats: 0, amigos: 0, retos: 0, total: 0 };
const counted = (label: string, n: number) => `${label}, ${n === 1 ? '1 pendiente' : `${n} pendientes`}`;

type Props = {
  pathname: string;
  /** Contador sobre la pestaña Plan; 0 no pinta nada. */
  planBadge: number;
  /** Lo pendiente en «Gente»: la insignia del muelle lo suma y el carril lo reparte. */
  gente?: GentePending;
};

/**
 * Muelle de cinco pestañas; desde 900 px, carril lateral con la marca arriba (kit.css). Con cuenta
 * registrada: Inicio, Salidas, Rutas, Plan y Gente; en el carril, el grupo «Gente» con sus cuatro
 * partes y «Tú» al pie. En el modo local (sin cuenta o anónima) la quinta es «Más» y no hay comunidad.
 * La pestaña de la pantalla actual, o de su madre, lleva `aria-current="page"`.
 */
export const TabBar = memo(function TabBar({ pathname, planBadge, gente = NO_PENDING }: Props) {
  const account = useAccount();
  const registered = !!account && !account.user.is_anonymous;
  const tab = tabOf(pathname);
  // En el modo local, lo que sería de «Gente» (los retos de ruta anteriores) cuelga de «Más», como antes.
  const current = !registered && tab === 'gente' ? 'mas' : tab;
  return (
    <nav className="tabbar" aria-label="Menú principal">
      <Link className="rail-brand" to="/" aria-label="FBikeTrain, inicio">
        <BrandMark />
      </Link>
      {TABS.map(({ id, label, icon }) => (
        <TabLink key={id} to={TAB_ROOT[id]} label={label} icon={icon} current={id === current}
          badge={id === 'plan' ? planBadge : 0} ariaLabel={counted(label, planBadge)} />
      ))}
      {registered ? (
        <>
          <TabLink className="tab--mobile" to={TAB_ROOT.gente} label="Gente" icon={Users} current={current === 'gente'}
            badge={gente.total} ariaLabel={counted('Gente', gente.total)} />
          <div className="nav-community" role="group" aria-label="Gente">
            <h2 className="rail-section">Gente</h2>
            {GENTE_PARTS.map((part) => (
              <TabLink key={part.id} to={part.to} label={part.label} icon={PART_ICON[part.id]} current={part.match(pathname)}
                badge={partCount(part, gente)} ariaLabel={partLabel(part, gente)} />
            ))}
          </div>
          <Link className="tab tab--desktop rail-you" to="/perfil" aria-label={YOU_LABEL} aria-current={current === 'mas' ? 'page' : undefined}>
            <span className="tab-ic"><OwnAvatar /></span>
            <span>Tú</span>
          </Link>
        </>
      ) : (
        <TabLink to={TAB_ROOT.mas} label="Más" icon={Ellipsis} current={current === 'mas'} />
      )}
    </nav>
  );
});

/** Una pestaña: icono, rótulo y, con contador, la insignia roja («9+» por encima de nueve). */
function TabLink({ to, label, icon: Icon, current, badge = 0, ariaLabel, className }: {
  to: string; label: string; icon: LucideIcon; current: boolean; badge?: number;
  /** Nombre accesible cuando hay contador: «Gente, 4 pendientes». */
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Link className={className ? `tab ${className}` : 'tab'} to={to} aria-current={current ? 'page' : undefined}
      aria-label={badge > 0 ? ariaLabel : undefined}>
      <span className="tab-ic">
        <Icon className="ic" aria-hidden="true" />
        {badge > 0 ? <span className="tab-badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span> : null}
      </span>
      <span>{label}</span>
    </Link>
  );
}
