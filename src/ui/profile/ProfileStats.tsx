import { Link } from 'react-router-dom';
import { formatCount } from '../format';

export type ProfileStat = {
  value: number;
  label: string;
  /** Nombre completo para el lector de pantalla, p. ej. «2 amigos, 1 solicitud pendiente». */
  name: string;
  to?: string;
  /** Nota corta bajo la etiqueta (solicitudes pendientes). */
  note?: string;
};

/** Fila de cifras del perfil, tocables cuando llevan a algún sitio. */
export function ProfileStats({ label, items }: { label: string; items: ProfileStat[] }) {
  return (
    <ul className="profile-stats" aria-label={label}>
      {items.map((s) => {
        const body = <>
          <strong>{formatCount(s.value)}</strong>
          <span>{s.label}</span>
          {s.note ? <small>{s.note}</small> : null}
        </>;
        return (
          <li key={s.label}>
            {s.to ? <Link className="profile-stat" to={s.to} aria-label={s.name}>{body}</Link> : <div className="profile-stat">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
