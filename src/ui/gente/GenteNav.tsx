import { useLocation } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { SegmentedNav } from '../components/SegmentedControl';
import { useDesktopLayout } from '../hooks/useDesktopLayout';
import { useGentePending } from '../shell/GentePendingContext';
import { GENTE_PARTS, partCount, partLabel } from './genteParts';
import '../styles/gente.css';

/** Desde aquí el carril lleva las cuatro partes: el control sobra. */
const RAIL_QUERY = '(min-width: 900px)';

/**
 * Las cuatro partes de «Gente» bajo su título: Chats, Amigos, Retos y Ciclistas. La de la pantalla
 * actual lleva `aria-current="page"`; las que tienen algo pendiente, su contador rojo. Solo con cuenta
 * registrada y en el móvil.
 */
export function GenteNav() {
  const account = useAccount();
  const pending = useGentePending();
  const { pathname } = useLocation();
  const rail = useDesktopLayout(RAIL_QUERY);
  if (!account || account.user.is_anonymous || rail) return null;
  const items = GENTE_PARTS.map((part) => {
    const n = partCount(part, pending);
    return n > 0
      ? { to: part.to, label: part.label, count: n > 9 ? '9+' : String(n), ariaLabel: partLabel(part, pending) }
      : { to: part.to, label: part.label };
  });
  const current = GENTE_PARTS.find((part) => part.match(pathname))?.to ?? '/chat';
  return <SegmentedNav label="Partes de Gente" className="seg--4" items={items} current={current} />;
}
